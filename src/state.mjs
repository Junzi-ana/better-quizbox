/* Better Quiz Box — 状态层
 * 负责:顺序注册表(动态块发布 / 静态块订阅) + 卡片级瞬态作答存储(内存,不落盘)
 */

/* ------------------------- 顺序注册表(动态发布/静态订阅) ---------------------- */
// file -> Map(effKey -> { order, bound: Set<callback> })

const orderRegistry = new Map();

export function registryFor(file) {
  let m = orderRegistry.get(file);
  if (!m) {
    m = new Map();
    orderRegistry.set(file, m);
  }
  return m;
}

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

// 动态块发布顺序;已渲染的绑定静态块立即同步
export function publishOrder(file, key, order) {
  const reg = registryFor(file);
  let entry = reg.get(key);
  if (!entry) {
    entry = { order: null, bound: new Set() };
    reg.set(key, entry);
  }
  entry.order = order;
  if (entry.bound.size) {
    for (const cb of [...entry.bound]) {
      if (cb.isAlive) cb.update();
      else entry.bound.delete(cb);
    }
  }
}

// 静态块订阅;若顺序已发布则立即应用。applyVisuals 由调用方注入,避免渲染层耦合。
export function subscribeStatic(file, key, block, data, numberMode, applyVisuals) {
  const reg = registryFor(file);
  let entry = reg.get(key);
  if (!entry) {
    entry = { order: null, bound: new Set() };
    reg.set(key, entry);
  }
  const handle = {
    isAlive: true,
    update: () => {
      if (!handle.isAlive || !block.isConnected) {
        entry.bound.delete(handle);
        return;
      }
      if (entry.order) {
        reorderRowsTo(block, entry.order);
        applyVisuals(block, data, numberMode);
      }
    }
  };
  entry.bound.add(handle);
  return entry;
}

/* --------------------- 卡片级瞬态(顺序+作答,内存,不落盘) --------------------- */
// key = 源文件路径 + "\u0000" + 代码块原文
// entry = { at, container, order, states: Map(optIdx->state)|null }
// 复原语义:只有"同一容器内上一渲染即本题"的连续重渲染(SR 翻面)才复用顺序/作答;
// 其余(重开文件/新复习/换卡)一律删除旧记录、重新随机并回到初始状态。
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

export function resolveCard(key, container) {
  const entry = cardStore.get(key);
  if (!entry) return { redraw: false };
  if (Date.now() - entry.at > CARD_TTL_MS) {
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

export function saveCard(key, container, order, states) {
  if (cardStore.size > 500) {
    const now = Date.now();
    for (const [k, v] of cardStore) {
      if (now - v.at > CARD_TTL_MS) cardStore.delete(k);
    }
  }
  cardStore.set(key, { at: Date.now(), container, order, states });
}

// 插件卸载时清空全部瞬态(注册表 + 卡片存储)
export function resetTransientState() {
  orderRegistry.clear();
  cardStore.clear();
  lastKeyNullContainer = null;
}
