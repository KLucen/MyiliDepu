// 凭据类旧锁的自动开锁 + `bili unban` 两把锁一起开（2026-10-26）
//
// 事故：主人的 cookie 过期 → B站 回 -101 → 账本被 `store.pause('API_-101')` 锁死。
//   主人在设置页换完 cookie，**锁还在**：她只能干看着，还在私信里塞给主人一段
//     node --input-type=module -e "… new Store('D:/MyDepu') … s.resume() …"
//   长命令让主人手动开锁 ✗
//
// 这里钉住两条：
//   ① 凭据类的锁，在凭据文件比锁新时**自动开**；没动过凭据就保持锁（不然会白撞一次）
//   ② 风控类的锁**绝不自动开**（那是 B站 还在生气，自动开等于替她硬闯）
//   ③ `bili unban` 真子进程：账本锁与风控闸门一起清（主人只需要记一条命令）
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Store } from "../lib/reading/store.mjs";
import { Service } from "../lib/reading/service.mjs";
import {
  CREDENTIAL_PAUSE_REASONS,
  describePause,
  healStaleCredentialPause,
  isCredentialPause,
  isRiskPause,
} from "../lib/reading/pause-heal.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const BILI = join(REPO, "tools", "bili.mjs");

const roots = [];
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "myilidepu-pause-"));
  roots.push(root);
  return root;
}
after(() => {
  // Windows 上 sqlite 句柄没关就删目录会 EPERM —— 清理失败不影响结论，别让它把测试判红 ✗
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* 留给系统临时目录自己回收 */
    }
  }
});

/** 假 store：只实现 pause-heal 用到的两个方法，用来钉纯逻辑。 */
function fakeStore(pause) {
  let cur = pause ?? null;
  return {
    getControl: () => cur,
    resume: () => {
      cur = null;
    },
    peek: () => cur,
  };
}

const PAUSE_AT = Date.parse("2026-10-26T12:32:02.845Z");

test("凭据类的锁 + cookie 比锁新 → 自动开", () => {
  const store = fakeStore({ reason: "API_-101", at: PAUSE_AT });
  const r = healStaleCredentialPause(store, "X:/credentials.json", {
    stat: () => ({ mtimeMs: PAUSE_AT + 22 * 60 * 1000 }),
  });
  assert.equal(r.cleared, true);
  assert.equal(r.why, "cleared");
  assert.equal(store.peek(), null);
});

test("凭据类的锁 + 主人没动过 cookie → 保持锁（不然立刻再撞一次）", () => {
  const store = fakeStore({ reason: "API_-101", at: PAUSE_AT });
  const r = healStaleCredentialPause(store, "X:/credentials.json", {
    stat: () => ({ mtimeMs: PAUSE_AT - 1000 }),
  });
  assert.equal(r.cleared, false);
  assert.equal(r.why, "credential-not-newer");
  assert.notEqual(store.peek(), null);
});

test("风控类的锁 + cookie 比锁新 → 绝不自动开", () => {
  for (const reason of ["HTTP_412", "API_-352", "API_-509", "NON_JSON_CHALLENGE"]) {
    const store = fakeStore({ reason, at: PAUSE_AT });
    const r = healStaleCredentialPause(store, "X:/credentials.json", {
      stat: () => ({ mtimeMs: PAUSE_AT + 99999 }),
    });
    assert.equal(r.cleared, false, reason + " 不该被自动开");
    assert.equal(r.why, "not-credential");
    assert.notEqual(store.peek(), null);
  }
});

