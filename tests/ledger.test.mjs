// ledger-core 的离线测试：每日上限 / 人格札记 / 收件箱导出 / CLI 退出码。
//
// 全部合成数据（没有真实视频 ID、没有真实账号、没有网络请求），
// 每个用例自建 mkdtemp 目录并在结束后清理，不读写 ~/.dsh 或 ~/.bili-ai。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Service } from "../lib/reading/service.mjs";
import {
  JOURNAL_DAILY_LIMIT,
  journalDailyStatus,
} from "../lib/ledger/journal-policy.mjs";

const ROOT = join(import.meta.dirname, "..");
const BVID = "BV1Aa41xx7Zz"; // 合成占位符（不是真实视频）

const dirs = [];
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "myilidepu-ledger-"));
  dirs.push(root);
  return root;
}
after(() => {
  for (const root of dirs) rmSync(root, { recursive: true, force: true });
});

// 一条落账用的合成 reading：journal 只要求存在这条记录，不要求真的看过。
function seedReading(service, over = {}) {
  return service.store.saveReading({
    bvid: BVID,
    page: 1,
    cid: 7,
    title: "合成测试：一个木工的一天",
    author: "合成UP",
    url: "https://www.bilibili.com/video/" + BVID,
    duration: 60,
    route: "A1",
    segments: [{ start: 0, end: 60, text: "合成字幕", source: "A1" }],
    coverage: {
      state: "partial",
      timed_seconds: 60,
      duration_seconds: 60,
      timed_fraction: 1,
      missing: "synthetic",
    },
    attempts: [],
    ...over,
  });
}

// noteBody 要求 encounter + missing 必填、evidence 是数组；revision 用来测人格摘句。
const note = (i, revision = "认真对待木头的人，也会认真对待时间。") => ({
  encounter: `合成见闻 ${i}：遇到一个认真做木工的人（虚构，不是真实人物）`,
  missing: `合成第 ${i} 条的未知：不知道他失败的那些次`,
  revision,
  evidence: [],
});

const journalReady = (root) => {
  const service = new Service({ dataDir: join(root, "myilidepu") });
  const reading = seedReading(service);
  const first = service.journal(
    reading.id,
    note(1, "认真对待木头的人，也会认真对待时间。"),
  );
  const second = service.journal(
    reading.id,
    note(2, "看见别人失败，才明白耐心是练出来的。"),
  );
  return { service, reading, first, second };
};

// CLI 用真实子进程跑，验证退出码/输出流契约（这是契约里最容易漂移的部分）。
function runCli(root, file, args, overrides = {}) {
  return spawnSync(process.execPath, [join(ROOT, "tools", "commands", file), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      // 把 HOME/DSH_HOME 钉在临时目录：CLI 的 dataDir = $DSH_HOME/myilidepu。
      DSH_HOME: root,
      USERPROFILE: root,
      HOME: root,
      MYILIDEPU_CONFIG: join(root, "missing-config.json"),
      ...overrides,
    },
  });
}

test("见闻上限：2 条/天在同一事务内生效，第 3 条失败且不留行", () => {
  const root = makeRoot();
  const { service, reading, first, second } = journalReady(root);
  try {
    assert.equal(first.deduplicated, false);
    assert.equal(second.deduplicated, false);
    assert.equal(JOURNAL_DAILY_LIMIT, 2);
    assert.throws(
      () => service.journal(reading.id, note(3)),
      (e) => e.code === "JOURNAL_DAILY_LIMIT",
    );
    const count = service.store.db
      .prepare("SELECT count(*) AS n FROM notes")
      .get().n;
    assert.equal(count, 2);
    const daily = journalDailyStatus(service.store);
    assert.equal(daily.used, 2);
    assert.equal(daily.remaining, 0);
    assert.equal(daily.timeZone, "Asia/Shanghai");
    // 同一条内容重试要复用旧 id，不占新额度（journal 的身份去重）。
    const retry = service.journal(
      reading.id,
      note(1, "认真对待木头的人，也会认真对待时间。"),
    );
    assert.equal(retry.deduplicated, true);
    assert.equal(retry.id, first.id);
    assert.equal(
      service.store.db.prepare("SELECT count(*) AS n FROM notes").get().n,
      2,
    );
  } finally {
    service.close();
  }
});

