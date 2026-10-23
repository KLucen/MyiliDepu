/**
 * dsh-myilidepu —— 客户端半边：DSH「设置」里的 **我的分身** section（合并版：whale 的设置面 + humanism 的学习面）
 *
 * 历史（2026-10-18）：
 *   v1 只放了 6 个字段（owner/persona/作息窗口）→ 主人说"和微信端讲的不一样" ✗。
 *   真因：宿主半边那份独立页面 `settings.html` 有 25 个字段，但它被 DSH 的信任栅栏挡着打不开 ✗，
 *        而 section 是我另写的精简版 ✗ → 两套界面、一个配置，看着像两个插件。
 *   v2（本文件）：把那 25 个字段**按同一份配置结构**搬进 section ✓；渲染改成**数据驱动**
 *                （FIELDS 是唯一真相；加字段只改这个数组 ✓）。
 *
 * 数据流：section ⇄ `/dsh-bili/api/*`（同源 fetch ✓）⇄ `~/.dsh/myilidepu.config.json`
 *         —— 与 bilibili-tools 的 `lib/config.mjs` 读**同一份文件** ✓，不存在"两套配置"。
 *         ⚠️ 保存时提交**整份配置**（load 回来原样改几个键）→ 未显示的字段不会被抹掉 ✓
 */
