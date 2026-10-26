/* Better Quiz Box — 全库 id 索引(单一事实源)
 * 三张内存表:
 *   idIndex      正向:id → { file, line, source, question, options, details, answer, attrs, currentOrder }
 *                line 是起始围栏行号(0 基),"跳到原文"据此定位;
 *                details = 块内 [h] 提示,answer = 块外那段解析,两者互相独立
 *                currentOrder 是该题"当前显示顺序"(源题渲染时写入;选项未变的重建沿袭,编辑不重摇)
 *   refIndex     反向:id → 引用它的文件路径集合(bind/copy 定点查找)
 *   liveBindings 活动:已渲染的 bind/copy 块句柄,目标更新后定点重渲
 *
 * id 是计数器编号(内容无关,见 idassign.mjs),永不改写:
 *   内容编辑 → 条目重建但 id 不变 → currentOrder 沿袭(选项没变) → 绑定块引用恒有效。
 */

import { parseQuiz, extractAnswer } from "./parse.mjs";

const idIndex = new Map();
const refIndex = new Map();
const liveBindings = new Map(); // id -> Set<{ alive, rerender }>

export function baseOf(id) {
  return id ? String(id).replace(/-\d+$/, "") : "";
}

// 调试日志钩子(由插件在 onload 注入;无钩子时静默)
let logHook = null;
export function setLogHook(fn) { logHook = fn; }
function log(...args) { if (logHook) { try { logHook(...args); } catch (e) {} } }

// 索引规模快照(调试用)
export function stats() {
  let refs = 0;
  for (const s of refIndex.values()) refs += s.size;
  return { ids: idIndex.size, refBases: refIndex.size, refs, liveBindings: liveBindings.size };
}

/* --------------- 正向索引 --------------- */

export function lookupId(id) {
  return idIndex.get(baseOf(id)) || null;
}

// 源题渲染时注册当前显示顺序(选项数不匹配则忽略)
// 返回 true 表示存储的顺序真的变了(调用方据此决定是否广播绑定块重渲,防渲染风暴)
export function setOrderOf(id, order) {
  const e = idIndex.get(baseOf(id));
  if (!e || !order || order.length !== e.options.length) return false;
  if (e.currentOrder && e.currentOrder.join(",") === order.join(",")) return false;
  e.currentOrder = order;
  return true;
}

/* --------------- 反向引用 --------------- */

function registerRef(target, filePath) {
  const k = baseOf(target);
  if (!k || !filePath) return;
  let s = refIndex.get(k);
  if (!s) {
    s = new Set();
    refIndex.set(k, s);
  }
  s.add(filePath);
}

export function getRefFiles(target) {
  const s = refIndex.get(baseOf(target));
  return s ? [...s] : [];
}

/* --------------- 文件置换(核心原语) --------------- */

// 扫出所有 quiz 块:source 为块内文本,line 为起始围栏行号(0 基,供"跳到原文"定位),
// end 为闭合围栏行号(块外解析从这里往下读)
function scanSources(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^```[ \t]*quiz[ \t]*$/i.test(lines[i])) { i++; continue; }
    let j = i + 1;
    while (j < lines.length && !/^```[ \t]*$/.test(lines[j])) j++;
    out.push({ source: lines.slice(i + 1, j).join("\n"), line: i, end: j });
    i = j + 1;
  }
  return out;
}

// 选项集签名(文本+正确态,忽略顺序):判断"选项是否真的变了"。
// 全库唯一实现:索引置换守卫与渲染层卡片瞬态守卫(runRender/复习页)共用这一份公式。
export function optSigOf(options) {
  return options
    .map((o) => o.state + "\u0001" + o.text.trim().toLowerCase().replace(/\s+/g, " "))
    .sort()
    .join("\u0002");
}

// 用 newText 置换某文件在索引里的全部贡献:
//   - id 是计数器编号,永不改写:同 id 条目在选项未变时沿袭 currentOrder(编辑不重摇),
//     选项真变了才作废(下次源题渲染重新注册新序)
// 返回"内容有变化的 id 集合",供精准通知绑定块。
export function replaceFileEntries(filePath, text) {
  const changed = new Set();
  const before = new Map();
  for (const [k, e] of idIndex) {
    if (e.file === filePath) {
      before.set(k, e);
      idIndex.delete(k);
    }
  }
  for (const [b, s] of refIndex) {
    s.delete(filePath);
    if (!s.size) refIndex.delete(b);
  }
  if (text && text.includes("```quiz")) {
    const lines = text.split("\n");
    for (const { source, line, end } of scanSources(text)) {
      const data = parseQuiz(source);
      if (data.attrs.binding) {
        registerRef(data.attrs.binding.target, filePath);
        continue;
      }
      if (!data.attrs.id) continue;
      const k = baseOf(data.attrs.id);
      // 块外解析:读题目正下方若干段(answer-paras 指定,默认 1 段);与块内 [h] 提示无关
      const answer = extractAnswer(lines, end, data.attrs.answerParas || 1) || undefined;
      const prev = before.get(k) || null;
      // 解析正文变了也算内容变化(否则绑定块与题库会停在旧解析)
      if (!prev || prev.source !== source || prev.answer !== answer) changed.add(k);
      const keptOrder =
        prev && optSigOf(prev.options) === optSigOf(data.options) ? prev.currentOrder || null : null;
      idIndex.set(k, {
        file: filePath,
        line, // 起始围栏行号(0 基):"跳到原文"定位用
        source,
        answer, // 块外那段解析
        question: data.question,
        options: data.options,
        details: data.details, // 块内 [h] 提示(与解析独立)
        attrs: data.attrs,
        currentOrder: keptOrder,
      });
    }
  }
  // 消失的 id 也算变化(引用它们的绑定块需要降级为普通题)
  for (const k of before.keys()) {
    if (!idIndex.has(k)) changed.add(k);
  }
  return changed;
}