test("人格札记：pick 后 show 能读到，maxChars 会截断", () => {
  const root = makeRoot();
  const { service, first, second } = journalReady(root);
  try {
    assert.equal(existsSync(join(service.store.root, "human-world.md")), false);
    const picked = service.personality("select", {
      journalId: first.id,
      sentence: "认真对待木头的人",
    });
    assert.equal(picked.status, "selected");
    assert.equal(picked.journalId, first.id);
    const file = join(service.store.root, "human-world.md");
    assert.equal(existsSync(file), true);
    assert.match(readFileSync(file, "utf8"), /认真对待木头的人/);

    const shown = service.personality("read", {});
    assert.equal(shown.total, 1);
    assert.equal(shown.entries[0].sentence, "认真对待木头的人");
    assert.match(shown.text, /认真对待木头的人/);
    assert.ok(!shown.truncated);

    // maxChars 只影响返回文本长度，不改变已落盘的札记。
    const cut = service.personality("read", { maxChars: 6 });
    assert.equal(cut.text.length, 6);
    assert.equal(cut.truncated, true);

    // 2026-10-23：不再限制每天条数 —— 同一天可以接着写第二条（原来是 PERSONALITY_DAY_ALREADY_SELECTED）。
    const secondPick = service.personality("select", {
      journalId: second.id,
      sentence: "看见别人失败，才明白耐心是练出来的。",
    });
    assert.equal(secondPick.status, "selected");
    assert.equal(secondPick.date, picked.date);
    assert.equal(secondPick.dayCount, 2);

    const two = service.personality("read", {});
    assert.equal(two.total, 2);
    // 同一天的多条合在一个 `## <date>` 小节里，不重复日期标题。
    const mdNow = readFileSync(file, "utf8");
    assert.equal((mdNow.match(new RegExp(`^## ${picked.date}$`, "gm")) || []).length, 1);
    assert.match(mdNow, /认真对待木头的人/);
    assert.match(mdNow, /耐心是练出来的/);
    // 键位：第 1 条用老键（老数据不用迁移），第 2 条顺延到 :2。
    assert.equal(
      service.store.db
        .prepare("SELECT COUNT(*) AS n FROM control WHERE key = ? OR key = ?")
        .get(`personality:day:${picked.date}`, `personality:day:${picked.date}:2`).n,
      2,
    );

    // 同一条手账的同一句再写一次是幂等的：不报错、不重复落盘。
    const again = service.personality("select", {
      journalId: first.id,
      sentence: "认真对待木头的人",
    });
    assert.equal(again.status, "already_selected");
    assert.equal(service.personality("read", {}).total, 2);
  } finally {
    service.close();
  }
});

