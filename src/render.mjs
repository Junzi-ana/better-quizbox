/* Better Quiz Box — 渲染层(DOM 构建 / 视觉状态机 / 点击交互)
 */

import { saveCard } from "./state.mjs";

/* ------------------------------ 状态机 / 渲染 -------------------------------- */

export function nextState(state) {
  switch (state) {
    case " ": return "w";
    case "c": return "r";
    case "w": return " ";
    case "r": return "c";
    default: return state;
  }
}

export function buildBlock(container, data) {
  container.empty();
  const cls = ["quiz-block", "quiz-block--" + data.attrs.mode];
  // 编号小框仅在明确要显示编号时出现("none"表示显式无编号,不加此类以免空框)
  if (data.attrs.number === "abc" || data.attrs.number === "123") cls.push("quiz-block--numbered");
  const block = container.createDiv({ cls: cls.join(" ") });
  // hideStem:绑定块不保留题干时不建题干区(避免空框)
  if (data.hideStem !== true) {
    const single = !data.question.includes("\n");
    block.createDiv({ cls: single ? "quiz-question quiz-question--single" : "quiz-question" });
  }
  const list = block.createDiv({ cls: "quiz-options" });
  for (const opt of data.options) {
    const optEl = list.createDiv({ cls: "quiz-option" });
    optEl.dataset.optIdx = String(opt.optIdx);
    optEl.createSpan({ cls: "quiz-option__label" });
    optEl.createDiv({ cls: "quiz-option__body" });
  }
  if (data.details !== undefined) {
    block.createDiv({ cls: "quiz-details" });
  }
  return block;
}

export function applyVisuals(block, data, numberMode) {
  const mode = data.attrs.mode;
  const hasWrong = data.options.some((o) => o.state === "w");
  const hasAnswer = data.options.some((o) => o.state === "w" || o.state === "r");
  const rows = block.querySelectorAll(".quiz-option");
  rows.forEach((optEl, idx) => {
    const oi = parseInt(optEl.dataset.optIdx, 10);
    const o = data.options.find((x) => x.optIdx === oi);
    const cls = ["quiz-option"];
    if (mode === "static") {
      if (o && o.state === "c") cls.push("quiz-option--correct");
    } else if (mode === "non-immediate") {
      if (o && (o.state === "w" || o.state === "r")) cls.push("quiz-option--selected");
    } else {
      if (o && o.state === "w") cls.push("quiz-option--wrong");
      else if (o && o.state === "r") cls.push("quiz-option--right");
      else if (o && o.state === "c" && hasWrong) cls.push("quiz-option--revealed");
    }
    optEl.className = cls.join(" ");
    const label = optEl.querySelector(".quiz-option__label");
    if (label) {
      if (numberMode === "abc") label.setText(idx < 26 ? String.fromCharCode(65 + idx) : String(idx + 1));
      else if (numberMode === "123") label.setText(String(idx + 1));
      else label.setText("");
    }
  });
  const details = block.querySelector(".quiz-details");
  if (details) {
    const visible = mode === "static" || hasAnswer;
    details.toggleClass("quiz-details--visible", visible);
  }
}

/* ------------------------------- 交互:瞬态作答 ------------------------------- */

export function dynamicClick(block, data, opt, key, container, order, multi) {
  const p = nextState(opt.state);
  if (!multi && (p === "w" || p === "r")) {
    // 单选:清除其它项此前残留的 w/r 状态;多选则不互斥,各自开/关
    for (const u of data.options) {
      if (u.optIdx !== opt.optIdx) {
        if (u.state === "w") u.state = " ";
        else if (u.state === "r") u.state = "c";
      }
    }
  }
  opt.state = p;
  const saved = new Map();
  for (const u of data.options) saved.set(u.optIdx, u.state);
  saveCard(key, container, order, saved);
  applyVisuals(block, data, data.attrs.number);
}
