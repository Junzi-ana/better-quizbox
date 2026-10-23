/* Better Quiz Box — 渲染层(DOM 构建 / 视觉状态机 / 点击交互)
 */

import { saveCard, dropCard } from "./state.mjs";
import { t } from "./i18n.mjs";

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

export function applyVisuals(block, data, numberMode, ctrl) {
  const mode = data.attrs.mode;
  const hasWrong = data.options.some((o) => o.state === "w");
  const hasAnswer = data.options.some((o) => o.state === "w" || o.state === "r");
  const rows = block.querySelectorAll(".quiz-option");
  const ansLetters = [];  // 批改横幅:正确答案字母(按显示顺序,c/r 都算)
  const pickLetters = []; // 批改横幅:你的选择字母(w/r 都算,供"你的选择"文案)
  rows.forEach((optEl, idx) => {
    const oi = parseInt(optEl.dataset.optIdx, 10);
    const o = data.options.find((x) => x.optIdx === oi);
    const cls = ["quiz-option"];
    const correct = o && (o.state === "c" || o.state === "r");
    let letterTxt = "";
    if (numberMode === "abc") letterTxt = idx < 26 ? String.fromCharCode(65 + idx) : String(idx + 1);
    else if (numberMode === "123") letterTxt = String(idx + 1);
    // 横幅字母:开了 abc/123 用同款标签;无编号时回落 A/B/C(按显示位置)
    const bannerLetter = numberMode === "123" ? String(idx + 1)
      : numberMode === "abc" ? letterTxt
      : idx < 26 ? String.fromCharCode(65 + idx) : String(idx + 1);
    if (mode === "static") {
      if (o && o.state === "c") cls.push("quiz-option--correct");
    } else if (mode === "non-immediate" && data.submitted) {
      // 批改后:对选绿✓ / 错选红✗ / 漏选(正确未选)恒揭示 — 不管有无错选都标出完整正确答案
      if (o && o.state === "w") cls.push("quiz-option--wrong");
      else if (o && o.state === "r") cls.push("quiz-option--right");
      else if (o && o.state === "c") cls.push("quiz-option--revealed");
      cls.push("quiz-option--locked");
    } else if (mode === "non-immediate") {
      if (o && (o.state === "w" || o.state === "r")) cls.push("quiz-option--selected");
    } else {
      if (o && o.state === "w") cls.push("quiz-option--wrong");
      else if (o && o.state === "r") cls.push("quiz-option--right");
      else if (o && o.state === "c" && hasWrong) cls.push("quiz-option--revealed");
    }
    optEl.className = cls.join(" ");
    const label = optEl.querySelector(".quiz-option__label");
    if (label) label.setText(numberMode === "abc" || numberMode === "123" ? letterTxt : "");
    if (data.submitted && mode === "non-immediate") {
      if (correct) ansLetters.push(bannerLetter);
      if (o && (o.state === "w" || o.state === "r")) pickLetters.push(bannerLetter);
    }
  });
  const details = block.querySelector(".quiz-details");
  if (details) {
    const visible = mode === "static" || hasAnswer;
    details.toggleClass("quiz-details--visible", visible);
  }
  if (ctrl) setupActions(block, data, ctrl, ansLetters, pickLetters);
}

/* ------------------- 批改流(先选后查:提交 / 重置 / 汇总) ------------------- */

// 批改汇总(纯函数):错选 = 选错的(w) / 漏选 = 正确但未选(c) / 对选 = r
// 注意提交瞬间状态未经过变换:w 即错选、c 即漏选、r 即对选,三种互斥可数
export function gradeSummary(data) {
  let wrongSel = 0;
  let missed = 0;
  const correctIdxs = [];
  for (const o of data.options) {
    if (o.state === "c" || o.state === "r") correctIdxs.push(o.optIdx);
    if (o.state === "c") missed++;
    else if (o.state === "w") wrongSel++;
  }
  return {
    ok: correctIdxs.length > 0 && wrongSel === 0 && missed === 0,
    wrongSel,
    missed,
    correctIdxs,
  };
}