test("收件箱导出：结构完整、可校验、legacy 能读到全量", () => {
  const root = makeRoot();
  const { service } = journalReady(root);
  try {
    const path = service.exportInbox();
    assert.equal(path, join(service.store.root, "inbox.md"));
    const dataDir = service.store.root;
    for (const name of ["inbox.md", "inbox.html", "inbox-index.json"])
      assert.equal(existsSync(join(dataDir, name)), true, name + " 应该存在");

    const manifest = JSON.parse(
      readFileSync(join(dataDir, "inbox-index.json"), "utf8"),
    );
    assert.equal(manifest.version, 1);
    assert.equal(manifest.total, 2);
    assert.equal(manifest.snapshot.length, 64);
    assert.equal(manifest.records.length, 2);
    assert.equal(manifest.volumes.length, 1);
    assert.equal(manifest.volumes[0].count, 2);
    assert.equal(manifest.volumes[0].name, manifest.volumes[0].hash + ".md");
    assert.equal(
      existsSync(join(dataDir, "inbox-parts", manifest.volumes[0].name)),
      true,
    );

    const index = service.inbox({ action: "index" });
    assert.equal(index.total, 2);
    assert.equal(index.volumeCount, 1);
    assert.equal(index.snapshot, manifest.snapshot);
    assert.equal(index.checks.fullEqualsIndex, true);
    assert.equal(index.checks.volumeSumEqualsIndex, true);

    const volume = service.inbox({ action: "volume", snapshot: index.snapshot, volume: 0 });
    assert.equal(volume.count, 2);
    assert.equal(volume.fragments.length, 2);
    assert.match(volume.text, /journal:/);
    assert.equal(volume.partial, false);

    const legacy = service.inbox();
    assert.equal(Array.isArray(legacy), true);
    assert.equal(legacy.length, 2);
    assert.ok(legacy.every((entry) => entry.body.encounter && entry.body.missing));
  } finally {
    service.close();
  }
});

test("CLI journal add：超过每日上限时退出码 3 且 stderr 带 JOURNAL_DAILY_LIMIT", () => {
  const root = makeRoot();
  const { service, first } = journalReady(root);
  service.close();
  const file = join(root, "note.json");
  writeFileSync(file, JSON.stringify(note(3)), "utf8");
  const run = runCli(root, "journal.mjs", [
    "add",
    "--reading",
    first.readingId,
    "--file",
    file,
  ]);
  assert.equal(run.status, 3, run.stderr || run.stdout);
  assert.match(run.stderr, /JOURNAL_DAILY_LIMIT/);
  assert.equal(run.stdout.trim(), "");
});

