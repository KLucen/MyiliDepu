// reading-core 的离线测试：路由选择 / 覆盖率 / 预算熔断 / 凭据 fail-closed。
//
// 全部用合成数据 + 注入的假 fetcher（Service 构造函数的 dependencies.fetcher），
// 不联网、不碰真实视频 ID、不读写 ~/.dsh 或 ~/.bili-ai。
// 每个用例有自己的 mkdtemp 目录，结束统一清理。
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Service, readingView } from "../lib/reading/service.mjs";
import { coverage } from "../lib/reading/reader.mjs";

const BVID = "BV1Aa41xx7Zz"; // 合成占位符（非真实视频）
const DURATION = 8;

const roots = [];
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "myilidepu-reading-"));
  roots.push(root);
  return root;
}
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const credentials = (root) => {
  const path = join(root, "credentials.json");
  // 合成登录态：只验证"有凭据时 A2 会走、不是真实账号"。
  writeFileSync(path, JSON.stringify({ sessdata: "synthetic-sessdata" }), "utf8");
  return path;
};

// 假响应：network.mjs 需要 status / headers.get / 异步 body 迭代器。
function respond(payload) {
  const data = Buffer.from(JSON.stringify(payload));
  return {
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      yield data;
    })(),
  };
}

const WBI = (fill) => "https://i0.hdslb.com/bfs/wbi/" + fill.repeat(64) + ".png";

/**
 * 假 B 站。只认 reading 链路需要的 4 个读接口 + 字幕 CDN。
 * options 里可以关掉字幕轨迹 / 官方总结，用来测降级与失败路径。
 */
function makeFetcher(options = {}) {
  const calls = [];
  const state = {
    title: "合成测试：一个木工的一天",
    tracks: [
      {
        lan: "ai-zh",
        subtitle_url: "https://aisubtitle.hdslb.com/bfs/ai_subtitle/synthetic.json",
      },
    ],
    subtitle: [
      { from: 0, to: 4, content: "合成字幕一" },
      { from: 4, to: 8, content: "合成字幕二" },
    ],
    conclusion: [{ start_timestamp: 0, end_timestamp: 6, content: "合成官方总结" }],
    ...options,
  };
  const fetcher = async (u) => {
    const path = u.pathname;
    const host = u.hostname;
    calls.push({ host, path, headers: {} });
    if (path === "/x/web-interface/view")
      return respond({
        code: 0,
        data: {
          title: state.title,
          duration: DURATION,
          owner: { name: "合成UP", mid: 42 },
          pages: [{ page: 1, cid: 7, duration: DURATION }],
        },
      });
    if (path === "/x/player/wbi/v2")
      return respond({ code: 0, data: { subtitle: { subtitles: state.tracks } } });
    if (path === "/x/web-interface/nav")
      return respond({
        code: 0,
        data: { wbi_img: { img_url: WBI("a"), sub_url: WBI("b") } },
      });
    if (path === "/x/web-interface/view/conclusion/get")
      return respond({
        code: 0,
        data: { model_result: { subtitle: [{ part_subtitle: state.conclusion }] } },
      });
    if (host === "aisubtitle.hdslb.com") return respond({ body: state.subtitle });
    throw new Error("unexpected URL in synthetic fetcher: " + u.href);
  };
  return { fetcher, calls };
}

// 每个用例都自己显式构造 Service：不同用例的凭据/限额不同，抽公共工厂反而更绕。

test("A1 路由：字幕可用时走字幕，不请求官方总结", async () => {
  const root = makeRoot();
  const { fetcher, calls } = makeFetcher();
  const service = new Service(
    { dataDir: join(root, "ledger"), credentialPath: credentials(root) },
    { fetcher },
  );
  try {
    const { result } = await service.read(BVID, 1);
    assert.equal(result.route, "A1");
    assert.equal(result.title, "合成测试：一个木工的一天");
    assert.equal(result.duration, DURATION);
    assert.deepEqual(
      result.segments.map((s) => s.text),
      ["合成字幕一", "合成字幕二"],
    );
    assert.equal(result.segments[0].source, "A1");
    // 覆盖率：0-4 + 4-8 = 8s / 8s，但没有画面与语气，状态只能是 partial。
    assert.equal(result.coverage.state, "partial");
    assert.equal(result.coverage.timed_seconds, 8);
    assert.equal(result.coverage.timed_fraction, 1);
    // 字幕命中时不该再多花请求去取 A2。
    assert.ok(!calls.some((c) => c.path.endsWith("/conclusion/get")));
    assert.deepEqual(
      calls.map((c) => c.path),
      ["/x/web-interface/view", "/x/player/wbi/v2", "/bfs/ai_subtitle/synthetic.json"],
    );
    assert.equal(result.attempts.find((a) => a.route === "A1").state, "text_available");
  } finally {
    service.close();
  }
});

