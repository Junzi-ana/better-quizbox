/* Better Quiz Box — 全库 id 索引(单一事实源)
 * 三张内存表:
 *   idIndex      正向:id base → { file, source, question, options, details, attrs, currentOrder }
 *                currentOrder 是该题"当前显示顺序"(渲染时写入;内容未变的置换沿用,防洗牌风暴)
 *   refIndex     反向:id base → 引用它的文件路径集合(bind/copy 改写时定点打开,不全库扫)
 *   liveBindings 活动绑定:已渲染的 bind/copy 块句柄,目标更新后定点重渲
 * key 统一用 base(去 -N 序号后缀)。
 */

import { parseQuiz } from "./parse.mjs";

const idIndex = new Map();
const refIndex = new Map();
const liveBindings = new Map(); // base -> Set<{ alive, rerender }>
// 别名:编辑器占用文件期间我们不写盘,内存索引改用新 id,旧 id 通过别名继续解析到同一条目,
// 使绑定块在内存中保持一致;文件切走后落盘,别名自然失效(留着无害,碰撞概率可忽略)。
const aliases = new Map(); // oldBase -> newBase
// 顺序缓冲:setOrderOf 在条目尚不存在时(启动竞态:源题先渲、索引后建)暂存,
// 条目创建时收养——否则源题首渲的洗牌顺序被静默丢弃,绑定块永远只能拿字面序。
const pendingOrders = new Map(); // base -> order

export function baseOf(id) {
  return id ? String(id).replace(/-\d+$/, "") : "";
}

export function aliasId(oldId, newId) {
  const o = baseOf(oldId);
  const n = baseOf(newId);
  if (o && n && o !== n) aliases.set(o, n);
}

function resolveAlias(id) {
  let k = baseOf(id);
  const seen = new Set();
  while (aliases.has(k) && !seen.has(k)) {
    seen.add(k);
    k = aliases.get(k);
  }
  return k;
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
  return idIndex.get(resolveAlias(id)) || null;
}

// 渲染层写入某题的当前显示顺序;条目未就绪时入缓冲,创建时收养
export function setOrderOf(id, order) {
  const k = resolveAlias(id);
  const e = idIndex.get(k);
  if (e && order && order.length === e.options.length) e.currentOrder = order;
  else if (order && order.length) pendingOrders.set(k, order);
}

// 条目注册后收养缓冲顺序 + 清掉"真身回归"的过期别名。
// 只清"别名起点 = 本次注册 key"的情形(落盘后旧 id 回归,别名把解析拐向已不存在的 key → MISS);
// defer 场景(新条目注册在新 key、文件仍引用旧 id)的别名必须保留,否则内存绑定块查不到。
function adoptOnRegister(k, prevSource) {
  if (aliases.has(k)) aliases.delete(k);
  if (prevSource == null) {
    const po = pendingOrders.get(k);
    if (po) {
      pendingOrders.delete(k);
      return po;
    }
  }
  return null;
}

/* --------------- 反向引用 --------------- */

function registerRef(targetBase, filePath) {
  const k = baseOf(targetBase);
  if (!k || !filePath) return;
  let s = refIndex.get(k);
  if (!s) {
    s = new Set();
    refIndex.set(k, s);
  }
  s.add(filePath);
}

export function getRefFiles(targetBase) {
  const s = refIndex.get(baseOf(targetBase));
  return s ? [...s] : [];
}

/* --------------- 文件置换(核心原语) --------------- */

function scanSources(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^```[ \t]*quiz[ \t]*$/i.test(lines[i])) { i++; continue; }
    let j = i + 1;
    while (j < lines.length && !/^```[ \t]*$/.test(lines[j])) j++;
    out.push(lines.slice(i + 1, j).join("\n"));
    i = j + 1;
  }
  return out;
}

// 用 newText 置换某文件在索引里的全部贡献:
//   - 未变化(同 base 且 source 相同)的条目原样保留(含 currentOrder,防洗牌)
//   - 变化/新增/消失的条目重建/清除
// 返回"内容有变化的 id base 集合",供精准通知绑定块。
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
    for (const source of scanSources(text)) {
      const data = parseQuiz(source);
      if (data.attrs.binding) {
        registerRef(data.attrs.binding.target, filePath);
        continue;
      }
      if (!data.attrs.id) continue;
      const k = baseOf(data.attrs.id);
      const prev = before.get(k) || null;
      if (!prev || prev.source !== source) changed.add(k);
      // 收养缓冲顺序(新条目,prev 无) ;并清掉与本 key 相关的过期别名(落盘回归场景)
      const adopted = adoptOnRegister(k, prev ? prev.source : null);
      const keptOrder = prev && prev.source === source ? prev.currentOrder || null : null;
      idIndex.set(k, {
        file: filePath,
        source,
        question: data.question,
        options: data.options,
        details: data.details,
        attrs: data.attrs,
        currentOrder: keptOrder || adopted,
      });
    }
  }
  // 消失的 base 也算变化(引用它们的绑定块需要降级为普通题)
  for (const k of before.keys()) {
    if (!idIndex.has(k)) changed.add(k);
  }
  return changed;
}

// 全量重建(启动用):逐文件置换,不清空整表(保留未知来源?无 —— 启动时空表自然成立)
export function buildIndex(files, readFn) {
  for (const f of files) {
    replaceFileEntries(f.path, readFn(f));
  }
}

// 删除某文件的全部贡献(delete 事件);返回消失的 base 集合
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
  aliases.clear();
  pendingOrders.clear();
}

/* --------------- 活动绑定(定点重渲) --------------- */

export function registerLiveBinding(targetBase, handle) {
  const k = baseOf(targetBase);
  let s = liveBindings.get(k);
  if (!s) {
    s = new Set();
    liveBindings.set(k, s);
  }
  s.add(handle);
}

// 通知重渲;changedBases 省略时通知全部,否则只通知命中的 base。断连条目惰性回收。
export function notifyLiveBindings(changedBases) {
  let rerendered = 0;
  for (const [k, s] of liveBindings) {
    if (changedBases && changedBases.size && !changedBases.has(k)) continue;
    for (const h of [...s]) {
      let alive = false;
      try { alive = h.alive(); } catch (e) { alive = false; }
      if (!alive) { s.delete(h); continue; }
      try { h.rerender(); rerendered++; } catch (e) { s.delete(h); }
    }
    if (!s.size) liveBindings.delete(k);
  }
  log("notifyLiveBindings:", changedBases ? [...changedBases] : "*all*", "→ rerendered", rerendered);
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
    details: target.details,
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