// 右下角操作区(仅 non-immediate 且 submit 未关):批改横幅 + 提交/重置按钮
// 操作区追加在块底部(选项+解析之后);本次渲染生命周期内只建一次,点击处理挂在首次创建时,
// 闭包持有 ctrl 且 data 为本次渲染的原地对象(作答/批改态就地改存,指针稳定)
function setupActions(block, data, ctrl, ansLetters, pickLetters) {
  if (data.attrs.mode !== "non-immediate" || data.submit === false || !data.options.length) return;
  // 操作区在 applyVisuals 末尾追加到块底部(选项+解析之后);本次渲染生命周期内只建一次
  let foot = block.querySelector(".quiz-actions");
  if (!foot) foot = block.createDiv({ cls: "quiz-actions" });
  if (!foot.querySelector(".quiz-verdict")) foot.createDiv({ cls: "quiz-verdict" });
  if (!foot.querySelector(".quiz-action-btn--submit")) {
    const submitBtn = foot.createDiv({ cls: "quiz-action-btn quiz-action-btn--submit", text: t("提交") });
    submitBtn.addEventListener("click", () => submitQuiz(block, data, ctrl));
  }
  if (!foot.querySelector(".quiz-action-btn--reset")) {
    const resetBtn = foot.createDiv({ cls: "quiz-action-btn quiz-action-btn--reset", text: t("重置") });
    resetBtn.addEventListener("click", () => {
      dropCard(ctrl.key); // 重置 = 刷新:清瞬态(顺序+作答+批改态),重渲染后全新重摇
      ctrl.rerender();
    });
  }
  const verdict = foot.querySelector(".quiz-verdict");
  if (verdict) {
    if (data.submitted) {
      // 文案模板由设置提供:{ans}=正确答案字母,{pick}=你的选择字母(均按显示顺序)
      const ok = gradeSummary(data).ok;
      const tpl = ok ? (data.verdictOk || t("回答正确！"))
                     : (data.verdictBad || t("回答错误！正确答案：{ans}，你的选择：{pick}"));
      const txt = tpl
        .replace(/\{ans\}/g, ansLetters.join(""))
        .replace(/\{pick\}/g, pickLetters.join(""));
      verdict.setText(txt);
      verdict.toggleClass("quiz-verdict--ok", ok);
      verdict.toggleClass("quiz-verdict--bad", !ok);
      verdict.toggleClass("quiz-verdict--visible", true);
    } else {
      verdict.setText("");
      verdict.toggleClass("quiz-verdict--visible", false);
    }
  }
  const submitBtn = foot.querySelector(".quiz-action-btn--submit");
  if (submitBtn) {
    const hasSel = data.options.some((o) => o.state === "w" || o.state === "r");
    submitBtn.toggleClass("quiz-action-btn--hidden", data.submitted || !hasSel);
  }
  const resetBtn = foot.querySelector(".quiz-action-btn--reset");
  if (resetBtn) {
    // 重置按钮:手动重置模式批改后必显;自动重置模式下受设置控制(可不显示,靠切页自动重置)
    const showReset = data.submitted && (data.reset === "manual" || data.showReset !== false);
    resetBtn.toggleClass("quiz-action-btn--hidden", !showReset);
  }
}

// 提交:锁动作 + 存批改态 + 批改视觉(w=错选红 / c=漏选揭示 / r=对选绿)
export function submitQuiz(block, data, ctrl) {
  if (data.submitted) return;
  data.submitted = true;
  const saved = new Map();
  for (const u of data.options) saved.set(u.optIdx, u.state);
  saveCard(ctrl.key, ctrl.container, ctrl.order, saved, ctrl.optSig, true);
  applyVisuals(block, data, data.attrs.number, ctrl);
}

/* ------------------------------- 交互:瞬态作答 ------------------------------- */

export function dynamicClick(block, data, opt, ctrl, multi) {
  if (data.submitted) return; // 已批改锁定,重置后才可再作答
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
  saveCard(ctrl.key, ctrl.container, ctrl.order, saved, ctrl.optSig);
  applyVisuals(block, data, data.attrs.number, ctrl);
}