window.__ModuleLoader__.load({
  id: "dsh-myilidepu",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { createElement: h, useCallback, useEffect, useState } = React;

    const API = "/dsh-bili/api";
    const CSS_TAG = "dsh-myilidepu/section.css";
    const CSS = [
      ".blw{max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:6px}",
      ".blw-title{margin:0;font-size:16px;font-weight:500;line-height:24px}",
      ".blw-intro{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:13px;line-height:20px}",
      ".blw-group{margin-top:14px;font-size:13px;font-weight:600;line-height:20px}",
      ".blw-rows{display:flex;flex-direction:column}",
      ".blw-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px 20px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}",
      ".blw-row:last-child{border-bottom:none}",
      ".blw-row>div:first-child{flex:1;min-width:190px}",
      ".blw-label{font-size:13px;line-height:19px}",
      ".blw-hint{color:var(--dsw-alias-label-tertiary);margin-top:3px;font-size:11.5px;line-height:17px}",
      ".blw-input,.blw-select{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:28px;padding:0 8px;min-width:180px;outline:none}",
      ".blw-input:focus-visible,.blw-select:focus-visible{border-color:var(--dsw-alias-brand-primary)}",
      ".blw-input.blw-wide{min-width:260px}",
      ".blw-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l2)}",
      ".blw-btn{background:var(--dsw-alias-brand-primary);color:#fff;border:none;border-radius:6px;font-size:12.5px;height:30px;padding:0 12px;cursor:pointer}",
      ".blw-btn:disabled{opacity:.5;cursor:default}",
      ".blw-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}",
      ".blw-out{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;max-height:240px;overflow:auto;margin-top:10px}",
      ".blw-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin-top:8px;white-space:pre-line}",
      ".blw-hint.blw-pre{white-space:pre-line}",
      ".blw-badge{display:inline-block;font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary);margin-left:6px}",
      ".blw-cookie{display:flex;flex-direction:column;gap:8px;min-width:250px}",
      // 2026-10-22（合并 humanism）：配置体检横幅 + 风险提示 —— 只复用现有 CSS 变量，不引入任何框架 ✓
      ".blw-health{display:flex;flex-direction:column;gap:5px;border:1px solid var(--dsw-alias-border-l2);border-left-width:3px;border-radius:8px;padding:9px 12px;font-size:12px;line-height:18px;margin:2px 0 10px}",
      ".blw-health.blw-health-bad{background:rgba(255,77,79,.08);border-left-color:var(--dsw-alias-state-error-primary)}",
      ".blw-health.blw-health-warn{background:rgba(255,176,32,.10);border-left-color:#ffb020}",
      ".blw-health.blw-health-info{background:rgba(64,140,255,.09);border-left-color:#4a9eff}",
      ".blw-health-head{font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
      ".blw-health-bad .blw-health-head{color:var(--dsw-alias-state-error-primary)}",
      ".blw-health-warn .blw-health-head{color:#ffb020}",
      ".blw-health-info .blw-health-head{color:#4a9eff}",
      ".blw-health-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;word-break:break-all;color:var(--dsw-alias-label-secondary)}",
      ".blw-health details{font-size:11.5px;line-height:17px}",
      ".blw-health summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}",
      ".blw-health pre{margin:6px 0 0;padding:8px;border-radius:6px;background:rgba(127,127,127,.08);white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;max-height:180px;overflow:auto}",
      ".blw-health-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
      ".blw-risk{color:#ffb020}",
      ".blw-badge.blw-badge-risk{background:rgba(255,176,32,.16);color:#ffb020}",
    ].join("");

    // ── 唯一真相：字段清单（加字段只改这里 ✓）────────────────────────────
    //   kind: text | number | list（逗号分隔数组）| switch | select
    const FIELDS = [
      { group: "工具链", path: ["home"], label: "专用会话目录", hint: "已存在目录的绝对路径；留空用默认目录。重启后新建会话生效，已有会话不迁移", kind: "text", wide: true },
      { group: "日记与推送", path: ["listen", "mentionSummary"], label: "主人 @ 请求总结", hint: "默认关闭。开启后处理主人含总结/摘要/概括的新 @，通过消息推送通道发送", kind: "switch" },
      { group: "作息", path: ["night", "minGapMin"], label: "最小唤醒间隔（分钟）", hint: "默认 10；窗口放不下就少醒几次", kind: "number" },
      { group: "她是谁", path: ["persona", "name"], label: "角色名", hint: "她怎么被称呼", kind: "text" },
      { group: "她是谁", path: ["persona", "ownerTitle"], label: "她怎么称呼你", hint: "例如「主人」", kind: "text" },
      { group: "她是谁", path: ["persona", "selfClaim"], label: "她怎么自称", hint: "例如「我」/「人家」", kind: "text" },

      { group: "你（主人）", path: ["owner", "mid"], label: "主人 mid", hint: "用来认「谁回过她 / 谁点了赞」", kind: "text" },
      { group: "你（主人）", path: ["owner", "name"], label: "主人昵称", hint: "@ 分享时写进正文", kind: "text" },
      { group: "你（主人）", path: ["self", "mid"], label: "她自己 mid", hint: "只读（来自 cookie）", kind: "text", readOnly: true },
      { group: "你（主人）", path: ["self", "name"], label: "她自己昵称", hint: "只读（来自 nav）", kind: "text", readOnly: true },

      { group: "作息", path: ["night", "skipChance"], label: "今晚不看的概率", hint: "0.3 = 三成", kind: "number" },
      { group: "作息", path: ["night", "maxVideos"], label: "单次醒来观看视频数量", hint: "初筛的候选数；筛完再挑 2–3 条深读", kind: "number" },

      { group: "口味", path: ["preferences", "like"], label: "爱看", hint: "逗号分隔", kind: "list" },
      { group: "口味", path: ["preferences", "dislike"], label: "不爱看", hint: "逗号分隔", kind: "list" },
      // 2026-10-23 主人要求「只看 2026 年 9 月之后发布的视频」。
      //   空 = 不限；填 2026-09-01 = 只看这一天（含）之后发布的。
      //   同时管两条通路：她自己的选题（feed）与学习候选（candidates）✓
      //   拿不到发布日期的条目会被当成「不确定」丢掉，但条数会念出来（不静默）✓
      { group: "口味", path: ["preferences", "publishedAfter"], label: "只看这天之后发布的视频", hint: "形如 2026-09-01；空 = 不限。填错会当场报错，不会静默失效", kind: "text" },

      { group: "日记与推送", path: ["diary", "push"], label: "推送日记摘要", hint: "关掉 = 她照写两本日记，但不推给你（日记本身不能关 ✓）", kind: "switch" },

      { group: "工具链", path: ["toolsPath"], label: "工具目录", hint: "留空 = 用插件自带的 tools/ 或开发目录", kind: "text", wide: true },
      // 2026-10-23：数据目录可搬家（默认 C:\Users\<你>\.dsh\myilidepu）
      //   搬家后：两本日记 / 见闻账本 / 抽帧 / 读过的原文 / 状态 JSON / 她的会话工作区全跟着走 ✓
      //   ⚠️ 改完要重启 DSH；重启前旧目录还在用（不会丢数据，但新内容会写回旧目录）
      { group: "工具链", path: ["paths", "dataDir"], label: "数据目录", hint: "留空 = 默认 $DSH_HOME/myilidepu。填绝对路径（例 D:\\MyDepu）可把她的全部数据搬家；改完要重启 DSH", kind: "text", wide: true },

      // ── 合并 dsh-bili-humanism 新增四组（2026-10-22 · 契约 docs/06 §5）──────────
      //   这里只描述「怎么渲染」；**默认值与合法范围以 tools/lib/config.mjs 的 DEFAULTS 为准**，
      //   页面拿的是后端 /dsh-bili/api/settings 返回的合并后配置 —— 前端不再另抄一份默认值 ✓
      //   （min/max 是给输入框夹边界用的，对应 config.mjs 里那几组字段的真实范围）
      { group: "学习", path: ["learning", "enabled"], label: "学习（读人类世界）", hint: "关掉 = 她醒来只刷 B 站看片，不再读原文、也不再记见闻。", kind: "switch" },
      { group: "学习", path: ["learning", "everyWake"], label: "每次醒来都先学", hint: "开启 = 每次醒来先读一条再去看片；关掉 = 攒够一天的见闻再集中读。", kind: "switch" },
      { group: "学习", path: ["learning", "dailyNotes"], label: "每天见闻条数", hint: "每天最多记几条见闻；账本硬上限是 2 条，0 = 只读不记。", kind: "number", min: 0, max: 2, step: 1 },
      { group: "学习", path: ["learning", "candidates"], label: "候选条数", hint: "每次挑素材时给几个候选让她自己选；越多越费请求，上限 3 个。", kind: "number", min: 1, max: 3, step: 1 },
      { group: "学习", path: ["learning", "route"], label: "读原文走哪条路", hint: "强制只用一种读法：字幕 / 官方总结 / 本地导入；auto = 自动挑能用的那条。", kind: "select", options: [
        { value: "auto", label: "auto（自动挑一条能用的）" },
        { value: "subtitle", label: "subtitle（字幕）" },
        { value: "conclusion", label: "conclusion（官方总结）" },
        { value: "local", label: "local（本地导入）" },
      ] },

      { group: "人格", path: ["personality", "enabled"], label: "长人格", hint: "关掉 = 不再从见闻里提炼人格札记，她停止「长大」。", kind: "switch" },
      { group: "人格", path: ["personality", "inject"], label: "唤醒时带上人格", hint: "开启 = 每次唤醒把她最近的想法带进提示词；关掉 = 只写不读。", kind: "switch" },
      { group: "人格", path: ["personality", "maxChars"], label: "注入字数上限", hint: "每次最多带多少字进提示词，调大会挤占这一轮能用的上下文。", kind: "number" },

      { group: "日记", path: ["diary", "private"], label: "私人日记", hint: "关掉 = 她不再写本地那本只有你能看的日记。", kind: "switch" },
      { group: "日记", path: ["diary", "public"], label: "公开日记（对外发布）", riskBadge: "⚠ 对外发布", warn: true, hint: "默认关。开启后她会在 B 站公开发日记，受每日额度与 --dry 预演约束（先预演、再真发）。", kind: "switch" },
      { group: "日记", path: ["diary", "publicVia"], label: "公开日记发到哪", hint: "发成一条 B 站动态，或发在视频评论区；只有「公开日记」开着时才真的执行。", kind: "select", options: [
        { value: "dynamic", label: "dynamic（B 站动态）" },
        { value: "comment", label: "comment（视频评论区）" },
      ] },
      // 注：diary.push 在旧「日记与推送」组里已经有一个控件（这次不动旧分组 ✓），
      //     这里是契约 §5 要求新「日记」组也列出 —— 两处写的是**同一个配置键**，值实时同步 ✓
      { group: "日记", path: ["diary", "push"], label: "写完推给你", hint: "关掉 = 她照写两本日记，但不把「给你的信」推送出去。", kind: "switch" },

      { group: "足迹", path: ["footprint", "mentionOwner"], label: "分享时 @ 你", hint: "关掉 = 她照样分享，但正文里不再 @ 你，只有自己知道。", kind: "switch" },
      // 注：同上 —— 与「分享」编辑器里的「每天上限」是同一个键（quota.shareDaily），两边实时同步 ✓
      { group: "足迹", path: ["quota", "shareDaily"], label: "每天最多分享几条", hint: "一天最多公开分享几条；调高会更容易被平台判定刷量。", kind: "number", min: 1, max: 10, step: 1 },
      { group: "足迹", path: ["share", "minScore"], label: "值得分享的分数线", hint: "视频打分低于这个数就不分享；调高 = 更挑，调低 = 更容易发。", kind: "number", min: 0, max: 20, step: 1 },
    ];

    // 2026-10-23：path 有两种写法 —— FIELDS 用数组 ["diary","push"]，模型区用点号字符串 "model.enabled"。
    //   以前这里直接当数组用，字符串会被**逐字符**拆开，结果写进 cfg.m.o.d.e.l["."]…，
    //   cfg.model 永远不存在 → 「用指定模型」那个勾永远勾不上、provider/模型/推理档选了也白选 ✗
    //   修法：只在 setPath/getPath 这一处归一化（唯一真相），两种写法都收 ✓
    const toPath = (path) => (Array.isArray(path) ? path : String(path).split("."));
    const getPath = (obj, path) => toPath(path).reduce((o, k) => (o == null ? undefined : o[k]), obj);
    const setPath = (obj, path, value) => {
      const segs = toPath(path);
      let cur = obj;
      for (let i = 0; i < segs.length - 1; i += 1) {
        const k = segs[i];
        if (cur[k] == null || typeof cur[k] !== "object") cur[k] = typeof segs[i + 1] === "number" ? [] : {};
        cur = cur[k];
      }
      cur[segs[segs.length - 1]] = value;
    };

    // ── 配置体检（2026-10-22）──────────────────────────────────────────────
    //   后端 /dsh-bili/api/settings 会在响应里带 health = configStatus()（tools/lib/config.mjs）：
    //     { path, ok, error, hadBom, migratedFrom, hasUserFile }
    //   含义：path = 实际读的文件；ok=false 时 error 是 JSON 语法错；hadBom = 文件带 UTF-8 BOM
    //        （已自动兼容但值得提示）；migratedFrom 非空 = 正在读旧版 bili-whale.config.json。
    //   这里只做「取出来 + 归一化」，缺失就返回 null → 横幅不渲染、页面不报错 ✓
    const normalizeHealth = (h) => {
      const err = h && h.error != null ? String(h.error) : "";
      return {
        path: h && typeof h.path === "string" ? h.path : "",
        // 有 error 才算坏；ok 缺失时按正常处理（不把「后端没给这个字段」误报成语法错 ✓）
        ok: !err && !(h && h.ok === false),
        error: err,
        hadBom: !!(h && h.hadBom),
        migratedFrom: h && typeof h.migratedFrom === "string" && h.migratedFrom ? h.migratedFrom : null,
        hasUserFile: !!(h && h.hasUserFile),
      };
    };
    const readHealth = (j) => {
      const src = j && typeof j === "object" ? j : {};
      const raw = (src.health && typeof src.health === "object" && src.health)
        || (src.configStatus && typeof src.configStatus === "object" && src.configStatus)
        || null;
      if (raw) return normalizeHealth(raw);
      // 兜底：宿主若直接把 config.mjs 的 config() 当 config 返回，体检字段会以 __ 前缀混在里面
      const c = src.config;
      if (c && typeof c === "object" && ("__configError" in c || "__hadBom" in c || "__migratedFrom" in c || "__configPath" in c)) {
        return normalizeHealth({
          path: c.__configPath,
          ok: c.__configError == null,
          error: c.__configError,
          hadBom: c.__hadBom,
          migratedFrom: c.__migratedFrom,
          hasUserFile: c.__hasUserFile,
        });
      }
      return null;
    };

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === "undefined") return;
        if (!document.getElementById(CSS_TAG)) {
          const el = document.createElement("style");
          el.id = CSS_TAG;
          el.textContent = CSS;
          document.head.appendChild(el);
        }
      }, []);
    }

    function Row({ f, cfg, set }) {
      const raw = getPath(cfg, f.path);
      const common = { className: "blw-input" + (f.wide ? " blw-wide" : "") };
      // 2026-10-18 修：list 字段以前"值 = 数组 join、改动 = split 回数组" ✗
      //   → 你一打逗号，join 立刻把它吞掉（输入框里根本打不出逗号 ✗）
      //   现在：本地文本 state 管显示 ✓ 数组只在解析时更新 ✓（逗号能打、末尾逗号也不会乱跳 ✓）
      const [listText, setListText] = useState(Array.isArray(raw) ? raw.join("，") : (raw ?? ""));
      useEffect(() => {
        setListText(Array.isArray(raw) ? raw.join("，") : (raw ?? ""));
      }, [JSON.stringify(raw ?? null)]);
      let control;
      if (f.kind === "list") {
        control = h("input", {
          ...common,
          value: listText,          // ← 显示用本地文本（逗号不会被吞 ✓）
          readOnly: !!f.readOnly,
          onChange: (e) => {
            const v = e.target.value;
            setListText(v);          // 先原样显示（中文逗号、英文逗号、末尾逗号都能打 ✓）
            // 再解析成数组写进配置（空项过滤掉，不会因为末尾逗号多出一个空串 ✓）
            set(f.path, v.split(/[,，]/).map((s) => s.trim()).filter(Boolean));
          },
        });
      } else if (f.kind === "number") {
        // 2026-10-22：合并新增的数值字段带 f.min / f.max（取自 config.mjs 的真实范围）→ 越界输入就地夹住 ✓
        //   旧字段没填 min/max，走到的分支与以前完全一样（step=any、不夹）✓
        control = h("input", { ...common, type: "number", step: f.step ?? "any",
          min: f.min, max: f.max, value: raw ?? "", readOnly: !!f.readOnly,
          onChange: (e) => {
            if (e.target.value === "") { set(f.path, undefined); return; }
            let v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            if (f.step === 1) v = Math.round(v);
            if (typeof f.min === "number") v = Math.max(f.min, v);
            if (typeof f.max === "number") v = Math.min(f.max, v);
            set(f.path, v);
          } });
      } else if (f.kind === "switch") {
        control = h("input", { type: "checkbox", checked: !!raw, disabled: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.checked) });
      } else if (f.kind === "select") {
        control = h("select", { className: "blw-select", value: raw ?? "", disabled: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.value) },
          f.options.map((o) => (typeof o === "string"
            ? h("option", { key: o, value: o }, o)
            : h("option", { key: o.value, value: o.value }, o.label ?? o.value))));
      } else {
        control = h("input", { ...common, value: raw ?? "", readOnly: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.value) });
      }
      return h("div", { className: "blw-row" },
        h("div", null,
          h("div", { className: "blw-label" }, f.label,
            f.readOnly ? h("span", { className: "blw-badge" }, "只读") : null,
            f.riskBadge ? h("span", { className: "blw-badge blw-badge-risk" }, f.riskBadge) : null),
          f.hint ? h("div", { className: "blw-hint" + (f.warn ? " blw-risk" : "") }, f.hint) : null),
        control);
    }

    // ── 作息窗口编辑器（2026-10-18 主人画的草图）─────────────────────────
    //   ①  07:00 – 09:00   （醒来 1 次）   [x]
    //   ②  17:00 – 18:00   （醒来 1 次）   [x]
    //   [ + 添加窗口 ]
    //   每个窗口自带"醒来几次"；保存时把总和写回 night.maxWakesPerDay（工具链读它 ✓）
    const NUMS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];
    function WindowsEditor({ cfg, set }) {
      const wins = getPath(cfg, ["night", "windows"]);
      const list = Array.isArray(wins) ? wins : [];
      const upd = (i, patch) => set(["night", "windows"], list.map((w, j) => (j === i ? { ...w, ...patch } : w)));
      const del = (i) => set(["night", "windows"], list.filter((_, j) => j !== i));
      const add = () => set(["night", "windows"], [...list, { start: "20:00", end: "22:00", wakes: 1 }]);
      const timeInput = (v, onChange) =>
        h("input", { className: "blw-input", style: { width: "86px", minWidth: "86px" }, value: v ?? "", onChange: (e) => onChange(e.target.value) });
      return h("div", null,
        h("div", { className: "blw-rows" },
          list.length === 0
            ? h("div", { className: "blw-hint" }, "（没有窗口 = 永远不醒；至少加一个）")
            : list.map((w, i) =>
                h("div", { className: "blw-row", key: i },
                  h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
                    h("span", { className: "blw-hint", style: { minWidth: "18px" } }, NUMS[i] ?? String(i + 1)),
                    timeInput(w.start, (v) => upd(i, { start: v })),
                    h("span", { className: "blw-hint" }, "–"),
                    timeInput(w.end, (v) => upd(i, { end: v })),
                    h("span", { className: "blw-hint" }, "醒来"),
                    h("input", { className: "blw-input", style: { width: "56px", minWidth: "56px" }, type: "number", min: 1,
                      value: w.wakes ?? 1, onChange: (e) => upd(i, { wakes: Number(e.target.value) || 1 }) }),
                    h("span", { className: "blw-hint" }, "次")),
                  h("button", { className: "blw-btn blw-btn2", disabled: list.length <= 1, onClick: () => del(i), title: "删掉这个窗口" }, "×"))),
        h("div", { style: { marginTop: "8px" } },
          h("button", { className: "blw-btn blw-btn2", onClick: add }, "+ 添加窗口"))));
    }

    // ── 开关行（复选框 + 说明）──────────────────────────────────────────
    function SwitchRow({ label, hint, value, onChange, disabled }) {
      return h("div", { className: "blw-row" },
        h("div", null,
          h("div", { className: "blw-label" }, label),
          hint ? h("div", { className: "blw-hint" }, hint) : null),
        h("input", { type: "checkbox", checked: !!value, disabled: !!disabled, onChange: (e) => onChange(e.target.checked) }));
    }

    // ── 【分享评论】（主动 @ 你）· 2026-10-18 主人给的排版 ────────────────
    function ShareEditor({ cfg, set }) {
      const s = cfg.share ?? {};
      const daily = cfg.quota?.shareDaily ?? 3;
      // 2026-10-19：分享方式二选一 —— comment=评论区公开 @ / dm=私信给你（必须带视频链接）
      const via = s.via === "dm" ? "dm" : "comment";
      const viaRadio = ([value, label, hint]) =>
        h("label", { key: value, style: { display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "10px", cursor: "pointer" } },
          h("input", { type: "radio", name: "blw-share-via", checked: via === value, style: { marginTop: "3px" }, onChange: () => set(["share", "via"], value) }),
          h("div", null,
            h("div", { className: "blw-label" }, label),
            h("div", { className: "blw-hint" }, hint)));
      return h("div", null,
        h("div", { className: "blw-group" }, "分享（主动告诉你 · 二选一）"),
        h("div", { className: "blw-rows" },
          h(SwitchRow, { label: "开启", hint: "关掉 = 她只看不说 ✓", value: s.enabled !== false, onChange: (v) => set(["share", "enabled"], v) }),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "分享方式（二选一）"),
              h("div", { className: "blw-hint" }, "只在「有值得分享的」时才发；一条都不值得就一条都不发 ✓")),
            h("div", null,
              viaRadio(["comment", "评论区 @ 你", "在视频评论区发一条带 @ 的公开评论 ✓（原功能 · 别人也看得到）"]),
              viaRadio(["dm", "B站私信", "不发公开评论 ✗ 直接把分享内容 + 视频链接私信给你 ✓（更干净 ✓ 需要互关 ✓）"]))),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "每天上限"),
              h("div", { className: "blw-hint" }, via === "dm"
                ? "私信：一天只锁定你一个收信人 ✓ 条数不限 ✓"
                : "同一视频 7 天内一次 · 只从「深读过的」里挑 · 调大时会弹警告")),
            h("input", { className: "blw-input", style: { width: "80px", minWidth: "80px" }, type: "number", min: 0,
              value: daily, onChange: (e) => set(["quota", "shareDaily"], Number(e.target.value)) }))));
    }

    // ── 【重点关注的 UP】（2026-10-23 主人要求：黑鸦Heya）────────────────────
    //   watchups 是对象数组，走不了 FIELDS 的 path（保存时会被写成字符串 ✗）→ 单独一个编辑器。
    //   一行一个：`昵称 | 汇报重点`（重点可省 = 他发什么都看）。解析/格式化是纯函数，能单测 ✓
    function formatWatchUps(list) {
      return (Array.isArray(list) ? list : [])
        .map((u) => (u && u.name ? (Array.isArray(u.topics) && u.topics.length ? `${u.name} | ${u.topics.join("、")}` : String(u.name)) : ""))
        .filter(Boolean)
        .join("\n");
    }
    function parseWatchUps(text) {
      const out = [];
      for (const raw of String(text ?? "").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const [namePart, topicPart] = line.split("|");
        const name = String(namePart ?? "").trim().replace(/^@+/, "");
        if (!name) continue;   // 只有主题没昵称的行丢掉：mid 查不到，留着也看不见 ✓
        const topics = String(topicPart ?? "").split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
        out.push({ name, topics });
      }
      return out;
    }
    function WatchUpsEditor({ cfg, set }) {
      return h("div", null,
        h("div", { className: "blw-group" }, "重点关注的 UP"),
        h("div", { className: "blw-rows" },
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "名单"),
              h("div", { className: "blw-hint" }, "一行一个：昵称 | 汇报重点（用、隔开，可省）。她**不会去点关注** ✓ —— 只按 mid 直接看他的投稿；命中重点的稿子排前面，at 你时也照这几条讲。")),
            h("textarea", { className: "blw-input", style: { width: "100%", minHeight: "68px" },
              value: formatWatchUps(cfg.watchups),
              placeholder: "黑鸦Heya | DeepSeek、国产大模型、codex",
              onChange: (e) => set(["watchups"], parseWatchUps(e.target.value)) }))))
    }

    // ── 【全天监听】（别人找她）· 2026-10-18 主人给的排版 ──────────────────
    function ListenEditor({ cfg, set }) {
      const L = cfg.listen ?? {};
      const mins = Math.max(1, Math.round((L.commentIntervalSec ?? 300) / 60));
      const sel = (value, options, onChange) =>
        h("select", { className: "blw-select", value, onChange: (e) => onChange(e.target.value) },
          options.map(([v, label]) => h("option", { key: v, value: v }, label)));
      const num = (value, onChange, w = "70px") =>
        h("input", { className: "blw-input", style: { width: w, minWidth: w }, type: "number", min: 0, value: value ?? "", onChange: (e) => onChange(Number(e.target.value)) });
      return h("div", null,
        h("div", { className: "blw-group" }, "全天监听（别人找她）"),
        h("div", { className: "blw-rows" },
          h(SwitchRow, { label: "评论区监听", hint: `每 ${mins} 分钟查一次「回复我的 / @我的」`, value: L.comment !== false, onChange: (v) => set(["listen", "comment"], v) }),
          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "查一次间隔（分钟）"),
              h("div", { className: "blw-hint" }, "别小于 1 分钟，免得像刷接口")),
            num(mins, (v) => set(["listen", "commentIntervalSec"], Math.max(60, v * 60)))),
          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "只回"), h("div", { className: "blw-hint" }, "哪种通知算「找她」")),
            sel(L.scope ?? "both", [["both", "直接回我的 + @我的"], ["reply", "只回直接回我的"]], (v) => set(["listen", "scope"], v))),
          h(SwitchRow, { label: "同一个人最多只回一条", hint: "30 天内只回一次同一人（默认开 ✓）", value: L.oncePerPerson !== false, onChange: (v) => set(["listen", "oncePerPerson"], v) }),
          h(SwitchRow, { label: "全天（我睡着时也回）", hint: "关掉 = 只在她醒着的窗口里回 ✓", value: !!L.allDay, onChange: (v) => set(["listen", "allDay"], v) }),

          h(SwitchRow, { label: "私信监听（只认主人）", value: !!L.dm, onChange: (v) => set(["listen", "dm"], v),
            hint: "每 20 秒看一次主人有没有给你发私信 —— 有就叫醒你，实时回 ✓ 他不说话就零开销 ✓" }),
          // 2026-10-23 主人要求：不要 20 秒轮询，改成「每次醒来先看一眼有没有私信，再去看视频」
          h(SwitchRow, { label: "醒来先看私信", value: !!L.dmWake, onChange: (v) => set(["listen", "dmWake"], v),
            hint: "每次生物钟醒来，第一件事先看主人有没有私信 → 有就直接回他；顺带把他说过的喜欢/不喜欢记进打分 ✓（和上面那条可以只开一个）" }),
          h(SwitchRow, { label: "直播间监听", hint: "蹲直播间弹幕里有没有叫她", value: !!L.live, onChange: (v) => set(["listen", "live"], v) }),
          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "直播间房间号"), h("div", { className: "blw-hint" }, "留空 = 不蹲直播")),
            h("input", { className: "blw-input", style: { width: "120px", minWidth: "120px" }, value: L.liveRoom ?? "", placeholder: "例如 12345", onChange: (e) => set(["listen", "liveRoom"], e.target.value) })),
          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "直播间只回"), h("div", { className: "blw-hint" }, "只回主人 = 观众的一律不理；只回艾特她的 = 只看有没有人叫她")),
            sel(L.liveScope ?? "owner", [["owner", "只回主人"], ["mention", "只回艾特她的"]], (v) => set(["listen", "liveScope"], v)))),
        h("div", { className: "blw-out" },
          "【风控护栏 · 不可关】撞到 12015 / 12051 / 10031 → 立刻停监听 + 报你\n" +
          "【权限说明 · 只读】这一轮只注册只读工具；「发评论」必须显式打开；\n不注册：上传视频、发动态、私信、抓全站"));
    }

    // ── 【待审核】（2026-10-18 主人选 B 档：她的回复先给你看，你点「发」才发）──────
    function PendingEditor() {
      const [items, setItems] = useState([]);
      const [busy, setBusy] = useState("");
      const [msg, setMsg] = useState("");

      const load = useCallback(async () => {
        try { const r = await fetch(`${API}/pending`, { headers: { accept: "application/json" } }); const j = await r.json(); setItems(j.items ?? []) } catch {}
      }, []);
      useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load]);

      const act = async (id, what) => {
        setBusy(id + what); setMsg("");
        try {
          const r = await fetch(`${API}/pending/${what}`, {
            method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ id }),
          });
          const j = await r.json().catch(() => ({}));
          setMsg(j.ok
            ? (what === "approve" ? `✓ 已发出${j.rpid ? " · rpid=" + j.rpid : ""}` : "✓ 已删掉（也记了一笔「否」✓）")
            : `✗ ${j.error ?? "失败"}`);
          await load();
        } catch (e) { setMsg("✗ " + e.message) } finally { setBusy("") }
      };

      return h("div", null,
        h("div", { className: "blw-group" }, "待审核" + (items.length ? `（${items.length} 条）` : "")),
        h("div", { className: "blw-hint", style: { marginTop: "2px" } }, "她回复别人之前，草稿先到这儿 —— 你点「发」才发 ✓（否掉也会记一笔，她会学着改 ✓）"),
        h("div", { className: "blw-rows" },
          items.length === 0
            ? h("div", { className: "blw-hint", style: { padding: "8px 0" } }, "（队列是空的 ✓）")
            : items.map((x) => h("div", { className: "blw-row", key: x.id },
              h("div", null,
                h("div", { className: "blw-label" }, `→ ${x.who || "对方"}`, h("span", { className: "blw-badge" }, String(x.at ?? "").slice(5, 16).replace("T", " "))),
                x.src ? h("div", { className: "blw-hint" }, `他说：${String(x.src).slice(0, 80)}`) : null,
                h("div", { className: "blw-hint", style: { color: "var(--dsw-alias-label-primary)", marginTop: "4px" } }, `你要回：${x.message}`)),
              h("div", { style: { display: "flex", gap: "6px" } },
                h("button", { className: "blw-btn", disabled: !!busy, onClick: () => act(x.id, "approve") }, busy === x.id + "approve" ? "发出中…" : "发"),
                h("button", { className: "blw-btn blw-btn2", disabled: !!busy, onClick: () => act(x.id, "reject") }, "删"))))),
        msg ? h("div", { className: msg.startsWith("✓") ? "blw-hint" : "blw-err" }, msg) : null);
    }

    // ── 【消息推送】（她看完一轮，把摘要送到哪）· 2026-10-18 主人给的排版 ──────
    function NotifyEditor({ cfg, set, save }) {
      const n = cfg.notify ?? {};
      // 旧配置里可能是 stdout / file → 界面上按「不推送」显示（不误导 ✓），选新方式时会被覆盖 ✓
      const type = ["none", "desktop", "dm", "webhook", "command"].includes(n.type) ? n.type : "none";
      const [testing, setTesting] = useState(false);
      const [testOut, setTestOut] = useState("");
      const setType = (v) => set(["notify", "type"], v);
      const radio = ([value, label]) =>
        h("label", { key: value, style: { display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "14px", cursor: "pointer", fontSize: "13px" } },
          h("input", { type: "radio", name: "blw-notify", checked: type === value, onChange: () => setType(value) }),
          label);
      const test = async () => {
        setTesting(true); setTestOut("…正在保存设置（测试前先落盘 ✓）\n");
        try {
          // 2026-10-19：测试前**先保存** ✓
          //   以前测试读的是磁盘上的旧配置 → "点了别的单选、测试却还发到旧通道" ✗
          //   现在"你看到的就是你测的" ✓
          await save();
          const r = await fetch(`${API}/notify-test`, { method: "POST", headers: { accept: "application/json" } });
          const j = await r.json().catch(() => ({}));
          setTestOut((j.ok ? "✓ 已发送（设置已自动保存 ✓）\n" : "✗ 失败（设置已自动保存 ✓）\n") + (j.out || "") + (j.err ? "\n" + j.err : ""));
        } catch (e) { setTestOut("✗ " + e.message); } finally { setTesting(false); }
      };
      const box = { className: "blw-out", style: { marginTop: "8px" } };
      return h("div", null,
        h("div", { className: "blw-group" }, "消息推送"),
        h("div", { className: "blw-hint", style: { marginTop: "2px" } }, "她看完一轮，把摘要送到哪？"),
        h("div", { className: "blw-rows" },
          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "方式"),
              h("div", { className: "blw-hint" }, "不推送 = 只写日记与事件流")),
            h("div", null, ["none", "desktop", "dm", "webhook", "command"].map((v, i) =>
              radio([v, ["不推送", "桌面通知", "B站私信", "Webhook", "自定义命令"][i]])))),

          type === "webhook" ? h("div", null,
            h("div", { className: "blw-row" },
              h("div", null, h("div", { className: "blw-label" }, "Webhook 地址"),
                h("div", { className: "blw-hint" }, "飞书 / 钉钉 / 企业微信 / QQ机器人 / WorkBuddy —— 把机器人给的地址贴进来就行（报文按域名自动适配 ✓）")),
              h("input", { className: "blw-input blw-wide", style: { minWidth: "300px" }, value: n.url ?? "", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/…", onChange: (e) => set(["notify", "url"], e.target.value) })),
            h("div", { className: "blw-row" },
              h("div", null, h("div", { className: "blw-label" }, "模板"),
                h("div", { className: "blw-hint" }, "纯文本最稳；飞书/钉钉选 markdown 会漂亮一些")),
              h("select", { className: "blw-select", value: n.template ?? "text", onChange: (e) => set(["notify", "template"], e.target.value) },
                h("option", { value: "text" }, "纯文本"),
                h("option", { value: "markdown" }, "markdown")))) : null,

          type === "command" ? h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "自定义命令"),
              h("div", { className: "blw-hint" }, "cmd = 可执行文件（如 node.exe）；消息**自动作为最后一个参数**传进去 ✓"),
              h("div", { className: "blw-hint" }, "⚠️ 不再支持 $MSG（2026-10-18 弃用：走 shell 有命令注入风险 ✗）")),
            h("input", { className: "blw-input blw-wide", style: { minWidth: "300px" }, value: n.cmd ?? "", placeholder: 'C:\\path\\to\\node.exe', onChange: (e) => set(["notify", "cmd"], e.target.value) }),
            h("div", { className: "blw-hint", style: { marginTop: "6px" } }, "参数（JSON 数组，可留空；比如 [\"C:/path/to/cli.js\"]）"),
            h("input", {
              className: "blw-input blw-wide", style: { minWidth: "300px" },
              value: JSON.stringify(n.args ?? []),
              onChange: (e) => {
                try { const v = JSON.parse(e.target.value); set(["notify", "args"], Array.isArray(v) ? v : []) } catch {}
              },
              placeholder: '["C:/path/to/cli.js"]',
            })) : null),

        h("div", { className: "blw-actions", style: { borderTop: "none", marginTop: "8px", paddingTop: "0" } },
          h("button", { className: "blw-btn blw-btn2", onClick: test, disabled: testing }, testing ? "发送中…" : "发条测试"),
          type === "none" ? h("span", { className: "blw-hint" }, "（方式=不推送时，测试只验证命令能跑通）") : null),
        testOut ? h("div", box, testOut) : null);
    }

    // ── 配置体检横幅（2026-10-22）──────────────────────────────────────────
    //   直接回答那个高频坑：「我改了配置，为什么没生效？」
    //   health 缺失 → 不渲染（后端还没带这个字段时页面照常工作 ✓）
    //   一切正常（ok 且无 BOM 且不是旧文件）→ 也不渲染（不要没事找事 ✓）
    function HealthBanner({ health }) {
      const [copied, setCopied] = useState("");
      if (!health) return null;
      const bad = !health.ok && !!health.error;            // 真·语法错（没配置文件的 ok=false 不算 ✗）
      if (!bad && !health.hadBom && !health.migratedFrom) return null;
      const tone = bad ? "bad" : (health.hadBom ? "warn" : "info");
      const title = bad
        ? "配置文件有语法错误，当前用的是默认值"
        : (health.hadBom ? "配置文件带 BOM，已自动兼容" : "正在读旧版配置文件");
      const icon = bad ? "✗ " : (health.hadBom ? "⚠️ " : "ℹ️ ");   // 红 / 黄 / 蓝 三色各配一个图标 ✓
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(health.error);
          setCopied("已复制");
        } catch { setCopied("复制失败：展开后手动选中"); }
        setTimeout(() => setCopied(""), 2500);
      };
      const where = health.migratedFrom || health.path;
      return h("div", { className: "blw-health blw-health-" + tone },
        h("div", { className: "blw-health-head" }, icon + title),
        h("div", null, bad
          ? "你改的配置没有生效 —— 这个文件解析失败，整份配置退回默认值。修好或删掉它，再点下面的「重新读取」。"
          : health.hadBom
            ? "已自动兼容，但建议用「UTF-8 无 BOM」另存一次；否则别的旧工具读它时还会报错。"
            : "保存一次就会写到新位置，之后旧文件不再生效。"),
        where ? h("div", { className: "blw-health-path" }, (health.migratedFrom ? "旧文件：" : "配置文件：") + where) : null,
        // 两个问题同时存在时，第二句也要说出来（否则修好 BOM 还以为文件没搬 ✓）
        health.hadBom && health.migratedFrom && tone === "warn"
          ? h("div", { className: "blw-hint" }, "另外：现在读的正是旧版文件，保存一次就会写到新位置。")
          : null,
        bad
          ? h("div", null,
              h("details", null,
                h("summary", null, "查看错误原文"),
                h("pre", null, health.error)),
              h("div", { className: "blw-health-actions", style: { marginTop: "6px" } },
                h("button", { className: "blw-btn blw-btn2", style: { height: "24px", fontSize: "11.5px", padding: "0 10px" }, onClick: copy }, "复制错误"),
                copied ? h("span", { className: "blw-hint" }, copied) : null))
          : null);
    }

    // ── 模型与密钥（2026-10-22 主人要的「能够选择模型和 sk 密钥」）────────────────
    //   为什么不塞进 FIELDS：provider / model 是**动态**的（要问宿主的 llm 服务），
    //   FIELDS 是静态表（只能写死选项）；而且密钥要"写完立刻看状态"的独立按钮 ✗
    //   安全约定：密钥值只 POST 一次 —— 界面永不显示、服务端也从不 GET 回来 ✓
    function ModelEditor({ cfg, set, save }) {
      const m = (cfg && cfg.model) || {};
      const [cat, setCat] = useState(null);          // { providers, suggestedRefs, services, catalogError }
      const [efforts, setEfforts] = useState([]);    // 当前模型支持哪些推理档
      const [keyst, setKeyst] = useState(null);      // { configured, source }
      const [keyRef, setKeyRef] = useState(m.apiKeyEnv || "");
      const [keyVal, setKeyVal] = useState("");
      const [busyHere, setBusyHere] = useState("");
      const [msg, setMsg] = useState("");

      const loadCat = useCallback(async (pid, mid) => {
        try {
          const qp = pid !== undefined ? pid : (m.provider || "");
          const qm = mid !== undefined ? mid : (m.model || "");
          const qs = qp || qm ? `?provider=${encodeURIComponent(qp)}&model=${encodeURIComponent(qm)}` : "";
          const r = await fetch(`${API}/model${qs}`, { headers: { accept: "application/json" } });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setCat(j);
          setEfforts(j.efforts || []);
          setKeyst(j.key || null);
          if (j.model && j.model.apiKeyEnv) setKeyRef((cur) => cur || j.model.apiKeyEnv);
        } catch (e) {
          // 404/405 = 宿主里根本没这条路由：跑着的 DSH 加载的是改动之前的插件代码 ✗
          // （设置页的 JS 是每次刷新从磁盘现读的，宿主代码却是启动时载入内存的 —— 两者会不一致）
          const stale = /HTTP (404|405)\b/.test(String(e.message || ""));
          setCat({ providers: [], catalogError: e.message, services: {}, staleHost: stale });
        }
      }, []);
      useEffect(() => { loadCat(); }, [loadCat]);

      const providers = (cat && cat.providers) || [];
      const svcs = (cat && cat.services) || {};
      const models = ((providers.find((p) => p.id === (m.provider || ""))) || {}).models || [];
      const noLlm = !!(cat && cat.catalogError);
      const staleHost = !!(cat && cat.staleHost);
      // 给「读不到模型目录」加一句人话：到底是宿主太旧，还是 DSH 里没有模型服务 ✓
      const catWhy = staleHost
        ? "插件宿主还是旧版代码（HTTP 404）—— 设置页是刷新时现读磁盘的，宿主代码是 DSH 启动时载入内存的，两者会不一致。完全退出 DSH 再启动一次，这条路由才会出现。"
        : (cat && cat.catalogError) || "读不到模型目录";
      const pick = (path, value) => set(path, value);

      const pickProvider = (pid) => {
        pick("model.provider", pid);
        const p = providers.find((x) => x.id === pid);
        const only = p && p.models.length === 1 ? p.models[0].id : "";
        pick("model.model", only);
        pick("model.reasoningEffort", "");
        loadCat(pid, only);
        const guess = String(pid).toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_API_KEY";
        const hit = (cat?.suggestedRefs || []).find((r) => r === guess);
        if (hit) setKeyRef((cur) => cur || hit);
      };
      const pickModel = (mid) => {
        pick("model.model", mid);
        pick("model.reasoningEffort", "");
        loadCat(m.provider || "", mid);
      };
      const applyNow = async () => {
        setBusyHere("apply"); setMsg("");
        try {
          if (save) await save();          // 先落盘，再应用 —— 不然"应用了但配置没存"会让人困惑 ✗
          const r = await fetch(`${API}/model`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ model: m, apply: true }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setMsg(j.applied ? "✓ 已应用到她的会话（不用重启 DSH）" : `✗ 没能应用：${j.applyError || "未知原因"}`);
        } catch (e) {
          setMsg(/HTTP (404|405)\b/.test(String(e.message || ""))
            ? "✗ 宿主里没有这条路由（HTTP " + String(e.message).replace(/\D+/g, "") + "）：跑着的 DSH 加载的还是改动前的插件代码。完全退出 DSH 再启动一次，然后重试。"
            : "✗ " + e.message);
        } finally { setBusyHere(""); }
      };
      const writeKey = async (action) => {
        setBusyHere("key"); setMsg("");
        // 引用名先在前端拦一道，省得点下去才被后端拒（写进凭据库的名字必须是环境变量名）✗
        const ref = String(keyRef || "").trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) {
          setMsg(`✗ 引用名只能字母/数字/下划线且不能以数字开头 —— 你填的是「${ref}」，` +
            "改成 provider 配置里 apiKeyEnv 的那个名字（例如 TENCENT_API_KEY）");
          setBusyHere(""); return;
        }
        try {
          const r = await fetch(`${API}/model/key`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ ref, value: action === "unset" ? "" : keyVal, action }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setKeyVal("");
          setKeyst(j.key || null);
          setMsg("✓ " + (j.detail || "已处理"));
        } catch (e) {
          setMsg(/HTTP (404|405)\b/.test(String(e.message || ""))
            ? "✗ 宿主里没有这条路由：跑着的 DSH 加载的还是改动前的插件代码，完全退出 DSH 再启动一次再试。"
            : "✗ " + e.message);
        } finally { setBusyHere(""); }
      };

      const selectRow = (label, hint, control) => h("div", { className: "blw-row" },
        h("div", null, h("div", { className: "blw-label" }, label), hint ? h("div", { className: "blw-hint" }, hint) : null),
        control);

      return h("div", null,
        h("div", { className: "blw-group" }, "模型与密钥"),
        h("div", { className: "blw-rows" },
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "用指定模型",
                noLlm ? h("span", { className: "blw-badge" }, staleHost ? "需重启 DSH" : "宿主不支持") : null),
              h("div", { className: "blw-hint" },
                "只影响她自己那个会话（DSH 原生会话级换模型）——不动别的会话、也不改 DSH 的全局默认 ✓",
                h("br"),
                "关掉 = 沿用 DSH 当前默认模型（行为与以前完全一样）")),
            h("input", { type: "checkbox", checked: !!m.enabled, onChange: (e) => pick("model.enabled", e.target.checked) })),

          selectRow("模型服务（provider）",
            noLlm ? catWhy : "列表来自 DSH 已挂载的模型服务（你在 DSH 里配的 provider 都会出现在这里）",
            h("select", { className: "blw-select", value: m.provider || "", disabled: !m.enabled || noLlm,
              onChange: (e) => pickProvider(e.target.value) },
              h("option", { value: "" }, "（请选择）"),
              providers.map((p) => h("option", { key: p.id, value: p.id }, p.name || p.id)))),

          selectRow("模型",
            models.length ? "这个 provider 对外声明的模型列表" : "先选 provider",
            h("select", { className: "blw-select", value: m.model || "", disabled: !m.enabled || !models.length,
              onChange: (e) => pickModel(e.target.value) },
              h("option", { value: "" }, "（请选择）"),
              models.map((x) => h("option", { key: x.id, value: x.id }, x.name || x.id)))),

          selectRow("推理档",
            efforts.length ? "这个模型支持的推理强度（默认档 = 不显式指定）" : "这个模型没有可选的推理档",
            h("select", { className: "blw-select", value: m.reasoningEffort || "", disabled: !m.enabled || !efforts.length,
              onChange: (e) => pick("model.reasoningEffort", e.target.value) },
              h("option", { value: "" }, "默认"),
              efforts.map((x) => h("option", { key: x.id, value: x.id }, x.name || x.id)))),

          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "每次醒来重新应用"),
              h("div", { className: "blw-hint" }, "开着：每轮唤醒前都按这里的设置选一次模型（换了模型/密钥不用重启 DSH）；关着：只在「保存并应用」时选一次")),
            h("input", { type: "checkbox", checked: m.applyOnWake !== false, onChange: (e) => pick("model.applyOnWake", e.target.checked) })),

          // ── SK：只写不读回 ────────────────────────────────────────────
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "API 密钥（SK）",
                keyst ? h("span", { className: "blw-badge" }, keyst.configured ? "已配置" : "未配置") : null),
              h("div", { className: "blw-hint" },
                "写进 DSH 自己的凭据库（", h("code", null, "~/.dsh/.credentials.yaml"), "），写后永不回显；不写进本插件配置 ✓",
                h("br"),
                "左边填「引用名」（环境变量名，provider 配置里的 ", h("code", null, "apiKeyEnv"), "），右边填密钥值。",
                keyst && keyst.source ? ` 当前来源：${keyst.source}` : "")),
            h("div", { className: "blw-cookie", style: { minWidth: "420px" } },
              h("input", { className: "blw-input", placeholder: "引用名，例如 TENCENT_API_KEY", value: keyRef,
                list: "blw-key-refs", onChange: (e) => setKeyRef(e.target.value) }),
              h("datalist", { id: "blw-key-refs" },
                ((cat && cat.suggestedRefs) || []).map((r) => h("option", { key: r, value: r }))),
              h("input", { className: "blw-input", type: "password", placeholder: "密钥值（粘贴进来，写一次即可）",
                value: keyVal, autoComplete: "off", onChange: (e) => setKeyVal(e.target.value) }),
              h("div", { style: { display: "flex", gap: "8px" } },
                h("button", { className: "blw-btn", disabled: !!busyHere || !keyRef || !keyVal, onClick: () => writeKey("set") },
                  busyHere === "key" ? "写入中…" : "写入密钥"),
                h("button", { className: "blw-btn blw-btn2", disabled: !!busyHere || !keyRef, onClick: () => writeKey("unset") }, "删除该密钥")))),

          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-hint" }, "改完点这里：先保存配置，再立刻让她这个会话换过去")),
            h("button", { className: "blw-btn", disabled: !!busyHere || !m.enabled, onClick: applyNow },
              busyHere === "apply" ? "应用中…" : "保存并应用")),
          msg ? h("div", { className: msg.startsWith("✓") ? "blw-hint" : "blw-err" }, msg) : null));
    }

    function BiliWhaleSection() {
      useStyleOnce();
      const [cfg, setCfg] = useState(null);
      const [savedJson, setSavedJson] = useState("");   // 2026-10-19：用来判断"有没有未保存的改动" ✓
      const [out, setOut] = useState("");
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState("");
      const [ck, setCk] = useState({ sessdata: "", bili_jct: "", buvid3: "" });
      const [ckMsg, setCkMsg] = useState("");
      // 2026-10-21：她专属的人设（~/.bili-ai/persona.md）—— 自由输入 + 注入 ✓
      const [personaText, setPersonaText] = useState("");
      const [personaMsg, setPersonaMsg] = useState("");
      const [personaBytes, setPersonaBytes] = useState(0);
      // 2026-10-22：配置体检（后端 /settings 响应里的 health；缺失 = null → 顶部不显示横幅 ✓）
      const [health, setHealth] = useState(null);

      const load = useCallback(async () => {
        setErr("");
        try {
          const r = await fetch(`${API}/settings`, { headers: { accept: "application/json" } });
          if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 403 ? "（被信任栅栏拒绝）" : ""}`);
          const j = await r.json();
          setCfg(j.config ?? {});
          setSavedJson(JSON.stringify(j.config ?? {}));
          setHealth(readHealth(j));
          // 人设单独一个文件，顺手读一下 ✓
          try {
            const pr = await fetch(`${API}/persona`, { headers: { accept: "application/json" } });
            if (pr.ok) { const pj = await pr.json(); setPersonaText(pj.text ?? ""); setPersonaBytes(pj.bytes ?? 0); }
          } catch {}
        } catch (e) { setErr(`读取配置失败：${e.message}`); }
      }, []);

      useEffect(() => { load(); }, [load]);

      // 保存后补读一次体检：保存会重建配置文件 → BOM / 旧文件提示应该立刻消失 ✓
      // （POST 响应里已经带了 health 就直接用；没带才补一次 GET；失败静默，不影响保存结果 ✓）
      const refreshHealth = useCallback(async () => {
        try {
          const r = await fetch(`${API}/settings`, { headers: { accept: "application/json" } });
          if (!r.ok) return;
          setHealth(readHealth(await r.json()));
        } catch {}
      }, []);

      const set = (path, value) => setCfg((c) => {
        const next = JSON.parse(JSON.stringify(c ?? {}));
        setPath(next, path, value);
        return next;
      });

      const save = async () => {
        setBusy("save"); setErr(""); setOut("");
        try {
          const wins = cfg?.night?.windows ?? [];
          const total = Math.max(1, wins.reduce((s, w) => s + (Number(w.wakes) || 1), 0));
          const body = { ...(cfg ?? {}), night: { ...(cfg?.night ?? {}), maxWakesPerDay: total } };
          const r = await fetch(`${API}/settings`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            // 2026-10-18：宿主现在两种都收 ✓，这里显式包一层最稳（以前发裸对象 → 宿主 merge 到 {}
            body: JSON.stringify({ config: body }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setOut(`✓ 已保存${j.warn ? `\n⚠️ ${j.warn}` : ""}\n配置：${j.configPath ?? "~/.dsh/myilidepu.config.json"}`);
          if (j.config) { setCfg(j.config); setSavedJson(JSON.stringify(j.config)); }
          // 2026-10-22：保存会重建配置文件（无 BOM、写到新位置）→ 顶部体检横幅要立刻跟着更新 ✓
          //   POST 响应带 health 就当场用；没带才补一次 GET（失败静默，不影响保存结果 ✓）
          if (j.health) setHealth(readHealth(j));
          else refreshHealth();
        } catch (e) { setErr(`保存失败：${e.message}`); } finally { setBusy(""); }
      };

      const injectPersona = async () => {
        setBusy("persona"); setPersonaMsg("");
        try {
          const r = await fetch(`${API}/persona`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ text: personaText }),
          });
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
          setPersonaBytes(j.bytes ?? 0);
          setPersonaMsg(j.detail ?? "✓ 已注入");
        } catch (e) { setPersonaMsg("✗ " + e.message); }
        finally { setBusy(""); }
      };

      const deps = async () => {
        setBusy("deps"); setErr(""); setOut("检查中…");
        try {
          const r = await fetch(`${API}/deps`, { headers: { accept: "application/json" } });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          const lines = (j.items ?? []).map((i) => `${i.ok ? "✓" : "✗"} ${i.name} — ${i.detail ?? ""}`);
          const schedulerOk = j.scheduler?.ok === true;
          lines.push(`${schedulerOk ? "✓" : "✗"} 生物钟 — ${j.scheduler?.reason ?? "未返回调度器状态"}`);
          if (j.error) lines.push(j.error);
          // 2026-10-19：体检后顺手重读配置 ✓ 不然「她自己 mid/昵称」那两格永远显示旧值 ✗
          if (j.self) lines.push("", `她自己：${j.self.name}（mid ${j.self.mid}）✓`);
          await load();
          setOut([...lines, "", j.ok && schedulerOk ? "全部可用 ✓" : "有项不可用 ✗"].join("\n"));
        } catch (e) { setErr(`依赖体检失败：${e.message}`); } finally { setBusy(""); }
      };

      const saveCookie = async () => {
        setBusy("cookie"); setErr(""); setCkMsg("");
        try {
          const r = await fetch(`${API}/cookie`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(ck),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setCkMsg(`✓ ${j.detail ?? "已写入"}` + (j.warn ? `\n${j.warn}` : ""));   // 永不回显 cookie ✓（warn 要说出来 ✗ 不然等于没查）
          setCk({ sessdata: "", bili_jct: "", buvid3: "" });
        } catch (e) { setCkMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      if (!cfg) {
        return h("div", { className: "blw" },
          h("h3", { className: "blw-title" }, "我的分身"),
          err ? h("div", { className: "blw-err" }, err) : h("div", { className: "blw-hint" }, "读取中…"));
      }

      const groups = [];
      for (const f of FIELDS) {
        let g = groups.find((x) => x.name === f.group);
        if (!g) { g = { name: f.group, fields: [] }; groups.push(g); }
        g.fields.push(f);
      }
      // 渲染顺序（2026-10-22 主人定，见下面的 GROUP_ORDER）：
      //   她是谁 → 你（主人）→ 口味 → 作息 →【分享评论 + 全天监听】→ 日记与推送 → 消息推送 → 工具链
      // 2026-10-21：人设块 —— 挂在「她是谁」那一组下面 ✓（主人要求放这三个字段下面）
      const personaBlock = () => [
          h("div", { className: "blw-group" }, "她的人设（只属于她）"),
          h("div", { className: "blw-rows" },
            h("div", { className: "blw-row" },
              h("div", null,
                h("div", { className: "blw-label" }, "人设正文"),
                h("div", { className: "blw-hint" },
                  "写到 ", h("code", null, "~/.bili-ai/persona.md"),
                  "，只影响她（不影响别的会话 ✓）。每次唤醒/监听都会附在提示里 ✓",
                  h("br"),
                  "建议写：身份与来历 / 说话腔调 / 在意什么、怕什么 / 明确不要的行为。上限 20000 字，注入时只取前 3000 字 ✓")),
              h("div", { className: "blw-cookie", style: { minWidth: "420px" } },
                h("textarea", {
                  className: "blw-input",
                  rows: 12,
                  placeholder: "例如：\n她的名字是…\n她说话时会…\n她在意…\n她绝对不会…",
                  value: personaText,
                  onChange: (e) => setPersonaText(e.target.value),
                  style: { resize: "vertical", fontFamily: "inherit", lineHeight: "1.6" },
                }),
                h("div", { className: "blw-hint" },
                  "当前 " + personaBytes + " 字节" + (personaText.length > 20000 ? "（超过 20000 上限 ✗）" : "")),
                h("button", { className: "blw-btn", onClick: injectPersona, disabled: !!busy || personaText.length > 20000 },
                  busy === "persona" ? "注入中…" : "注入人设"),
                personaMsg ? h("div", { className: personaMsg.startsWith("✓") ? "blw-hint" : "blw-err" }, personaMsg) : null))),
      ];

      const renderGroup = (g) => h("div", { key: g.name },
        h("div", { className: "blw-group" }, g.name),
        g.name === "作息" ? h(WindowsEditor, { cfg, set }) : null,
        h("div", { className: "blw-rows" }, g.fields.map((f) => h(Row, { key: f.path.join("."), f, cfg, set }))),
        // 2026-10-21：人设块放在这三个字段【下面】✓（主人要求）
        g.name === "她是谁" ? h("div", null, personaBlock()) : null);
      // 2026-10-22 修：分组顺序显式定死 ✗ 不再靠 FIELDS 里字段出现的先后
      //   （v0.4.2 把新字段插在 FIELDS 最前面 → 工具链跑到了第一位 ✗ 整个页面顺序乱了）
      //   主人定的顺序：她是谁 → 你 → 口味 → 作息 →【分享 / 监听】→ 日记与推送 → 消息推送 → 工具链
      const GROUP_ORDER = ["她是谁", "你（主人）", "口味", "作息"]
      // 2026-10-22（合并 humanism）：新增四组 **追加在现有分组之后** —— 旧分组的顺序一个都不动 ✓
      const NEW_GROUP_ORDER = ["学习", "人格", "日记", "足迹"]
      const byName = (n) => groups.find((g) => g.name === n)
      const orderedTop = GROUP_ORDER.map(byName).filter(Boolean)
      const orderedMid = ["日记与推送"].map(byName).filter(Boolean)
      const orderedTool = ["工具链"].map(byName).filter(Boolean)
      const orderedNew = NEW_GROUP_ORDER.map(byName).filter(Boolean)
      // 兜底：万一以后又加了新分组，别让它消失 ✗
      const known = new Set([...GROUP_ORDER, ...NEW_GROUP_ORDER, "日记与推送", "工具链"])
      const leftovers = groups.filter((g) => !known.has(g.name))
      const ci = { className: "blw-input" };

      return h("div", { className: "blw" },
        h("h3", { className: "blw-title" }, "我的分身"),
        // 2026-10-22（合并 humanism）：配置体检置顶 —— 先回答「我改了配置为什么没生效」
        h(HealthBanner, { health }),
        h("p", { className: "blw-intro" },
          "让 agent 自己按作息刷 B 站、看懂视频、写两本日记，把值得的 @ 你。",
          "所有值写进 ", h("code", null, "~/.dsh/myilidepu.config.json"),
          "（与工具链共用同一份 ✓；这里没显示的字段保存时原样保留 ✓）。"),

        ...orderedTop.map(renderGroup),

        h(ShareEditor, { cfg, set }),
        h(ListenEditor, { cfg, set }),
        h(WatchUpsEditor, { cfg, set }),

        ...orderedMid.map(renderGroup),
        h(NotifyEditor, { cfg, set, save }),
        ...leftovers.map(renderGroup),
        ...orderedTool.map(renderGroup),
        // 2026-10-22：学习 / 人格 / 日记 / 足迹 —— 新增组接在工具链之后、cookie 之前 ✓
        ...orderedNew.map(renderGroup),
        // 2026-10-22 新增：模型与密钥（动态下拉 + 只写不读回的 SK）—— 放在 cookie 之前
        h(ModelEditor, { cfg, set, save }),

        h("div", { className: "blw-group" }, "B 站 cookie"),
        h("div", { className: "blw-rows" },
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "凭据"),
              h("div", { className: "blw-hint" }, "浏览器 F12 → Cookie 里复制（SESSDATA 是 HttpOnly，console 拿不到 ✗）；写入后永不回显 ✓")),
            h("div", { className: "blw-cookie" },
              h("input", { ...ci, placeholder: "SESSDATA", value: ck.sessdata, onChange: (e) => setCk((s) => ({ ...s, sessdata: e.target.value })) }),
              h("input", { ...ci, placeholder: "bili_jct", value: ck.bili_jct, onChange: (e) => setCk((s) => ({ ...s, bili_jct: e.target.value })) }),
              h("input", { ...ci, placeholder: "buvid3（可空）", value: ck.buvid3, onChange: (e) => setCk((s) => ({ ...s, buvid3: e.target.value })) }),
              h("button", { className: "blw-btn blw-btn2", onClick: saveCookie, disabled: !!busy || !ck.sessdata || !ck.bili_jct },
                busy === "cookie" ? "写入中…" : "写入凭据"),
              ckMsg ? h("div", { className: (ckMsg.startsWith("✓") ? "blw-hint blw-pre" : "blw-err") }, ckMsg) : null))),
        h("div", { className: "blw-actions" },
          h("button", { className: "blw-btn", onClick: save, disabled: !!busy }, busy === "save" ? "保存中…" : "保存"),
          cfg && savedJson && JSON.stringify(cfg) !== savedJson
            ? h("span", { style: { marginLeft: "10px", color: "#ffb020", fontSize: "13px" } }, "● 有改动还没保存（改了不点保存 = 没生效 ✗）")
            : null,
          h("button", { className: "blw-btn blw-btn2", onClick: deps, disabled: !!busy }, busy === "deps" ? "体检中…" : "依赖体检"),
          h("button", { className: "blw-btn blw-btn2", onClick: load, disabled: !!busy }, "重新读取")),

        err ? h("div", { className: "blw-err" }, err) : null,
        out ? h("div", { className: "blw-out" }, out) : null,
        h("div", { className: "blw-hint" }, "装完先点「依赖体检」：cookie / ffmpeg / node / 数据目录 都 ✓ 才算可用。"));
    }

    const inject = ["slots"];
    const NS = "myilidepu";
    const NAMES = { nav: "我的分身" };

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject("settings.section", () =>
            ctx.slots.register(
              { name: "settings.section", id: NS, order: 6, label: () => NAMES.nav },
              BiliWhaleSection,
            ),
            "myilidepu: settings section",
          ),
        "myilidepu: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.BiliWhaleSection = BiliWhaleSection;
    exports.FIELDS = FIELDS;
    return module.exports;
  },
});
