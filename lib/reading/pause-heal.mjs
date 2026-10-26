/**
 * 「凭据类的锁，主人修好了就该自动开」（2026-10-26 加）
 *
 * 起因：主人的 cookie 过期 → B站 回 `-101`（账号未登录）→ 账本被 `store.pause("API_-101")`
 * 锁死。主人随后在设置页更新了 cookie，**锁却还在**：她只能干看着，
 * 最后在私信里塞给主人一段
 *   node --input-type=module -e "… new Store('D:/MyDepu') … s.resume() …"
 * 这种长命令 —— 这不是主人该做的事，也不该由她来教。
 *
 * 两条原则：
 *   ① **凭据类的锁**（凭据坏 / 未登录 / 权限不足）在凭据文件比锁更新时，自动开；
 *      —— 凭据都换了，还拿旧锁拦着毫无道理。
 *   ② **风控类的锁**（HTTP_412 / API_-352 / API_-509）绝不自动开：
 *      那不是"主人修好了什么"，而是 B站 还在生气，自动开等于替她硬闯 ✗
 *
 * 只有"凭据文件 mtime 晚于 pause.at"才自动开：主人没动过凭据就说明问题还在，
 * 这时候开锁只会让她立刻再撞一次，然后把锁重新戴上（白跑一趟 + 多一次请求）。
 */
import { statSync } from "node:fs";

/** 凭据类的暂停原因（B站 的码表：-101 未登录 / -400 请求错误 / -403 权限不足）。 */
export const CREDENTIAL_PAUSE_REASONS = [
  "CREDENTIAL_INVALID",
  "CREDENTIAL_DISABLED",
  "API_-101",
  "API_-400",
  "API_-403",
];

/** 风控类的暂停原因（**不自动开**，只能等退避或主人手动 `bili unban`）。 */
export const RISK_PAUSE_REASONS = [
  "HTTP_412",
  "HTTP_429",
  "API_-352",
  "API_-509",
  "API_-799",
  "NON_JSON_CHALLENGE",
  "API_CHALLENGE",
];

export const isCredentialPause = (reason) =>
  CREDENTIAL_PAUSE_REASONS.includes(String(reason ?? ""));

export const isRiskPause = (reason) =>
  RISK_PAUSE_REASONS.includes(String(reason ?? "")) ||
  String(reason ?? "").startsWith("HTTP_") ||
  String(reason ?? "").startsWith("API_-3") ||
  String(reason ?? "").startsWith("API_-5") ||
  String(reason ?? "").startsWith("API_-7");

/** 把锁的原因翻成人话（设置页 / `bili unban` / `bili selftest` 共用）。 */
export function describePause(pause) {
  if (!pause) return "没有锁 ✓";
  const reason = String(pause.reason ?? "?");
  const at = pause.at ? new Date(pause.at).toISOString() : "?";
  if (isCredentialPause(reason)) {
    const why =
      reason === "API_-101"
        ? "B站 说「账号未登录」—— cookie 过期了"
        : reason === "API_-400"
          ? "B站 说请求不对——多半也是 cookie 不完整"
          : reason === "API_-403"
            ? "B站 说权限不足——cookie 缺权限字段"
            : "读不到她的登录凭据";
    return `${why}（${reason}，锁于 ${at}）→ 去设置页更新 cookie；更新完跑 bili unban 一刀开`;
  }
  if (isRiskPause(reason)) {
    return `被 B站 风控拦下（${reason}，锁于 ${at}）→ 先跑 bili unban 放行，再放慢节奏`;
  }
  return `被锁住（${reason}，锁于 ${at}）→ 跑 bili unban 可以立刻开`;
}

/**
 * 凭据类锁的自动开锁。**只读一下就返回结果，不做网络请求。**
 *
 * @returns {{cleared: boolean, why: string, pause?: object|null, credAt?: number|null}}
 *   why: no-pause | not-credential | credential-missing | credential-not-newer | cleared | keep
 */
export function healStaleCredentialPause(
  store,
  credentialPath,
  { stat = statSync, now = Date.now } = {},
) {
  const pause = store.getControl("pause");
  if (!pause) return { cleared: false, why: "no-pause", pause: null };
  if (!isCredentialPause(pause.reason))
    return { cleared: false, why: "not-credential", pause };
  let credAt = null;
  try {
    credAt = stat(credentialPath).mtimeMs;
  } catch {
    return { cleared: false, why: "credential-missing", pause };
  }
  const at = Number(pause.at) || 0;
  if (!(credAt > at)) return { cleared: false, why: "credential-not-newer", pause, credAt };
  store.resume();
  return { cleared: true, why: "cleared", pause, credAt, at: now() };
}
