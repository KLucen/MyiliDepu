/**
 * 模型 id 的"验真 + 兜底"（2026-11-04）。
 *
 * 为什么需要它：provider 里的模型 id 会变（例如 `deepseek-v4.1-flash` 改名成
 * `deepseek-v4.1-flash-1017`），而**她那个会话里存的还是旧 id**。
 * 症状是每次醒来都在起跑线上摔死：
 *
 *   pi-ai provider "tencent" has no configured model "deepseek-v4.1-flash"
 *   code: UNKNOWN_MODEL
 *
 * 而且**不重启不会自愈**：她那轮的 `prompt()` 直接被拒，日记/学习/分享一条都没跑，
 * 主人只能看到"这几天什么都没发生"，日志里连原因都不显眼。
 *
 * 这里只放**纯函数**（不碰 ctx、不发请求），这样两个用法都能测：
 *   ① 醒来前："我配的那个模型还在吗？" → 不在就换成同一 provider 的第一个可用模型
 *   ② 醒来时真撞上 UNKNOWN_MODEL → 从错误里抠出 provider/model，换一个再试一次
 */

/** 从宿主报错里抠 provider / model（两种文案都认）。 */
export function parseUnknownModel(message) {
  const text = String(message ?? '')
  // pi-ai provider "tencent" has no configured model "deepseek-v4.1-flash"
  let m = text.match(/provider\s+"([^"]+)"\s+has no configured model\s+"([^"]+)"/i)
  if (m) return { provider: m[1], model: m[2], code: 'UNKNOWN_MODEL' }
  // 兜底：只说了 provider 的写法
  m = text.match(/provider\s+"([^"]+)"\s+has no configured model/i)
  if (m) return { provider: m[1], model: '', code: 'UNKNOWN_MODEL' }
  // 另一种常见文案：unknown model "x" for provider "y"
  m = text.match(/unknown model\s+"([^"]+)"[^"]*provider\s+"([^"]+)"/i)
  if (m) return { provider: m[2], model: m[1], code: 'UNKNOWN_MODEL' }
  return null
}

/** 宿主报错是不是"模型 id 不认识"这一类（只有这一类值得重试）。 */
export function isUnknownModelError(message) {
  const text = String(message ?? '')
  if (/UNKNOWN_MODEL/i.test(text)) return true
  if (/has no configured model/i.test(text)) return true
  if (/unknown model/i.test(text) && /provider/i.test(text)) return true
  return false
}

/** 把宿主给的 provider 列表整成 [{id, models:[id,…]}]（脏数据一律丢掉，不抛）。 */
export function normalizeProviders(providers) {
  const out = []
  for (const p of Array.isArray(providers) ? providers : []) {
    const id = String(p?.id ?? p?.provider ?? '').trim()
    if (!id) continue
    const models = []
    for (const raw of Array.isArray(p?.models) ? p.models : []) {
      const mid = String(typeof raw === 'string' ? raw : raw?.id ?? '').trim()
      if (mid && !models.includes(mid)) models.push(mid)
    }
    out.push({ id, models })
  }
  return out
}

/**
 * 挑一个**确实存在**的模型。
 *
 * 优先级刻意是这个顺序（同 provider 优先 —— 换 provider 等于换凭据，很可能直接没 key）：
 *   ① 点名的那对（provider + model）还在        → 原样用，healed:false
 *   ② provider 还在，只是 model 没了            → 用**同一 provider** 的第一个模型
 *   ③ provider 也没了，但别的 provider 有这个 model → 跟着那个 model 走
 *   ④ 全都没有                                  → 第一个有模型可用的 provider
 *   ⑤ 一个能用的都没有                          → null（调用方别硬试）
 *
 * @returns {{provider:string, model:string, healed:boolean, reason:string}|null}
 */
export function pickValidModel(providers, wanted = {}) {
  const list = normalizeProviders(providers)
  const wantProvider = String(wanted?.provider ?? '').trim()
  const wantModel = String(wanted?.model ?? '').trim()

  if (wantProvider) {
    const p = list.find((x) => x.id === wantProvider)
    if (p) {
      if (wantModel && p.models.includes(wantModel)) {
        return { provider: p.id, model: wantModel, healed: false, reason: '配置的模型还在' }
      }
      if (p.models.length) {
        return {
          provider: p.id,
          model: p.models[0],
          healed: true,
          reason: wantModel
            ? `provider ${p.id} 里已经没有 "${wantModel}"，换成它现在有的 "${p.models[0]}"`
            : `没指定模型，用 provider ${p.id} 的第一个 "${p.models[0]}"`,
        }
      }
      // provider 在但一个模型都没有 → 往下走，看别处有没有
    }
  }

  if (wantModel) {
    const hit = list.find((x) => x.models.includes(wantModel))
    if (hit) {
      return {
        provider: hit.id,
        model: wantModel,
        healed: true,
        reason: `provider "${wantProvider || '(未指定)'}" 不可用，但 "${wantModel}" 在 ${hit.id} 里有`,
      }
    }
  }

  const first = list.find((x) => x.models.length)
  if (first) {
    return {
      provider: first.id,
      model: first.models[0],
      healed: true,
      reason: `"${wantProvider || '(未指定)'}/${wantModel || '(未指定)'}" 一个都不存在，兜底用 ${first.id}/${first.models[0]}`,
    }
  }
  return null
}

/** 一句话说清"这次换没换、为什么"（写日志/回设置页都用它）。 */
export function describePick(pick) {
  if (!pick) return '没有可用模型（宿主的模型目录是空的）'
  const tag = pick.provider + '/' + pick.model
  return pick.healed ? `${tag}（已自动换：${pick.reason}）` : `${tag}（${pick.reason}）`
}