// 全量重建(启动用):逐文件置换
export function buildIndex(files, readFn) {
  for (const f of files) {
    replaceFileEntries(f.path, readFn(f));
  }
}

// 删除某文件的全部贡献(delete 事件);返回消失的 id 集合
export function removeFileEntries(filePath) {
  const gone = new Set();
  for (const [k, e] of idIndex) {
    if (e.file === filePath) {
      gone.add(k);
      idIndex.delete(k);
    }
  }
  for (const [b, s] of refIndex) {
    s.delete(filePath);
    if (!s.size) refIndex.delete(b);
  }
  return gone;
}

export function clearIndex() {
  idIndex.clear();
  refIndex.clear();
  liveBindings.clear();
}

// 某文件已占用的块号集合(计数器续编用):从该文件前缀的 id 提取数字部分
export function usedBlockNums(filePrefix) {
  const nums = new Set();
  for (const [k] of idIndex) {
    if (k.startsWith(filePrefix)) {
      const n = parseInt(k.slice(filePrefix.length), 10);
      if (!isNaN(n)) nums.add(n);
    }
  }
  return nums;
}

// 全库全部已在册 id(全库唯一防线:计数器分配时跳过已被他文件占用的 id)
export function allIds() {
  return new Set(idIndex.keys());
}

/* --------------- 活动绑定(定点重渲) --------------- */

export function registerLiveBinding(target, handle) {
  const k = baseOf(target);
  let s = liveBindings.get(k);
  if (!s) {
    s = new Set();
    liveBindings.set(k, s);
  }
  s.add(handle);
}

// 通知重渲;changedIds 省略时通知全部,否则只通知命中的 id。断连条目惰性回收。
// 重入防护(防渲染风暴):重渲过程中再触发的 notify 不立即执行,合并进待办队列
// 下一拍统一收敛;链式触发深度超过 3 层直接丢弃(正常流永远不会到 3 层)。
let flushing = false;
let pendingKeys = null; // null = 全量待办
let pendingTimer = null;
let chainDepth = 0;

function schedulePendingFlush() {
  if (pendingTimer || typeof setTimeout !== "function") return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    if (chainDepth >= 3) { pendingKeys = null; chainDepth = 0; return; }
    chainDepth++;
    const k = pendingKeys;
    pendingKeys = null;
    notifyLiveBindings(k);
  }, 0);
}

export function notifyLiveBindings(changedIds) {
  if (flushing) {
    // 合并待办:全量(null)优先级最高,一旦出现就吞并所有定点;否则把定点并入集合
    if (pendingKeys !== null && changedIds) {
      for (const k of changedIds) pendingKeys.add(k);
    } else {
      pendingKeys = null; // 全量待办覆盖一切
    }
    schedulePendingFlush();
    return;
  }
  flushing = true;
  let rerendered = 0;
  try {
    for (const [k, s] of liveBindings) {
      if (changedIds && changedIds.size && !changedIds.has(k)) continue;
      for (const h of [...s]) {
        let alive = false;
        try { alive = h.alive(); } catch (e) { alive = false; }
        if (!alive) { s.delete(h); continue; }
        try { h.rerender(); rerendered++; } catch (e) { s.delete(h); }
      }
      if (!s.size) liveBindings.delete(k);
    }
  } finally {
    flushing = false;
  }
  log("notifyLiveBindings:", changedIds ? [...changedIds] : "*all*", "→ rerendered", rerendered);
}

/* --------------- 绑定解析 --------------- */

// 由 id 找到原题的渲染数据;拿不到时返回 null(宿主按普通题处理)。
// attrs 为宿主"未填充缺省"的原始属性(null=未写);优先级 = 宿主显式 > 目标有效值 > defaults。
// 顺序跟随原题 currentOrder(洗牌后的实际显示顺序);原题未渲染过则回落其源顺序。
export function resolveBinding(attrs, opts = {}) {
  const ref = attrs.binding;
  if (!ref) return null;
  const target = lookupId(ref.target);
  if (!target) return null;
  const defaults = opts.defaults || {};
  const effMode = target.attrs.mode != null ? target.attrs.mode : (defaults.mode != null ? defaults.mode : "immediate");
  const effShuffle = target.attrs.shuffle != null ? target.attrs.shuffle : (defaults.shuffle != null ? defaults.shuffle : true);
  const effNumber = target.attrs.number != null ? target.attrs.number : (defaults.number != null ? defaults.number : "none");
  const stem =
    attrs.stem != null ? attrs.stem
      : ref.type === "copy" ? true
      : opts.defaultBindStem === true;
  const srcOrder = target.options.map((o) => o.optIdx);
  const follow = target.currentOrder && target.currentOrder.length === target.options.length
    ? target.currentOrder
    : srcOrder;
  const cloned = {
    question: ref.type === "bind" && stem === false ? "" : target.question,
    options: target.options.map((o) => ({ ...o })),
    details: target.details, // 块内 [h] 提示
    answer: target.answer,   // 源题下方的解析(镜像永远取源题的,不取宿主自己的)
    hideStem: ref.type === "bind" && stem === false,
    order: follow,
    attrs: {
      ...target.attrs,
      mode: attrs.mode != null ? attrs.mode : effMode,
      shuffle: attrs.shuffle != null ? attrs.shuffle : effShuffle,
      number: attrs.number != null ? attrs.number : effNumber,
      id: null,
      binding: null,
    },
  };
  return cloned;
}
