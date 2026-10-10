/* Better Quiz Box — 状态层
 * 负责:选项行重排 + 卡片级瞬态作答存储(内存,不落盘)
 */

// 按 optIdx 顺序重排 DOM 行(appendChild 移动节点即为重排)
export function reorderRowsTo(block, order) {
  const list = block.querySelector(".quiz-options");
  if (!list) return;
  const rows = block.querySelectorAll(".quiz-option");
  const byKey = new Map();
  rows.forEach((el) => byKey.set(parseInt(el.dataset.optIdx, 10), el));
  for (const oi of order) {
    const el = byKey.get(oi);
    if (el) list.appendChild(el); // appendChild 移动节点即重排
  }
}

/* --------------------- 卡片级瞬态(顺序+作答,内存,不落盘) --------------------- */
// key:有稳定 id 的块 = 源文件 + "\u0000" + id(id 是计数器编号,内容编辑不变 → 顺序/作答自然延续);
//     无 id 的块 = 源文件 + 代码块原文(回落内容匹配)。
// entry = { at, container, order, states: Map(optIdx->state)|null, optSig }
// 复原语义:同一容器内上一渲染即本题(连续重渲染/SR 翻面)才复用顺序/作答;
// 选项真变了(optSig 变)按新开处理重新随机;其余(重开文件/换卡)同样重来。
const cardStore = new Map();
const CARD_TTL_MS = 10 * 60 * 1000;
// "上一渲染"按容器(阅读视图/SR 复习/编辑器各自独立的 .markdown-rendered)分别记录，
// 避免跨容器渲染(如阅读视图与 SR 模态同时打开)互相干扰翻面判定；
// 否则同卡的翻面重渲染可能被误判为"新开"而重新打乱。
const lastKeyByContainer = new WeakMap();
let lastKeyNullContainer = null;

export function noteRendered(key, container) {
  if (container) lastKeyByContainer.set(container, key);
  else lastKeyNullContainer = key;
}

function isConsecutive(key, container) {
  return container ? lastKeyByContainer.get(container) === key : lastKeyNullContainer === key;
}

export function stableContainer(el) {
  let cur = el.parentElement;
  while (cur) {
    if (cur.classList && cur.classList.contains("markdown-rendered")) return cur;
    cur = cur.parentElement;
  }
  return null;
}

export function resolveCard(key, container, optSig) {
  const entry = cardStore.get(key);
  if (!entry) return { redraw: false };
  if (Date.now() - entry.at > CARD_TTL_MS) {
    cardStore.delete(key);
    return { redraw: false };
  }
  // 选项真的变了(增删/改文本/改正确态) → 旧顺序作废,按新开处理(重新随机)
  if (optSig !== undefined && entry.optSig !== undefined && entry.optSig !== optSig) {
    cardStore.delete(key);
    return { redraw: false };
  }
  const redraw =
    entry.container === container && isConsecutive(key, container);
  if (!redraw) {
    cardStore.delete(key);
    return { redraw: false };
  }
  return { redraw: true, entry };
}

export function saveCard(key, container, order, states, optSig) {
  if (cardStore.size > 500) {
    const now = Date.now();
    for (const [k, v] of cardStore) {
      if (now - v.at > CARD_TTL_MS) cardStore.delete(k);
    }
  }
  cardStore.set(key, { at: Date.now(), container, order, states, optSig });
}

// 插件卸载时清空全部瞬态(卡片存储 + 上一渲染记录)
export function resetTransientState() {
  cardStore.clear();
  lastKeyNullContainer = null;
}
