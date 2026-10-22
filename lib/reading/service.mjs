import { join } from "node:path";
import { Store } from "./store.mjs";
import { Budget } from "./budget.mjs";
import { Network } from "./network.mjs";
import { readVideo, candidates, coverage, segments } from "./reader.mjs";
import { need, safeError } from "./errors.mjs";
import { DATA_DIR } from "../../tools/lib/paths.mjs";
import { personality } from "../ledger/personality.mjs";
import { fields, exportInbox, readInbox, verifyInbox } from "../ledger/inbox.mjs";
import {
  enforceJournalDailyLimit,
  journalDailyStatus,
} from "../ledger/journal-policy.mjs";
// v1.0 合并版只保留「读原文 → 落账 → 人格 → 收件箱」。
// 抽帧（visual-*）、本地音频 ASR（runPython/runMedia）、平台写操作（writer）已整体移除，
// 因此这里的 limits 只剩网络请求 / 候选 / 单条时长 / 墙钟四类。
const defaultLimits = {
  requests: 12,
  candidates: 3,
  asrSeconds: 600,
  wallMs: 90000,
};
export function text(value, max = 12000) {
  need(typeof value === "string" && value.length <= max, "INVALID_TEXT");
  return value.trim();
}
export function noteBody(raw, reading) {
  need(raw && typeof raw === "object" && !Array.isArray(raw), "INVALID_NOTE");
  need(
    Object.keys(raw).every((k) => fields.includes(k) || k === "evidence"),
    "INVALID_NOTE_FIELD",
  );
  const body = Object.fromEntries(fields.map((k) => [k, text(raw[k] || "")]));
  need(body.encounter && body.missing, "NOTE_REQUIRES_ENCOUNTER_AND_LIMITS");
  // 契约：evidence 是可选数组（≤20 条）。humanism 原来要求显式传 `evidence: []`，
  // 但合并契约只把它当上限 —— 少了证据不该让「记一条见闻」失败。
  const evidence = raw.evidence === undefined ? [] : raw.evidence;
  need(Array.isArray(evidence) && evidence.length <= 20, "INVALID_EVIDENCE");
  body.evidence = evidence.map((e) => {
    need(
      Number.isFinite(e.at) && e.at >= 0 && e.at <= reading.duration,
      "INVALID_EVIDENCE_TIME",
    );
    return {
      at: e.at,
      claim: text(e.claim, 2000),
      url: reading.url + "&t=" + Math.floor(e.at),
    };
  });
  if (body.facts || body.author_view)
    need(body.evidence.length > 0, "EVIDENCE_REQUIRED");
  return body;
}
export class Service {
  constructor(config = {}, dependencies = {}) {
    this.config = {
      ...config,
      enablePersonalityLearning:
        config.enablePersonalityLearning === undefined
          ? true
          : config.enablePersonalityLearning,
    };
    this.store = new Store(config.dataDir || DATA_DIR);
    this.limits = { ...defaultLimits, ...config.limits };
    for (const key of Object.keys(defaultLimits))
      need(
        Number.isFinite(this.limits[key]) &&
          this.limits[key] >= 0 &&
          this.limits[key] <= defaultLimits[key],
        "INVALID_LIMIT",
      );
    this.fetcher = dependencies.fetcher || globalThis.fetch;
    this.active = new Set();
  }
  async task(fn, signal) {
    const id = this.store.start();
    const controller = new AbortController();
    this.active.add(controller);
    const budget = new Budget(
      this.store,
      id,
      this.limits,
      signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    );
    try {
      const network = new Network(this.store, budget, {
        credentialPath: this.config.credentialPath,
        fetcher: this.fetcher,
      });
      const result = await fn(network, budget);
      budget.check();
      this.store.finish(id, "completed");
      return {
        taskId: id,
        result,
        usage: {
          requests: budget.requests,
          candidates: budget.candidates,
          asr_seconds: budget.asr,
          elapsed_ms: Date.now() - budget.started,
          tokens: null,
        },
      };
    } catch (e) {
      this.store.finish(
        id,
        e.code === "CANCELLED" ? "cancelled" : "failed",
        e.code || "INTERNAL_ERROR",
      );
      throw e;
    } finally {
      this.active.delete(controller);
      if (this.closing && this.active.size === 0) this.store.close();
    }
  }
  // route: auto（默认，A1→A2）/ subtitle（只走 A1）/ conclusion（只走 A2）/
  // local（只落元数据，等 importLocal 提供 A3 本地原文）。
  async read(input, page, signal, route = "auto") {
    return this.task(
      (network) => this.readSource(input, page, network, route),
      signal,
    );
  }
  async readSource(input, page, network, route = "auto") {
    const reading = await readVideo(input, page, network, this.store, route);
    const local = !reading.segments.length
      ? this.store.localTranscript(reading)
      : null;
    if (local)
      return {
        ...local,
        cached: reading.cached,
        deduplicated: true,
        reusedLocalSource: true,
        networkSource: {
          route: reading.route,
          cached: reading.cached,
          attempts: reading.attempts,
          coverage: reading.coverage,
        },
      };
    return this.store.saveReading(reading);
  }
  async candidates(count = 3, signal) {
    return this.task((network) => candidates(network, count), signal);
  }
  status() {
    return {
      ...this.store.status(),
      journals: journalDailyStatus(this.store),
    };
  }
  personality(action, args = {}) {
    return personality(
      this.store,
      action,
      args,
      this.config.enablePersonalityLearning === true,
    );
  }
  journal(readingId, raw) {
    const reading = this.store.reading(readingId);
    const body = noteBody(raw, reading);
    return this.store.tx(() => {
      const existing = this.store.db
        .prepare(
          "SELECT id FROM notes WHERE reading_id=? AND body=? ORDER BY created,id LIMIT 1",
        )
        .get(readingId, JSON.stringify(body));
      if (existing) {
        verifyInbox(this.store);
        return {
          id: existing.id,
          readingId,
          status: "local_reviewable_draft",
          path: join(this.store.root, "inbox.md"),
          deduplicated: true,
        };
      }
      const created = new Date().toISOString();
      // 与插入在同一个 BEGIN IMMEDIATE 事务里：并发/重试都不会让第 3 条挤进来。
      enforceJournalDailyLimit(this.store, created);
      if (this.store.getControl("inbox:index-hash")) verifyInbox(this.store);
      const id = this.store.note(readingId, body, created);
      const path = exportInbox(this.store);
      return {
        id,
        readingId,
        status: "local_reviewable_draft",
        path,
        deduplicated: false,
      };
    });
  }
  inbox(args = {}) {
    return readInbox(this.store, args);
  }
  exportInbox() {
    return this.store.tx(() => exportInbox(this.store));
  }
  importLocal(readingId, raw) {
    return this.task(async (_network, budget) => {
      // raw 从宿主/本地文件来，先把形状钉死；route 只允许 A3（抽帧腿已移除）。
      need(raw && typeof raw === "object" && !Array.isArray(raw), "INVALID_LOCAL_IMPORT");
      const r = this.store.reading(readingId);
      need(["A3"].includes(raw.route), "INVALID_ROUTE");
      need(raw.duration === r.duration, "DURATION_MISMATCH");
      budget.spend("asr", raw.duration);
      const segs = segments(raw.segments, r.duration, raw.route);
      need(segs.length > 0, "EMPTY_LOCAL_SOURCE");
      return this.store.saveReading({
        ...r,
        route: raw.route,
        segments: segs,
        coverage: {
          ...coverage(segs, r.duration),
          state: "asr_partial",
        },
        localEvidence:
          "User/host supplied import; content not independently verified.",
        cached: false,
      });
    });
  }
  memory(action, id = "", body = null) {
    need(["list", "put", "delete"].includes(action), "INVALID_MEMORY_ACTION");
    if (action === "put") {
      need(
        body && ["self", "user"].includes(body.subject),
        "THIRD_PARTY_PROFILE_DENIED",
      );
      need(
        Object.keys(body).every((k) =>
          [
            "subject",
            "understanding",
            "evidence",
            "uncertainty",
            "next_response",
          ].includes(k),
        ),
        "INVALID_MEMORY_FIELD",
      );
      for (const key of [
        "understanding",
        "evidence",
        "uncertainty",
        "next_response",
      ])
        text(body[key] || "");
      need(body.understanding && body.evidence, "MEMORY_EVIDENCE_REQUIRED");
    }
    return this.store.memory(action, id, body);
  }
  close() {
    if (this.closing) return;
    this.closing = true;
    for (const controller of this.active) controller.abort();
    if (this.active.size === 0) this.store.close();
  }
}
export function readingView(reading, offset = 0) {
  need(
    Number.isInteger(offset) &&
      offset >= 0 &&
      offset <= reading.segments.length,
    "INVALID_OFFSET",
  );
  const chosen = [];
  let length = 0;
  for (const segment of reading.segments.slice(offset)) {
    if (length + segment.text.length > 16000 && chosen.length) break;
    chosen.push(segment);
    length += segment.text.length;
    if (length >= 16000) break;
  }
  return {
    ...reading,
    segments: chosen,
    segment_count: reading.segments.length,
    next_offset:
      offset + chosen.length < reading.segments.length
        ? offset + chosen.length
        : null,
    source_text_partial: offset > 0 || chosen.length < reading.segments.length,
  };
}
export { safeError };
