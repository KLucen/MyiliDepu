// reading-core 的门面：把「人类可调的配置」接到 Service 上，供 CLI（tools/commands/）
// 与宿主半边共用。
//
// 为什么要有这一层：Service 本身只管账本与网络，不读配置文件；而路径语义必须与
// whale 完全一致（$DSH_HOME、~/.bili-ai/credentials.json 是**同一个人**的），
// 所以配置来源统一收敛在这里 —— tools/lib/config.mjs（唯一配置来源）+
// tools/lib/paths.mjs（唯一路径来源，DSH_HOME 优先于 ~/.dsh）。
//
// v1.0 只保留：读原文 → 落账 → 人格 → 收件箱。
// 因此不设 limits（沿用 Service 的安全默认）与 pythonPath（已无 Python 依赖）。
import { existsSync } from "node:fs";
import { Service } from "./service.mjs";
import { Fault } from "./errors.mjs";
import { config } from "../../tools/lib/config.mjs";
import { credentialsPath, dshPath } from "../../tools/lib/paths.mjs";

let service = null;

/**
 * 登录态：直接复用 whale 那一份 ~/.bili-ai/credentials.json（两个插件不分叉）。
 *
 * 为什么"文件不存在"返回 "" 而不是硬塞路径：没登录过不是故障 —— whale 的读取
 * 本来就允许匿名（A1 字幕能读），humanism 默认也是匿名；A2 官方总结需要登录态时，
 * reader 会明确报 CREDENTIAL_REQUIRED，而不是假装读到了。只有"文件存在但不可用"
 * （坏 JSON / disabled / sessdata 非法）才 fail-closed：Network 抛 CREDENTIAL_INVALID
 * 并暂停账本，避免拿着坏凭据继续请求。
 */
function readingCredentialPath() {
  return existsSync(credentialsPath) ? credentialsPath : "";
}

/** 惰性单例：同一个进程只开一份 SQLite 账本（重复 open 会撞 TASK_BUSY）。 */
export function getService() {
  if (service) return service;
  const learning = config().learning ?? {};
  service = new Service({
    // 数据目录与合并契约一致：$DSH_HOME/myilidepu（whale 的 DSH_HOME 语义）
    dataDir: dshPath("myilidepu"),
    // 登录态直接复用 whale 那一份，两个插件不分叉
    // （paths.mjs 里 credentialsPath 是算好的路径值，不是函数）
    credentialPath: readingCredentialPath(),
    maxSessionTokens: learning.maxSessionTokens,
  });
  return service;
}

/** 关掉账本（CLI 命令结束时必须调；宿主进程生命周期内不需要）。 */
export function closeService() {
  if (!service) return;
  service.close();
  service = null;
}

/** 把任意异常收敛成 CLI 可用的形状；Fault 的 code 必须原样保留。 */
export function failure(error) {
  const code =
    error instanceof Fault
      ? error.code
      : typeof error?.code === "string"
        ? error.code
        : "INTERNAL_ERROR";
  const message =
    error instanceof Fault
      ? error.message
      : String(error?.message || error || "未知错误").slice(0, 300);
  return { ok: false, code, message };
}

/**
 * 在单例 Service 上跑一段命令逻辑。
 * 成功 → { ok: true, value }；失败 → { ok: false, code, message }（不吞 code，
 * 例如 JOURNAL_DAILY_LIMIT 要靠它决定退出码 3）。
 */
export async function runCommand(fn) {
  try {
    return { ok: true, value: await fn(getService()) };
  } catch (error) {
    return failure(error);
  }
}

export { Fault };