test("没有锁 / 凭据文件读不到 → 什么都不做，也不抛", () => {
  assert.equal(healStaleCredentialPause(fakeStore(null), "X:/nope.json").why, "no-pause");
  const store = fakeStore({ reason: "CREDENTIAL_INVALID", at: PAUSE_AT });
  const r = healStaleCredentialPause(store, "X:/nope.json", {
    stat: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(r.cleared, false);
  assert.equal(r.why, "credential-missing");
});

test("分类与话术：-101 指向 cookie，412 指向风控，都提到 bili unban", () => {
  for (const r of CREDENTIAL_PAUSE_REASONS) assert.equal(isCredentialPause(r), true, r);
  assert.equal(isRiskPause("HTTP_412"), true);
  assert.equal(isRiskPause("API_-352"), true);
  assert.equal(isRiskPause("API_-101"), false);
  const cred = describePause({ reason: "API_-101", at: PAUSE_AT });
  assert.match(cred, /cookie/);
  assert.match(cred, /bili unban/);
  const risk = describePause({ reason: "HTTP_412", at: PAUSE_AT });
  assert.match(risk, /风控/);
  assert.equal(describePause(null), "没有锁 ✓");
});

test("真 Store：锁写进去、开锁后真的没了", () => {
  const root = makeRoot();
  const store = new Store(join(root, "ledger"));
  store.setControl("pause", { reason: "API_-101", at: PAUSE_AT });
  const credPath = join(root, "credentials.json");
  writeFileSync(credPath, JSON.stringify({ sessdata: "synthetic" }), "utf8");
  // 真实 stat：把凭据文件的 mtime 拨到锁之后
  const later = new Date(PAUSE_AT + 60_000);
  utimesSync(credPath, later, later);
  assert.ok(statSync(credPath).mtimeMs > PAUSE_AT, "前置条件：凭据比锁新");
  const r = healStaleCredentialPause(store, credPath);
  assert.equal(r.cleared, true);
  assert.equal(store.getControl("pause"), null);
});

// 假响应：network.mjs 需要 status / headers.get / 异步 body 迭代器
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

test("Service 层：陈旧凭据锁不该再挡住 candidates（而且真的被清掉）", async () => {
  const root = makeRoot();
  const store = new Store(join(root, "ledger"));
  store.setControl("pause", { reason: "API_-101", at: PAUSE_AT });
  const credPath = join(root, "credentials.json");
  writeFileSync(credPath, JSON.stringify({ sessdata: "synthetic-sessdata" }), "utf8");
  const later = new Date(PAUSE_AT + 60_000);
  utimesSync(credPath, later, later);

  const fetcher = async (u) => {
    if (u.pathname === "/x/web-interface/nav")
      return respond({ code: 0, data: { wbi_img: { img_url: WBI("a"), sub_url: WBI("b") } } });
    if (u.pathname === "/x/web-interface/popular")
      return respond({
        code: 0,
        data: {
          list: [
            {
              bvid: "BV1Aa41xx7Zz",
              title: "合成：一条新片",
              owner: { name: "合成UP" },
              duration: 60,
              pubdate: Math.floor(PAUSE_AT / 1000),
            },
          ],
        },
      });
    throw new Error("unexpected URL: " + u.href);
  };
  const service = new Service({ dataDir: join(root, "ledger"), credentialPath: credPath }, { fetcher });
  const { result } = await service.candidates(1);
  assert.equal(result.length, 1);
  assert.equal(result[0].bvid, "BV1Aa41xx7Zz");
  assert.equal(store.getControl("pause"), null, "锁该被清掉");
});

test("bili unban（真子进程）：一条命令把账本锁清掉", () => {
  const root = makeRoot();
  const store = new Store(join(root, "ledger"));
  store.setControl("pause", { reason: "API_-101", at: PAUSE_AT });
  const env = {
    ...process.env,
    MYILIDEPU_DATA_DIR: join(root, "ledger"),
    USERPROFILE: join(root, "home"),
    HOME: join(root, "home"),
    DSH_HOME: join(root, "dsh"),
  };
  const out = execFileSync(process.execPath, [BILI, "unban", "--json"], {
    cwd: REPO,
    env,
    encoding: "utf8",
  });
  const j = JSON.parse(out);
  assert.equal(j.ok, true);
  assert.equal(j.ledger.readable, true);
  assert.equal(j.ledger.cleared, true);
  assert.equal(j.ledger.before.reason, "API_-101");
  const after = new Store(join(root, "ledger")).getControl("pause");
  assert.equal(after, null, "子进程真的要写进库，不能只打印");
});

test("bili unban status（真子进程）：只看不动，锁还在", () => {
  const root = makeRoot();
  new Store(join(root, "ledger")).setControl("pause", { reason: "HTTP_412", at: PAUSE_AT });
  const env = {
    ...process.env,
    MYILIDEPU_DATA_DIR: join(root, "ledger"),
    USERPROFILE: join(root, "home"),
    HOME: join(root, "home"),
    DSH_HOME: join(root, "dsh"),
  };
  const out = execFileSync(process.execPath, [BILI, "unban", "status", "--json"], {
    cwd: REPO,
    env,
    encoding: "utf8",
  });
  const j = JSON.parse(out);
  assert.equal(j.ledger.readable, true);
  assert.equal(j.ledger.pause.reason, "HTTP_412");
  assert.notEqual(new Store(join(root, "ledger")).getControl("pause"), null, "status 不许改状态");
});
