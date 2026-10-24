import { Fault, need } from "../reading/errors.mjs";

// 默认上限：每天 2 条（humanism 的老规矩）。人类可在 learning.dailyNotes 里改：
//   > 0 = 每天最多几条；**0 = 不限**（2026-10-25 主人要求取消上限）。
// 这里只留"默认值"，真正的额度由调用方（Service）从配置里传进来。
export const JOURNAL_DAILY_LIMIT = 2;
const timeZone = "Asia/Shanghai";
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** limit：>0 = 每天最多几条；0 / 假值 / 非数字 = 不限（统一归一化成 0）。 */
function normalizeLimit(limit) {
  const n = Math.floor(Number(limit));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Call inside the same BEGIN IMMEDIATE transaction as Store.note().
// Deriving usage from committed journal rows preserves it across restarts,
// and a rolled-back insert does not consume a separate counter or reservation.
export function journalDailyStatus(
  store,
  at = Date.now(),
  limit = JOURNAL_DAILY_LIMIT,
) {
  const instant = new Date(at);
  need(Number.isFinite(instant.getTime()), "INVALID_JOURNAL_CLOCK");
  const date = dayFormat.format(instant);
  // Shanghai uses UTC+08:00 for current journal dates. SQLite interprets
  // stored ISO timestamps before applying the offset, including UTC midnight.
  const used = store.db
    .prepare(
      "SELECT count(*) AS n FROM notes WHERE date(created, '+8 hours')=?",
    )
    .get(date).n;
  const cap = normalizeLimit(limit);
  return {
    date,
    timeZone,
    used,
    limit: cap, // 0 = 不限
    // 不限时用 null 而不是 Infinity：这个对象会进 JSON（`--json` 与
    //   /dsh-bili/api/learn-status），Infinity 序列化成 null，反而看不出来是"不限"。
    remaining: cap > 0 ? Math.max(0, cap - used) : null,
  };
}
export function enforceJournalDailyLimit(
  store,
  at = Date.now(),
  limit = JOURNAL_DAILY_LIMIT,
) {
  need(store.db.isTransaction === true, "JOURNAL_TRANSACTION_REQUIRED");
  const budget = journalDailyStatus(store, at, limit);
  if (budget.limit > 0 && budget.used >= budget.limit)
    throw new Fault(
      "JOURNAL_DAILY_LIMIT",
      `At most ${budget.limit} journal(s) may be saved per Asia/Shanghai date (learning.dailyNotes, 0 = unlimited). Read existing journals and select meaningful encounters; daily output is optional.`,
    );
  return budget;
}
