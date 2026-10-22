// tests/client-paths.test.mjs —— 设置页配置读写的「路径写法」回归（2026-10-23 事故）
//
// 事故：模型区的字段用点号字符串调用 pick("model.enabled")，而 setPath 只认数组，
//   字符串被逐字符拆开写进 cfg.m.o.d.e.l["."]… → cfg.model 永远不存在，
//   表现是「用指定模型」那个勾**怎么点都勾不上**，provider / 模型 / 推理档选了也白选。
//
// 这个测试不启动浏览器：直接把 lib/client.js 里 toPath / getPath / setPath 那一段
// 真实源码抽出来在 vm 里跑，再拿**源码里真实出现过的所有 pick("…") 路径**逐个验证。
// 源码被重构到找不到这段时，测试会直接失败提醒，而不是静默放过。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function loadHelpers() {
  const start = SRC.indexOf("const toPath");
  const end = SRC.indexOf("const normalizeHealth");
  assert.ok(start > 0, "lib/client.js 里找不到 const toPath —— 路径归一化被移走了？");
  assert.ok(end > start, "lib/client.js 里找不到 const normalizeHealth —— 代码块边界变了？");
  const code = SRC.slice(start, end);
  // 用 runInThisContext + IIFE：同一个 realm（deepStrictEqual 才不会被跨 realm 原型绊倒），
  // 也不往全局塞 const（重复加载会 SyntaxError）。
  return vm.runInThisContext(`(function(){${code}\nreturn { toPath, getPath, setPath };})()`);
}

const { toPath, getPath, setPath } = loadHelpers();

test("toPath：数组原样、点号字符串拆段", () => {
  assert.deepEqual(toPath(["a", "b"]), ["a", "b"]);
  assert.deepEqual(toPath("model.enabled"), ["model", "enabled"]);
  assert.deepEqual(toPath("a.b.c"), ["a", "b", "c"]);
  assert.deepEqual(toPath("solo"), ["solo"]);
});

test("setPath：点号字符串写到正确的层级（本次事故的核心）", () => {
  const o = {};
  setPath(o, "model.enabled", true);
  assert.deepEqual(o, { model: { enabled: true } });
  assert.equal(o.model.enabled, true);
  // 反向断言：绝不能再出现被逐字符拆开的单字母键
  assert.equal(Object.keys(o).includes("m"), false);
});

test("setPath：数组写法不受影响（FIELDS 那一套）", () => {
  const o = {};
  setPath(o, ["model", "enabled"], true);
  assert.deepEqual(o, { model: { enabled: true } });
  const p = {};
  setPath(p, ["night", "windows", 0, "wakes"], 3);
  assert.deepEqual(p, { night: { windows: [{ wakes: 3 }] } });
});

test("getPath：两种写法都能读", () => {
  const o = { model: { provider: "tencent", enabled: false } };
  assert.equal(getPath(o, "model.provider"), "tencent");
  assert.equal(getPath(o, ["model", "provider"]), "tencent");
  assert.equal(getPath(o, "model.nope.deep"), undefined);
  assert.equal(getPath(undefined, "model"), undefined);
});

test("中间层被覆盖成非对象时会重建，不会抛错", () => {
  const o = { model: "坏了" };
  setPath(o, "model.enabled", true);
  assert.deepEqual(o, { model: { enabled: true } });
});

test("源码里每个 pick(\"…\") 路径都真的落到了顶层首段（防止再写错写法）", () => {
  const paths = [...SRC.matchAll(/pick\(\s*"([^"]+)"\s*,/g)].map((m) => m[1]);
  assert.ok(paths.length >= 6, `期望至少 6 个 pick(\"…\") 调用点，实际 ${paths.length} 个`);
  for (const path of paths) {
    const o = {};
    setPath(o, path, 1);
    assert.deepEqual(Object.keys(o), [path.split(".")[0]], `${path} 写歪了：顶层键成了 ${Object.keys(o)}`);
    assert.equal(getPath(o, path), 1, `${path} 写完读不回来`);
  }
});