test("A2 路由：字幕缺失时退官方总结（需要凭据）", async () => {
  const root = makeRoot();
  const { fetcher, calls } = makeFetcher({ tracks: [] });
  const service = new Service(
    { dataDir: join(root, "ledger"), credentialPath: credentials(root) },
    { fetcher },
  );
  try {
    const { result } = await service.read(BVID, 1);
    assert.equal(result.route, "A2");
    assert.deepEqual(
      result.segments.map((s) => s.text),
      ["合成官方总结"],
    );
    assert.equal(result.segments[0].source, "A2");
    assert.deepEqual(
      calls.map((c) => c.path),
      [
        "/x/web-interface/view",
        "/x/player/wbi/v2",
        "/x/web-interface/nav",
        "/x/web-interface/view/conclusion/get",
      ],
    );
    // 官方总结只是摘要：attempts 里必须写清楚它不是逐字稿。
    const a2 = result.attempts.find((a) => a.route === "A2");
    assert.equal(a2.state, "text_available");
    assert.match(a2.note, /not a transcript/);
  } finally {
    service.close();
  }
});

test("A3 路由：A1/A2 都没有时 importLocal 可用，之后的 read 复用本地原文", async () => {
  const root = makeRoot();
  const { fetcher } = makeFetcher({ tracks: [], conclusion: [] });
  const service = new Service(
    { dataDir: join(root, "ledger"), credentialPath: credentials(root) },
    { fetcher },
  );
  try {
    const first = await service.read(BVID, 1);
    assert.equal(first.result.route, "none");
    assert.equal(first.result.segments.length, 0);
    assert.equal(first.result.coverage.state, "no_subtitles");
    assert.ok(
      first.result.attempts.some(
        (a) => a.route === "A3" && a.state === "local_import_available",
      ),
    );

    const imported = await service.importLocal(first.result.id, {
      route: "A3",
      duration: DURATION,
      segments: [
        { from: 0, to: 4, text: "本地导入的原文一" },
        { from: 4, to: 8, text: "本地导入的原文二" },
      ],
    });
    assert.equal(imported.result.route, "A3");
    assert.equal(imported.result.coverage.state, "asr_partial");
    assert.equal(imported.result.segments.length, 2);
    assert.match(imported.result.localEvidence, /not independently verified/);

    // 再 read 时命中"本地原文复用"，而不是把空结果当成功。
    const again = await service.read(BVID, 1);
    assert.equal(again.result.route, "A3");
    assert.equal(again.result.reusedLocalSource, true);
    assert.equal(again.result.segments.length, 2);
    assert.equal(again.result.deduplicated, true);
  } finally {
    service.close();
  }
});

test("coverage()：分段/时长覆盖率（含重叠与越界裁剪）", () => {
  // 重叠段不能重复计入；超出视频时长的部分要裁掉。
  const segs = [
    { start: 0, end: 10, text: "a" },
    { start: 5, end: 20, text: "b" },
    { start: 90, end: 110, text: "c" },
    { start: 0, end: null, text: "无结束时间，不计入时间轴" },
  ];
  const partial = coverage(segs, 100);
  assert.equal(partial.state, "partial");
  assert.equal(partial.timed_seconds, 30); // 0-20 + 90-100
  assert.equal(partial.duration_seconds, 100);
  assert.equal(partial.timed_fraction, 0.3);
  assert.equal(partial.speech, "unknown");
  assert.match(partial.note, /not evidence of no speech/i);

  const empty = coverage([], 100);
  assert.equal(empty.state, "no_subtitles");
  assert.equal(empty.timed_seconds, 0);
  assert.equal(empty.timed_fraction, 0);
});

test("预算熔断：请求数上限在发请求前生效", async () => {
  const root = makeRoot();
  const { fetcher, calls } = makeFetcher();
  const service = new Service(
    { dataDir: join(root, "ledger"), credentialPath: credentials(root), limits: { requests: 1 } },
    { fetcher },
  );
  try {
    await assert.rejects(
      () => service.read(BVID, 1),
      (e) => e.code === "REQUESTS_BUDGET",
    );
    // 第 2 次请求（player）在预算检查处就被拒绝，所以只发出 1 个请求。
    assert.equal(calls.length, 1);
  } finally {
    service.close();
  }
});