test("CLI journal add：dailyNotes=0 = 不限，第 3 条也能写进去（2026-10-25 取消上限）", () => {
  const root = makeRoot();
  const { service, first } = journalReady(root);
  service.close();
  const cfg = join(root, "config.json");
  writeFileSync(cfg, JSON.stringify({ learning: { dailyNotes: 0 } }), "utf8");
  const file = join(root, "note.json");
  writeFileSync(file, JSON.stringify(note(4)), "utf8");
  const run = runCli(
    root,
    "journal.mjs",
    ["add", "--reading", first.readingId, "--file", file],
    { MYILIDEPU_CONFIG: cfg },
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const reopened = new Service({ dataDir: join(root, "myilidepu") });
  try {
    assert.equal(
      reopened.store.db.prepare("SELECT count(*) AS n FROM notes").get().n,
      3,
    );
  } finally {
    reopened.close();
  }
});

test("CLI journal add：recordNotes=false = 只读不记（exit 3，不是故障）", () => {
  const root = makeRoot();
  const { service, first } = journalReady(root);
  service.close();
  const cfg = join(root, "config.json");
  writeFileSync(
    cfg,
    JSON.stringify({ learning: { recordNotes: false } }),
    "utf8",
  );
  const file = join(root, "note.json");
  writeFileSync(file, JSON.stringify(note(5)), "utf8");
  const run = runCli(
    root,
    "journal.mjs",
    ["add", "--reading", first.readingId, "--file", file],
    { MYILIDEPU_CONFIG: cfg },
  );
  assert.equal(run.status, 3, run.stderr || run.stdout);
  assert.match(run.stderr, /JOURNAL_RECORDING_OFF/);
  assert.equal(run.stdout.trim(), "");
});

test("见闻额度：journalDailyLimit=0 = 不限（第 3 条写得进去，remaining 是 null 不是 Infinity）", () => {
  const root = makeRoot();
  const { service, reading } = journalReady(root); // 已按默认额度写满 2 条
  service.close();
  const open = new Service({
    dataDir: join(root, "myilidepu"),
    journalDailyLimit: 0,
  });
  try {
    const before = open.status().journals;
    assert.equal(before.limit, 0);
    assert.equal(before.used, 2);
    assert.equal(before.remaining, null);
    // JSON 里也必须是 null：Infinity 会被序列化成 null，但那是"坏值被吞"，
    //   不如这里显式断言序列化前后一致。
    assert.equal(JSON.parse(JSON.stringify(before)).remaining, null);
    const third = open.journal(reading.id, note(9));
    assert.equal(third.deduplicated, false);
    assert.equal(
      open.store.db.prepare("SELECT count(*) AS n FROM notes").get().n,
      3,
    );
  } finally {
    open.close();
  }
});

test("见闻额度：journalDailyLimit=1 时超额的条目在同一事务内被拒", () => {
  const root = makeRoot();
  const { service, reading } = journalReady(root); // 账本里已有 2 条 → 已超 1 条的额度
  service.close();
  const open = new Service({
    dataDir: join(root, "myilidepu"),
    journalDailyLimit: 1,
  });
  try {
    assert.throws(
      () => open.journal(reading.id, note(9)),
      (e) => e.code === "JOURNAL_DAILY_LIMIT",
    );
    assert.equal(
      open.store.db.prepare("SELECT count(*) AS n FROM notes").get().n,
      2,
    );
  } finally {
    open.close();
  }
});

test("CLI personality pick：默认 dry-run 不写 human-world.md", () => {
  const root = makeRoot();
  const { service, first } = journalReady(root);
  service.close();
  const run = runCli(root, "personality.mjs", [
    "pick",
    "--journal",
    first.id,
    "--sentence",
    "认真对待木头的人",
  ]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /dry-run/);
  assert.equal(existsSync(join(root, "myilidepu", "human-world.md")), false);
});

test("CLI personality pick：默认不限条数，同一天可以写第二条（--go 两次都成）", () => {
  const root = makeRoot();
  const { service, first, second } = journalReady(root);
  service.close();
  // MYILIDEPU_CONFIG 指向不存在的文件 → 全部走默认值，pickPerDay 默认为 0 = 不限 ✓
  const one = runCli(root, "personality.mjs", [
    "pick", "--journal", first.id, "--sentence", "认真对待木头的人", "--go",
  ]);
  assert.equal(one.status, 0, one.stderr || one.stdout);
  assert.match(one.stdout, /这天第 1 条/);
  const two = runCli(root, "personality.mjs", [
    "pick", "--journal", second.id, "--sentence", "看见别人失败，才明白耐心是练出来的。", "--go",
  ]);
  assert.equal(two.status, 0, two.stderr || two.stdout);
  assert.match(two.stdout, /这天第 2 条/);
  const reopened = new Service({ dataDir: join(root, "myilidepu") });
  try {
    assert.equal(reopened.personality("read", {}).total, 2);
  } finally {
    reopened.close();
  }
});

test("CLI personality pick：pickPerDay=1 时才卡（exit 3 + PERSONALITY_DAILY_LIMIT）", () => {
  const root = makeRoot();
  const { service, first, second } = journalReady(root);
  service.close();
  const cfg = join(root, "config.json");
  writeFileSync(cfg, JSON.stringify({ personality: { pickPerDay: 1 } }), "utf8");
  const one = runCli(
    root,
    "personality.mjs",
    ["pick", "--journal", first.id, "--sentence", "认真对待木头的人", "--go"],
    { MYILIDEPU_CONFIG: cfg },
  );
  assert.equal(one.status, 0, one.stderr || one.stdout);
  const two = runCli(
    root,
    "personality.mjs",
    ["pick", "--journal", second.id, "--sentence", "看见别人失败，才明白耐心是练出来的。", "--go"],
    { MYILIDEPU_CONFIG: cfg },
  );
  assert.equal(two.status, 3, two.stderr || two.stdout);
  assert.match(two.stderr, /PERSONALITY_DAILY_LIMIT/);
  const reopened = new Service({ dataDir: join(root, "myilidepu") });
  try {
    assert.equal(reopened.personality("read", {}).total, 1);
  } finally {
    reopened.close();
  }
});