test("预算熔断：墙钟上限（0ms）时一个请求都不发", async () => {
  const root = makeRoot();
  const { fetcher, calls } = makeFetcher();
  const service = new Service(
    { dataDir: join(root, "ledger"), credentialPath: credentials(root), limits: { wallMs: 0 } },
    { fetcher },
  );
  try {
    await assert.rejects(
      () => service.read(BVID, 1),
      (e) => e.code === "WALL_BUDGET",
    );
    assert.equal(calls.length, 0);
  } finally {
    service.close();
  }
});

test("字符上限：readingView 单页最多 16000 字符，可分页取完", () => {
  const reading = {
    segments: [
      { start: 0, end: 10, text: "甲".repeat(9000), source: "A1" },
      { start: 10, end: 20, text: "乙".repeat(9000), source: "A1" },
    ],
  };
  const first = readingView(reading, 0);
  assert.equal(first.segments.length, 1);
  assert.equal(first.next_offset, 1);
  assert.equal(first.source_text_partial, true);
  const second = readingView(reading, first.next_offset);
  assert.equal(second.segments.length, 1);
  assert.equal(second.next_offset, null);
  assert.equal(second.segment_count, 2);
  // 单段本身就超过上限时也要能取到（不能死循环）。
  const huge = readingView({ segments: [{ text: "丙".repeat(20000) }] }, 0);
  assert.equal(huge.segments.length, 1);
  assert.equal(huge.next_offset, null);
});

test("凭据缺失时 fail-closed：返回错误码且不发任何请求", async () => {
  const root = makeRoot();
  const { fetcher, calls } = makeFetcher();
  const service = new Service(
    { dataDir: join(root, "ledger"), credentialPath: join(root, "no-such-credentials.json") },
    { fetcher },
  );
  try {
    await assert.rejects(
      () => service.read(BVID, 1),
      (e) => e.code === "CREDENTIAL_INVALID",
    );
    assert.equal(calls.length, 0);
    // 也不能静默成功：账本里没有这条 reading，且状态里记了暂停原因。
    assert.equal(service.store.readings().length, 0);
    assert.equal(service.status().pause.reason, "CREDENTIAL_INVALID");
  } finally {
    service.close();
  }
});

test("route 腿限制：subtitle 无字幕报 SUBTITLE_UNAVAILABLE；conclusion 无凭据报 CREDENTIAL_REQUIRED", async () => {
  const root = makeRoot();
  const { fetcher } = makeFetcher({ tracks: [] });
  const service = new Service({ dataDir: join(root, "ledger") }, { fetcher });
  try {
    await assert.rejects(
      () => service.read(BVID, 1, undefined, "subtitle"),
      (e) => e.code === "SUBTITLE_UNAVAILABLE",
    );
    await assert.rejects(
      () => service.read(BVID, 1, undefined, "conclusion"),
      (e) => e.code === "CREDENTIAL_REQUIRED",
    );
  } finally {
    service.close();
  }
});

test("route local：只落元数据，等 importLocal 提供 A3 原文", async () => {
  const root = makeRoot();
  const { fetcher, calls } = makeFetcher();
  const service = new Service(
    { dataDir: join(root, "ledger"), credentialPath: credentials(root) },
    { fetcher },
  );
  try {
    const local = await service.read(BVID, 1, undefined, "local");
    assert.equal(local.result.route, "none");
    assert.equal(local.result.segments.length, 0);
    // local 腿不试 A1/A2：只请求了元数据。
    assert.deepEqual(calls.map((c) => c.path), ["/x/web-interface/view"]);
    assert.ok(
      local.result.attempts.some(
        (a) => a.route === "A3" && a.state === "awaiting_local_import",
      ),
    );
    const imported = await service.importLocal(local.result.id, {
      route: "A3",
      duration: DURATION,
      segments: [{ from: 0, to: DURATION, text: "全片本地原文" }],
    });
    assert.equal(imported.result.route, "A3");
    const again = await service.read(BVID, 1, undefined, "local");
    assert.equal(again.result.route, "A3");
    assert.equal(again.result.reusedLocalSource, true);
  } finally {
    service.close();
  }
});
