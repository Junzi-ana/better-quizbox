/* Better Quiz Box
 * 交互式多项选择题块插件(纯瞬态作答;Markdown/LaTeX 题干、选项与解析;
 * static / immediate / non-immediate 三种模式;SR 复习友好,支持绑定镜像与翻面复原)
 *
 * 源码风格与包结构:
 *   src/parse.mjs    解析层(块属性注释 + quiz 源文本解析 + 源顺序/随机顺序辅助)
 *   src/idassign.mjs 自动 id 分配(内容无关的计数器编号,见下)
 *   src/idindex.mjs  全库 id 索引(正向查表 + 反向引用 + 活动绑定 + 绑定解析)
 *   src/state.mjs    状态层(卡片级瞬态作答存储,内存不落盘)
 *   src/render.mjs   渲染层(DOM 构建 + 视觉状态机 + 点击交互)
 *   src/main.mjs     入口(代码块处理器注册 + 插件主体,本文件)
 *
 * 块语法概览:
 *   `` ```quiz ``
 *     题干(Markdown / LaTeX)
 *     [ ] 选项A
 *     [c] 选项B(正确项;源码遗留的 [w]/[r] 一律按未选处理)
 *     ... 选项支持多行(中间段非选项行并入上一选项)
 *     [h] 解析/说明(放在末选项之后；为可选,无 [h] 时末选项后的文本视为解析)
 *   `` ``` ``
 *
 * 可选块属性(整行 HTML 注释,放块内任意位置、每个属性一行、首个生效):
 *     <!-- mode: static | immediate | non-immediate -->  缺省 immediate
 *     <!-- shuffle: on | off -->                         缺省 on(仅动态块)
 *     <!-- number: abc | 123 | none -->                  缺省 none(按显示顺序编号)
 *     <!-- id: 名字 -->        块标识(计数器自动分配或手动写;一旦分配永不改写)
 *     <!-- bind: 名字 -->      只读镜像某道题(默认藏题干,可选 stem: on)
 *     <!-- copy: 名字 -->      可作答镜像某道题,保留其模式
 *     <!-- stem: on | off -->  绑定是否保留题干
 *
 * id 语义:计数器编号(文件名 hash 前缀 + 块号),内容无关 → 编辑题面 id 不变、
 * 引用永不失效 → 绑定/复制自动跟随目标最新内容,不重写、不闪。
 * 顺序:动态块每次"新开"(新容器/换卡/重开文件/选项真变)重新随机;
 * 同卡编辑题干不重摇(选项未变则顺序沿用);绑定块跟随目标当前显示顺序。
 */

import {
  parseQuiz,
  sourceOrder,
  randomOrder
} from "./parse.mjs";
import {
  reorderRowsTo,
  resolveCard,
  saveCard,
  noteRendered,
  stableContainer,
  resetTransientState
} from "./state.mjs";
import { buildBlock, applyVisuals, dynamicClick, gradeSummary } from "./render.mjs";
import { DEFAULT_SETTINGS, QuizBoxSettingTab } from "./settings.mjs";
import { assignCounterIds, renumberFile, collectIdMap, rewriteRefsInText, fileIdOf, hashLenOf } from "./idassign.mjs";
import {
  baseOf,
  lookupId,
  setOrderOf,
  getRefFiles,
  replaceFileEntries,
  buildIndex,
  removeFileEntries,
  clearIndex,
  registerLiveBinding,
  notifyLiveBindings,
  resolveBinding,
  setLogHook,
  stats,
  usedBlockNums,
  allIds,
  optSigOf
} from "./idindex.mjs";
import { Plugin, Modal, MarkdownRenderer, debounce, Menu, Notice, TFile, setIcon } from "obsidian";
import { t, isZh, WEEKDAYS } from "./i18n.mjs";

/* -------------------------------- 处理器注册 -------------------------------- */

// ------------------------------ 收藏按钮 ------------------------------
// 学 mathcraft 的定位:编辑视图 = 代码块外壳(.cm-embed-block)右上角绝对定位 + hover 淡入。
// 关键差异——动态读位:Obsidian 的 "</>"(.edit-block-button)和 mathcraft 的引用钮
// (.callout-copy-button/.equation-copy-button)常或临时占据右上角那排。我们用 MutationObserver
// 监听外壳子节点(这些按钮出现/消失都引起 DOM 变化),实时测量当前最左侧占用者的左缘,
// 把收藏钮排到它们整排的左侧;占用越多越往左挪,一个都没有时就贴近右缘。零硬编码坐标。
const BTN_KEYS = [".edit-block-button", ".callout-copy-button", ".equation-copy-button", ".callout-refs-button"];

// 收藏按钮全库注册表:key(卡片) → Set<按钮元素>。点击任一按钮切换收藏后,
// 同步刷新所有同 key 按钮的星状态 → 编辑/阅读视图之间即时同步,不再等切页重渲染。
const favButtons = new Map();

function toggleFav(key, plugin, btn) {
  const favs = plugin.settings.favorites || {};
  const wasOn = favs[key] ? true : false;
  if (wasOn) delete favs[key];
  else favs[key] = { addedAt: Date.now(), reviews: [] }; // reviews: 复习时间槽位(接口预留)
  plugin.settings.favorites = favs;
  plugin.saveSettings();
  // 同步刷新本库所有同 key 按钮的星态(编辑/阅读视图一起变,即时互通);顺带惰性清扫断连按钮
  const peers = favButtons.get(key);
  if (peers) {
    for (const b of [...peers]) {
      if (!b.isConnected) { peers.delete(b); continue; }
      applyFavState(b, !wasOn);
    }
    if (!peers.size) favButtons.delete(key);
  }
  // 收藏夹视图开着时同步刷新列表(星按钮/列表行两处入口都从这里过)
  refreshFavViews();
  new Notice(t(wasOn ? "已取消收藏" : "已收藏"));
}

// 判断某 key 是否已收藏(星态读取用)
function isFaved(favorites, key) {
  return favorites && typeof favorites[key] === "object";
}

function applyFavState(btn, on) {
  btn.toggleClass("bqb-fav-on", on);
  btn.setAttribute("aria-label", t(on ? "取消收藏" : "收藏本题"));
}

function registerFavBtn(key, btn) {
  let s = favButtons.get(key);
  if (!s) { s = new Set(); favButtons.set(key, s); }
  s.add(btn);
}

// 编辑视图动态读位:测量当前最左占用者,收藏钮排到它左侧;dx 为设置栏横向微调叠加量。
// 测不到占用者时也绝不盖住 "</>"(备预算位到 36px,即 </> 左缘近似位),宁左勿盖。
function placeFavoriteOnEmbed(embed, btn, dx) {
  const pad = 2; // 与右侧相邻兄弟的间隔
  let leftmost = null;
  for (const sel of BTN_KEYS) {
    const el = embed.querySelector(sel);
    if (el && el.offsetParent !== null) {
      const r = el.getBoundingClientRect();
      const er = embed.getBoundingClientRect().right;
      const fromRight = er - r.left;
      if (fromRight >= 0 && (leftmost === null || fromRight > leftmost)) leftmost = fromRight;
    }
  }
  // 无占用者时:给 "</>" 预留 ~34px(其默认右缘位置),而不是贴 4px 盖住它
  const right = leftmost === null ? 36 : leftmost + pad;
  btn.style.right = (right + (dx || 0)) + "px";
}

function ensureEmbedObserver(embed, btn) {
  if (embed.__bqbObs) return;
  // 排位:立即 + 多帧兜底(启动时 "</>"/mathcraft 按钮常晚于本块注入,首帧可能测不到
  // → 会误贴到它们的位置;延迟若干帧重排,以及监听子节点变化,覆盖晚出现/晚消失)
  const reposition = () => {
    if (btn.isConnected) placeFavoriteOnEmbed(embed, btn, embed.__bqbDX || 0);
  };
  reposition(); // 首次
  for (const ms of [100, 300, 800]) setTimeout(reposition, ms); // 晚注入兜底
  // 之后任一 </> 或引用钮增删/可见性变化都重排
  let timer = null;
  embed.__bqbObs = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; reposition(); }, 50);
  });
  embed.__bqbObs.observe(embed, { childList: true, subtree: true, attributes: true });
}

function setupFavoriteButton(block, plugin, key) {
  if (!key) return;
  const embed = block.closest ? block.closest(".cm-embed-block") : null;
  if (embed) {
    let btn = embed.querySelector(":scope > .bqb-fav-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      // 外观交给 Obsidian 内建 .clickable-icon(与 mathcraft 同款:无边框无背景、hover 变暗),
      // 定位由我们绝对定位 + 动态读位(placeFavoriteOnEmbed)负责。
      btn.className = "bqb-fav-btn clickable-icon";
      btn.setAttribute("aria-label", t("收藏本题"));
      setIcon(btn, "star");
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        toggleFav(key, plugin, btn);
      });
      embed.appendChild(btn);
    }
    embed.__bqbDX = plugin.settings.favBtn?.editDX || 0;
    btn.toggleClass("bqb-fav-on", isFaved(plugin.settings.favorites, key));
    registerFavBtn(key, btn);
    placeFavoriteOnEmbed(embed, btn, embed.__bqbDX);
    ensureEmbedObserver(embed, btn);
    return;
  }
  // 阅读视图:无 </>/引用占用,补位到编辑视图 </> 默认出现的格子
  // (同基准 top/right var(--size-2-2)),dx/dy 由设置栏经 CSS 变量叠加。
  let btn = block.querySelector(":scope > .bqb-fav-btn");
  if (!btn) {
    btn = block.createEl("button", { cls: "bqb-fav-btn clickable-icon", attr: { "aria-label": t("收藏本题") } });
    setIcon(btn, "star");
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      toggleFav(key, plugin, btn);
    });
  }
  btn.toggleClass("bqb-fav-on", isFaved(plugin.settings.favorites, key));
  registerFavBtn(key, btn);
}

/* ------- 收藏夹 / 复习独立窗口 ------- */

// 卡片 key 分隔符(与 state.mjs 约定一致:文件<0>id;无 id 块的内容串还含 <1>/<2> 分隔)。
// 用 fromCharCode 而不写字面 \u 转义,避免源文件被塞进真实控制字符。
const KEY_FILE_SEP = String.fromCharCode(0);
const KEY_PART_SEP = String.fromCharCode(1);

// 共享小工具:两位补零 / 星期名(双语) / 日历 key("YYYY-MM-DD",activity 表与热力图同款)
const pad2 = (n) => String(n).padStart(2, "0");
function dateKeyOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

// 判定文案模板(设置可调):{ans}=正确答案字母,{pick}=你的选择字母。
// 笔记里的批改横幅与复习页判定共用这一份兜底。
// 非中文界面:若仍是用户没改过的出厂中文文案,自动换成英文默认(用户自定义过的原样尊重)。
function verdictTexts(settings) {
  const zhOk = DEFAULT_SETTINGS.verdictOk;
  const zhBad = DEFAULT_SETTINGS.verdictBad;
  let ok = settings.verdictOk || zhOk;
  let bad = settings.verdictBad || zhBad;
  if (!isZh) {
    if (ok === zhOk) ok = "Correct! Answer: {ans}.";
    if (bad === zhBad) bad = "Wrong! Answer: {ans}; yours: {pick}.";
  }
  return { ok: t(ok), bad: t(bad) };
}

// 学习面板开着时刷新(toggleFav 与索引重建都会调)
function refreshFavViews() {
  if (studyPanel) studyPanel.render();
}

// 时间戳显示:本地 YYYY-MM-DD HH:mm(收藏时间与复习记录同款)
function fmtTs(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/* ============ 复习进度(纯函数,可测) ============ */
// 复习记录 reviews[i] = { t 复习时间戳, ok 这对错 }
// 复习排期按"最后一次复习时间"推导(不申请新字段,接口就是 reviews):
//   - 从未复习 → null(待学习)
//   - 最后一次答对 → 排期 = t + 7 天;答错 → t + 2 天(象征值,便于测试)
// 约定:每过一天取一次复习记录,多答只记最终对错(连续点击不叠加次数)。
const REVIEW_OK_DAYS = 7; // 答对 → 7 天后再见(测试值)
const REVIEW_BAD_DAYS = 2; // 答错 → 2 天后(测试值)
const MK_DAY = 24 * 3600 * 1000;

// 状态:new(待学习) / learn(已学习未到期) / due(待复习)
export function reviewState(recs, now) {
  if (!Array.isArray(recs) || !recs.length) return "new";
  const last = recs[recs.length - 1];
  const ok = !!last.ok;
  const due = last.t + (ok ? REVIEW_OK_DAYS : REVIEW_BAD_DAYS) * MK_DAY;
  return now >= due ? "due" : "learn";
}

// 该题排期到的时刻(未复习返回 null)
export function reviewDue(recs) {
  if (!Array.isArray(recs) || !recs.length) return null;
  const last = recs[recs.length - 1];
  return last.t + (last.ok ? REVIEW_OK_DAYS : REVIEW_BAD_DAYS) * MK_DAY;
}

/* ============ 题型(用户脚本判定) ============ */
// 编译用户脚本:每条 {name, code} → {name, fn}。code 是函数体源码,收到选项数组 o
// (每项 {optIdx, state("c"=正确), text}),返回真值即命中。语法错误的条目丢弃,不崩。
export function compileTypeRules(rules) {
  const out = [];
  for (const r of rules || []) {
    if (!r || !r.name || typeof r.code !== "string") continue;
    try {
      out.push({ name: r.name, fn: new Function("o", `"use strict";\n${r.code}`) });
    } catch (e) { /* 语法错误:丢弃该条 */ }
  }
  return out;
}

// 题型判定:按设置顺序首个命中即定型(互斥);用户代码运行错跳过该条;
// 都不中按正确选项数归单选/多选。
export function quizTypeOf(opts, compiled) {
  for (const c of compiled || []) {
    try {
      if (c.fn(opts)) return c.name;
    } catch (e) { /* 运行错误:跳过该条 */ }
  }
  const correct = (opts || []).filter((o) => o.state === "c").length;
  return correct >= 2 ? "多选" : "单选";
}

/* ============ 收藏夹 / 复习专用独立窗口 ============ */
// 像 Spaced Repetition 的闪卡复习窗口:一个 modal 弹窗(非侧栏、非标签页),内置
// 主页(home)/题库(bank)/复习(review)三个视图。单例体质:开着一个再点星图标=聚焦它。
let studyPanel = null;
function openPanel(plugin) {
  if (studyPanel) {
    try { studyPanel.open(); } catch (e) {}
    return studyPanel;
  }
  studyPanel = new StudyPanel(plugin.app, plugin);
  studyPanel.open();
  return studyPanel;
}

class StudyPanel extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.page = "home"; // home=主页 / bank=题库(原收藏夹列表) / review=复习
    this.tab = "folder"; // 题库页内标签(folder=按目录 cats=分类)
    this.showFavs = false; // 题库页「显示收藏」开关:关=全库题目,开=只列已收藏
    // 复习会话(临时状态,不落盘):本轮队列/游标/对错计数/rCommitted=已提交记账的题key(防重)
    this.rQueue = [];
    this.rIdx = 0;
    this.rOk = 0;
    this.rBad = 0;
    this.rCommitted = null;
  }
  // 视图注册表:未来加其它视图(搜索/统计页等)只需在这里追加一项 + 一个渲染分支,接口在此
  static TABS = [
    { id: "folder", name: "按目录" },
    { id: "cats", name: "按分类" },
    { id: "types", name: "按题型" },
  ];
  async onOpen() {
    if (this.modalEl) this.modalEl.addClass("bqb-study-modal");
    this.setTitle("Better Quiz Box");
    this.render();
    // 不聚焦:Obsidian 打开弹窗会自动聚焦首个可聚焦元素,主题给焦点态换边框观感,
    // 导致"开始复习"和"题库"看起来不一致。本面板纯点击操作不需要焦点,打开后归还。
    requestAnimationFrame(() => {
      try { document.activeElement?.blur?.(); } catch (e) {}
    });
  }
  async onClose() { if (studyPanel === this) studyPanel = null; }

  render() {
    const root = this.contentEl;
    root.empty();
    if (this.page === "home") this.renderHome(root);
    else if (this.page === "review") this.renderReview(root);
    else this.renderList(root);
  }
  go(page) { this.page = page; this.render(); }

  // 返回主页按钮(复习页/题库页共用,同一套路):左箭头,回主页同时清复习会话
  backBtn(parent) {
    const back = parent.createEl("a", { cls: "bqb-study-back clickable-icon", attr: { "aria-label": t("返回主页") } });
    setIcon(back, "left-arrow");
    back.addEventListener("click", () => { this.rQueue = []; this.rCommitted = null; this.go("home"); });
    return back;
  }

  /* ---------- 主页:问候语 + 统计 + 进度条 + 热力图 + 两个入口 ---------- */
  renderHome(root) {
    const d = new Date();
    const h = d.getHours();
    const greet = h < 6 ? "夜深了" : h < 9 ? "早上好" : h < 12 ? "上午好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
    root.createDiv({ cls: "bqb-study-greet" }).setText(t(greet) + " · " + t("{m}月{d}日 周{w}", { m: d.getMonth() + 1, d: d.getDate(), w: WEEKDAYS[d.getDay()] }));
    // 统计口径与题库列表一致:全库 ∪ 学习记录 ∪ 收藏
    const favs = this.plugin.settings.favorites || {};
    const study = this.plugin.settings.study || {};
    const keys = new Set([...allIds(), ...Object.keys(study), ...Object.keys(favs)]);
    const now = Date.now();
    let learned = 0, due = 0;
    for (const k of keys) {
      const s = reviewState(study[k] && study[k].reviews, now);
      if (s !== "new") learned++;
      if (s === "due") due++;
    }
    const row = root.createDiv({ cls: "bqb-study-stats" });
    const stat = (n, label) => {
      const c = row.createDiv({ cls: "bqb-study-stat" });
      c.createDiv({ cls: "bqb-study-stat-num" }).setText(String(n));
      c.createDiv({ cls: "bqb-study-stat-label" }).setText(t(label));
    };
    stat(keys.size, "总题数");
    stat(learned, "已学习");
    stat(due, "待复习");
    stat(keys.size - learned, "待学习");
    // 进度条:已学习 / 总数
    const bar = root.createDiv({ cls: "bqb-study-bar" });
    bar.createDiv({ cls: "bqb-study-bar-fill" }).style.width = Math.round((learned / (keys.size || 1)) * 100) + "%";
    // 热力图先渲染,入口按钮放它下面
    this.renderHeat(root);
    const ent = root.createDiv({ cls: "bqb-study-entries" });
    const rev = ent.createEl("button", { cls: "bqb-study-go", text: t("开始复习") });
    rev.addEventListener("click", () => this.go("review"));
    const bank = ent.createEl("button", { cls: "bqb-study-go", text: t("题库") });
    bank.addEventListener("click", () => this.go("bank"));
  }

  // 某天的学习详情(供信息面板):每题第一条复习记录=学习新卡片,其后=复习旧卡片;
  // 当日发生的学习/复习次数与答对答错;无记录返回 null
  dayDetail(key) {
    const study = this.plugin.settings.study || {};
    let learn = 0, review = 0, ok = 0, bad = 0;
    for (const rec of Object.values(study)) {
      const rs = rec?.reviews || [];
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i];
        if (r && typeof r.t === "number" && dateKeyOf(r.t) === key) {
          if (i === 0) learn++; else review++; // 首条=新卡,其后=复习
          if (r.ok) ok++; else bad++;
        }
      }
    }
    const n = learn + review;
    return n ? { n, learn, review, ok, bad, rate: ok / n } : null;
  }

  // 热力图:近 15 周每日学习/复习记录,仿 GitHub 贡献图(月份/星期标签 + 格子 + 右侧信息面板)
  // 结构:星期列 | 热力主体(月份行 + 格子行,两者同列宽同 gap 天然对齐) | 信息面板
  renderHeat(root) {
    root.createDiv({ cls: "bqb-study-sec" }).setText(t("学习记录"));
    const act = this.plugin.settings.activity || {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayKey = dateKeyOf(Date.now()); // 今日格子描边/信息面板默认都用它
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // 对齐到本周一
    const wrap = root.createDiv({ cls: "bqb-study-heatwrap" });
    // 左列星期标签(只显示 一/三/五,同 GitHub)
    const days = wrap.createDiv({ cls: "bqb-study-heat-days" });
    days.createDiv({ cls: "bqb-study-heat-wlabel" }); // 顶部占位(与月份行同高)
    for (let i = 0; i < 7; i++) {
      days.createDiv({ cls: "bqb-study-heat-wlabel", text: (i === 1 || i === 3 || i === 5) ? WEEKDAYS[i] : "" });
    }
    // 中间热力主体:月份行 + 格子行(同容器,同列宽)
    const main = wrap.createDiv({ cls: "bqb-study-heat-main" });
    const months = main.createDiv({ cls: "bqb-study-heat-months" });
    let lastMonth = null;
    for (let w = 14; w >= 0; w--) {
      const d = new Date(monday);
      d.setDate(monday.getDate() - w * 7);
      const m = d.getFullYear() * 12 + d.getMonth(); // 连续月份值,可比较
      months.createDiv({ cls: "bqb-study-heat-mlabel", text: m !== lastMonth ? t("{m}月", { m: d.getMonth() + 1 }) : "" });
      lastMonth = m;
    }
    // 右侧详情面板:默认显示今天,悬停某格切换成那一天(先建函数供格子 hover 用)
    const info = wrap.createDiv({ cls: "bqb-study-heat-info" });
    const renderInfo = (key) => {
      info.empty();
      const det = this.dayDetail(key);
      const d = new Date(key + "T00:00:00");
      info.createDiv({ cls: "bqb-study-hi-title" })
        .setText(t("{m}月{d}日 周{w}", { m: d.getMonth() + 1, d: d.getDate(), w: WEEKDAYS[d.getDay()] }));
      if (!det) {
        info.createDiv({ cls: "bqb-study-hi-line" }).setText(t("没有复习记录"));
        return;
      }
      info.createDiv({ cls: "bqb-study-hi-line" }).setText(t("学习新卡片 {a} 张 · 复习旧卡片 {b} 张", { a: det.learn, b: det.review }));
      info.createDiv({ cls: "bqb-study-hi-line bqb-study-hi-line--ok" }).setText(t("答对 {a} · 答错 {b}", { a: det.ok, b: det.bad }));
      info.createDiv({ cls: "bqb-study-hi-line" }).setText(t("正确率 {p}%", { p: Math.round(det.rate * 100) }));
    };
    const grid = main.createDiv({ cls: "bqb-study-heat-grid" });
    for (let w = 14; w >= 0; w--) {
      const col = grid.createDiv({ cls: "bqb-study-heat-col" });
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() - w * 7 + i);
        if (d > today) { col.createDiv({ cls: "bqb-study-heat-cell bqb-heat-lv0" }); continue; } // 未来日与无记录同款淡色
        const key = dateKeyOf(d.getTime());
        const n = act[key] || 0;
        const cell = col.createDiv({ cls: "bqb-study-heat-cell" });
        cell.classList.add(n >= 8 ? "bqb-heat-lv4" : n >= 4 ? "bqb-heat-lv3" : n >= 2 ? "bqb-heat-lv2" : n >= 1 ? "bqb-heat-lv1" : "bqb-heat-lv0");
        if (key === todayKey) cell.addClass("bqb-heat-today");
        cell.setAttribute("aria-label", t("{d} · 复习 {n} 题", { d: key, n }));
        cell.addEventListener("mouseenter", () => renderInfo(key));
        cell.addEventListener("click", () => renderInfo(key)); // 触屏点按也能看
      }
    }
    renderInfo(todayKey); // 默认显示今天
  }

  /* ---------- 复习页:从全库抽 10 题逐题作答,判对错并写排期 ---------- */
  startReview() {
    const ids = [...allIds()];
    for (let i = ids.length - 1; i > 0; i--) { // Fisher-Yates 洗牌
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    this.rQueue = ids.map((k) => ({ key: k, ref: lookupId(k) })).filter((x) => x.ref).slice(0, 10);
    this.rIdx = 0; this.rOk = 0; this.rBad = 0; this.rCommitted = null;
  }
  renderReview(root) {
    if (!this.rQueue.length) this.startReview();
    if (!this.rQueue.length) { // 全库没有可复习的题
      root.createDiv({ cls: "bqb-study-empty" }).setText(t("全库还没有可复习的 quiz(id 索引为空)。"));
      return;
    }
    if (this.rIdx >= this.rQueue.length) { this.renderReviewDone(root); return; }
    const cur = this.rQueue[this.rIdx];
    const ref = cur.ref;
    const head = root.createDiv({ cls: "bqb-study-rvhead" });
    this.backBtn(head);
    head.createSpan({ cls: "bqb-study-rvprog" }).setText(t("第 {a} / {b} 题", { a: this.rIdx + 1, b: this.rQueue.length }));
    // 新/旧徽标:有无复习记录一目了然(没学过的=新卡,有记录的=复习)
    const isNew = !(this.plugin.settings.study?.[cur.key]?.reviews || []).length;
    head.createSpan({ cls: "bqb-study-rvbadge " + (isNew ? "bqb-rvbadge-new" : "bqb-rvbadge-old") })
      .setText(t(isNew ? "新卡" : "复习"));

    // —— 复用正牌 quiz 渲染/交互(non-immediate + 提交判分),与笔记里完全一致 ——
    // display 与 runRender 同等形态;选项深拷贝,state 保留正确标记("c"=正确项),
    // dynamicClick 在此基础上切换选态("c"→"r" 对选 / " "→"w" 错选),判分靠它。
    const data = {
      attrs: {
        mode: "non-immediate",
        shuffle: true,
        number: this.plugin.settings.defaultNumbering || "none",
        submit: true,
        reset: "auto", // 非 manual → 提交后不显示重置按钮(复习作答锁在批改态)
      },
      question: ref.question || t("(无题干)"),
      options: ref.options.map((o) => ({ optIdx: o.optIdx, state: o.state, text: o.text })),
      details: ref.details,
      submitted: false,
    };
    data.submit = data.attrs.submit !== false;
    data.reset = "auto";
    data.showReset = false; // 复习流程不显示"重置",作答锁在批改态
    const vt = verdictTexts(this.plugin.settings);
    data.verdictOk = vt.ok;
    data.verdictBad = vt.bad;
    const isMulti = data.options.filter((o) => o.state === "c").length > 1;
    const container = root.createDiv({ cls: "bqb-study-card" });
    const optSig = optSigOf(data.options);
    const order = ref.currentOrder && ref.currentOrder.length === data.options.length
      ? ref.currentOrder : sourceOrder(ref.options);
    const ctrl = { key: cur.key, container, order, optSig, rerender: () => this.render() };
    const block = buildBlock(container, data);
    // 渲染题干/选项/解析(Markdown / LaTeX,异步填字不阻塞交互挂接)
    const qEl = block.querySelector(".quiz-question");
    if (qEl) MarkdownRenderer.render(this.app, ref.question || t("(无题干)"), qEl, "", this.plugin).catch(() => {});
    block.querySelectorAll(".quiz-option__body").forEach((bodyEl) => {
      const oi = parseInt(bodyEl.parentElement.dataset.optIdx, 10);
      const o = data.options.find((x) => x.optIdx === oi);
      if (o) MarkdownRenderer.render(this.app, o.text, bodyEl, "", this.plugin).catch(() => {});
    });
    if (ref.details !== undefined) {
      const dEl = block.querySelector(".quiz-details");
      if (dEl) MarkdownRenderer.render(this.app, ref.details, dEl, "", this.plugin).catch(() => {});
    }
    reorderRowsTo(block, order);
    applyVisuals(block, data, data.attrs.number, ctrl); // 建提交按钮+判定横幅,应用选态着色
    // 点击选项:正牌 state 机(单选互斥/多选各自 toggle)
    block.querySelectorAll(".quiz-option").forEach((optEl) => {
      optEl.addEventListener("click", () => {
        const oi = parseInt(optEl.dataset.optIdx, 10);
        const opt = data.options.find((x) => x.optIdx === oi);
        if (!opt) return;
        dynamicClick(block, data, opt, ctrl, isMulti);
      });
    });
    // 提交判分:提交按钮自带的 submitQuiz 先跑(置 submitted+批改视觉),这里追加一次记账
    const subBtn = block.querySelector(".quiz-action-btn--submit");
    if (subBtn) {
      subBtn.addEventListener("click", () => {
        if (this.rCommitted === cur.key) return; // 防重复记账
        this.rCommitted = cur.key;
        this.record(cur, data, root);
      });
    }
    // 已提交过本题(切回/外部刷新重渲时):补上"下次复习"+下一题
    if (this.rCommitted === cur.key) {
      this.appendNext(root, cur);
    }
  }
  // 追加判定后的"下次复习时刻 + 下一题/完成"(原地插入,不重渲)
  appendNext(root, cur) {
    const span = root.createDiv({ cls: "bqb-study-rvnext" });
    span.setText(t("下次复习:{t}", { t: fmtTs(reviewDue(this.plugin.settings.study?.[cur.key]?.reviews)) }));
    const next = root.createEl("button", { cls: "bqb-study-next", text: t(this.rIdx + 1 >= this.rQueue.length ? "完成" : "下一题") });
    next.addEventListener("click", () => { this.rIdx++; this.rCommitted = null; this.render(); });
  }
  // 提交后判分落账:gradeSummary 计算对错 → 写复习记录(study 表)+ 当日热力 +1
  record(cur, data, root) {
    const ok = gradeSummary(data).ok;
    if (ok) this.rOk++; else this.rBad++;
    const study = this.plugin.settings.study || {};
    const now = Date.now();
    const rec = study[cur.key] || { reviews: [] };
    rec.reviews = [...(rec.reviews || []), { t: now, ok }];
    study[cur.key] = rec;
    this.plugin.settings.study = study;
    const act = this.plugin.settings.activity || {};
    const dk = dateKeyOf(now);
    act[dk] = (act[dk] || 0) + 1;
    this.plugin.settings.activity = act;
    this.plugin.saveSettings();
    this.appendNext(root, cur);
  }
  renderReviewDone(root) {
    root.createDiv({ cls: "bqb-study-greet" }).setText(t("复习完成"));
    root.createDiv({ cls: "bqb-study-done" }).setText(t("共 {n} 题 · 答对 {a} · 答错 {b}", { n: this.rQueue.length, a: this.rOk, b: this.rBad }));
    const btn = root.createEl("button", { cls: "bqb-study-next", text: t("返回主页") });
    btn.addEventListener("click", () => { this.rQueue = []; this.rCommitted = null; this.go("home"); });
  }

  /* ---------- 题库页(原收藏夹):全库浏览 + 显示收藏 ---------- */
  renderList(root) {
    const favs = this.plugin.settings.favorites || {};
    const favIds = Object.keys(favs);
    // 返回主页 + 顶栏;返回钮两页共用 backBtn(回主页同时清复习会话,统一路由)
    const bar = root.createDiv({ cls: "bqb-favbar" });
    this.backBtn(bar);
    const head = bar.createDiv({ cls: "bqb-favlist-head" });
    const showBtn = bar.createEl("button", { cls: "bqb-showfav" + (this.showFavs ? " bqb-showfav--on" : ""), text: t("显示收藏") });
    showBtn.addEventListener("click", () => { this.showFavs = !this.showFavs; this.render(); });
    // 数据源:全库所有 quiz id(id 索引);"显示收藏"开着时只列已收藏
    let keys;
    if (this.showFavs) {
      keys = favIds;
    } else {
      keys = [...allIds()];
      for (const k of favIds) if (!keys.includes(k)) keys.push(k); // 收藏但索引查不到的(已失效)也列
    }
    if (!keys.length) {
      head.setText(this.showFavs ? t("还没有收藏。点题目右上角的星收藏。") : t("还没有题目"));
      return;
    }
    head.setText(allIds().size === 0
      ? t("正在扫描,列表可能不全;")
      : t("共 {a} 题,已收藏 {b} 题", { a: keys.length, b: favIds.length }));
    const tabs = root.createDiv({ cls: "bqb-tabs" });
    for (const tab of StudyPanel.TABS) {
      const el = tabs.createDiv({ cls: "bqb-tab" + (this.tab === tab.id ? " bqb-tab--on" : "") });
      el.setText(t(tab.name));
      el.addEventListener("click", () => { this.tab = tab.id; this.render(); });
    }
    if (this.tab === "folder") this.renderFolder(root, keys);
    else if (this.tab === "cats") this.renderCats(root, keys);
    else if (this.tab === "types") this.renderTypes(root, keys);
  }

  // 共享条目行:星(点亮=已收藏,灰=未收藏,点击切换) + 题干缩略 + id/状态/时间/分类芯片 + 标签钮 + 点行跳转
  favRow(parent, key, ref) {
    const favs = this.plugin.settings.favorites || {};
    const assign = this.plugin.settings.catAssign || {};
    const study = this.plugin.settings.study || {};
    const faved = !!favs[key];
    const row = parent.createDiv({ cls: "bqb-favlist-row" });
    const star = row.createEl("a", { cls: "bqb-favlist-star clickable-icon", attr: { "aria-label": t(faved ? "取消收藏" : "收藏本题") } });
    setIcon(star, "star");
    if (faved) star.addClass("bqb-fav-on");
    else star.addClass("bqb-fav-off");
    star.addEventListener("click", () => {
      toggleFav(key, this.plugin);
      this.render();
    });
    const info = row.createDiv({ cls: "bqb-favlist-info" });
    const stem = info.createDiv({ cls: "bqb-favlist-stem" });
    stem.setText(ref ? (ref.question || t("(无题干)")) : t("找不到源题"));
    const meta = info.createDiv({ cls: "bqb-favlist-meta" });
    meta.createSpan({ cls: "bqb-favlist-id" }).setText(key);
    // 学习状态芯片:待学习(无复习记录)/待复习(已到期)/下次 复习时刻(未到期);复习记录存 study 表
    const st = reviewState(study[key] && study[key].reviews, Date.now());
    if (st === "due") meta.createSpan({ cls: "bqb-favlist-state bqb-state-due" }).setText(t("待复习"));
    else if (st === "learn") meta.createSpan({ cls: "bqb-favlist-state bqb-state-learn" }).setText(t("下次 {t}", { t: fmtTs(reviewDue(study[key].reviews)) }));
    else meta.createSpan({ cls: "bqb-favlist-state bqb-state-new" }).setText(t("待学习"));
    if (faved) meta.createSpan({ cls: "bqb-favlist-time" }).setText(fmtTs(favs[key].addedAt || Date.now()));
    for (const c of assign[key] || []) meta.createSpan({ cls: "bqb-favlist-cat" }).setText(c);
    const catBtn = row.createEl("a", { cls: "bqb-favlist-catbtn clickable-icon", attr: { "aria-label": t("归类到…") } });
    setIcon(catBtn, "tags");
    catBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.catMenu(key, ev);
    });
    // 整行可点跳转源文件(星/标签钮已 stopPropagation,不会误触);弹窗先关,主区切文件
    if (ref) {
      row.addEventListener("click", () => this.jump(ref.file));
      info.title = ref.file;
    } else {
      info.addClass("bqb-favlist-dead");
    }
  }

  // 归类菜单:原生 Menu 多选勾;分类独立于收藏——未收藏的题也能归类(存 catAssign)。「未分类」恒在底部
  catMenu(key, ev) {
    const cats = this.plugin.settings.favCats || [];
    const cur = this.plugin.settings.catAssign || {};
    const mine = cur[key] || [];
    const menu = new Menu();
    for (const c of cats) {
      menu.addItem((item) =>
        item
          .setTitle(c)
          .setChecked(mine.includes(c))
          .onClick(() => {
            const assign = this.plugin.settings.catAssign || {};
            const has = (assign[key] || []).includes(c);
            assign[key] = has ? assign[key].filter((x) => x !== c) : [...(assign[key] || []), c];
            this.plugin.settings.catAssign = assign;
            this.plugin.saveSettings();
            this.render();
          })
      );
    }
    if (cats.length) menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("未分类"))
        .setChecked(!mine.length)
        .onClick(() => {
          const assign = this.plugin.settings.catAssign || {};
          delete assign[key];
          this.plugin.settings.catAssign = assign;
          this.plugin.saveSettings();
          this.render();
        })
    );
    menu.showAtMouseEvent(ev);
  }

  renderFolder(root, keys) {
    // 目录树:按源文件路径的目录层级折叠,文件为叶节点(其下列题目行);查不到的垫底
    const dead = [];
    const treeRoot = { dirs: new Map(), files: [] };
    for (const key of keys) {
      const ref = lookupId(key);
      if (!ref) { dead.push(key); continue; }
      const parts = ref.file.split("/");
      const name = parts.pop();
      let node = treeRoot;
      for (const d of parts) {
        if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [] });
        node = node.dirs.get(d);
      }
      // 同一文件的多题合并进同一文件节点(否则每题各开一棵折叠栏)
      let fe = node.files.find((x) => x.name === name);
      if (!fe) { fe = { name, rows: [] }; node.files.push(fe); }
      fe.rows.push(key);
    }
    const cnt = (n) => n.files.reduce((s, f) => s + f.rows.length, 0)
      + [...n.dirs.values()].reduce((s, d) => s + cnt(d), 0);
    this.treeNode(root, treeRoot, cnt);
    if (dead.length) this.grpBox(root, t("已失效"), dead, null);
  }

  // 递归渲染目录树:目录/文件都是可折叠框(border-left 逐层缩进即成树);同级按名字排序稳定显示
  treeNode(parent, node, cnt) {
    for (const [d, sub] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const grp = parent.createDiv({ cls: "bqb-favgrp" });
      const head = grp.createDiv({ cls: "bqb-favgrp-head" });
      head.setText(d + " · " + cnt(sub));
      const body = grp.createDiv({ cls: "bqb-favgrp-body" });
      head.addEventListener("click", () => this.foldGrp(grp, body));
      this.treeNode(body, sub, cnt);
    }
    for (const f of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
      const grp = parent.createDiv({ cls: "bqb-favgrp" });
      const head = grp.createDiv({ cls: "bqb-favgrp-head" });
      head.setText(f.name + " · " + f.rows.length);
      const body = grp.createDiv({ cls: "bqb-favgrp-body" });
      head.addEventListener("click", () => this.foldGrp(grp, body));
      for (const r of f.rows) this.favRow(body, r, lookupId(r));
    }
  }

  foldGrp(grp, body) {
    const foldUp = body.style.display !== "none";
    body.style.display = foldUp ? "none" : "";
    grp.toggleClass("bqb-favgrp-closed", foldUp);
  }

  renderCats(root, keys) {
    // 管理行:新建自建分类
    const mg = root.createDiv({ cls: "bqb-catmg" });
    const input = mg.createEl("input", { cls: "bqb-catmg-input", attr: { type: "text", placeholder: t("新分类名…") } });
    const add = mg.createEl("button", { cls: "bqb-catmg-add", text: t("创建") });
    add.addEventListener("click", () => {
      const name = input.value.trim();
      if (!name) return;
      const cats = this.plugin.settings.favCats || [];
      if (!cats.includes(name)) cats.push(name);
      this.plugin.settings.favCats = cats;
      this.plugin.saveSettings();
      this.render();
    });
    // 按分类分组(独立 catAssign,未收藏的题同样归位);未归类的进「未分类」。
    // 空分类也直接出现(建好即显示,不必先有题)
    const groups = new Map();
    const defs = this.plugin.settings.favCats || [];
    const assign = this.plugin.settings.catAssign || {};
    for (const key of keys) {
      const cs = (assign[key] || []).filter((c) => defs.includes(c));
      if (!cs.length) {
        if (!groups.has(null)) groups.set(null, []);
        groups.get(null).push(key);
      } else {
        for (const c of cs) {
          if (!groups.has(c)) groups.set(c, []);
          groups.get(c).push(key);
        }
      }
    }
    const ordered = defs.map((c) => [c, groups.get(c) || []]);
    ordered.push([null, groups.get(null) || []]); // 未分类恒显示
    for (const [c, rows] of ordered) {
      this.grpBox(root, c === null ? t("未分类") : c, rows, c);
    }
  }

  // 按题型分组:每条自定义规则一组(空组也显示),没命中任何规则的按正确数归单选/多选。
  // 判定互斥:规则按设置里的顺序首个命中即定型。失效题(索引里没有)不出现在本页。
  renderTypes(root, keys) {
    const compiled = compileTypeRules(this.plugin.settings.qtypes);
    const groups = new Map();
    const order = [];
    const put = (name) => {
      if (!groups.has(name)) { groups.set(name, []); order.push(name); }
      return groups.get(name);
    };
    for (const r of compiled) put(r.name); // 自定义组空也显示(建了规则就能看到它收了哪些题)
    put("单选"); put("多选"); // 内置兜底组恒显示
    for (const key of keys) {
      const ref = lookupId(key);
      if (!ref) continue;
      put(quizTypeOf(ref.options, compiled)).push(key);
    }
    for (const name of order) {
      this.grpBox(root, t(name), groups.get(name) || [], null);
    }
  }

  // 可折叠分组框;delName 非 null = 自建分类(可删,删除同时从各条目 cats 里清掉,不取消收藏)
  grpBox(root, title, rows, delName) {
    const grp = root.createDiv({ cls: "bqb-favgrp" });
    const grpHead = grp.createDiv({ cls: "bqb-favgrp-head" });
    grpHead.setText(title + " · " + rows.length);
    if (delName !== null) {
      const del = grpHead.createEl("a", { cls: "bqb-favgrp-del clickable-icon", attr: { "aria-label": t("删除分类") } });
      setIcon(del, "x");
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.plugin.settings.favCats = (this.plugin.settings.favCats || []).filter((c) => c !== delName);
        // 删分类同时从各条目的分类归属里清掉(不取消收藏)
        const assign = this.plugin.settings.catAssign || {};
        for (const k of Object.keys(assign)) {
          assign[k] = (assign[k] || []).filter((x) => x !== delName);
          if (!assign[k].length) delete assign[k];
        }
        this.plugin.settings.catAssign = assign;
        this.plugin.saveSettings();
        this.render();
      });
    }
    const body = grp.createDiv({ cls: "bqb-favgrp-body" });
    grpHead.addEventListener("click", () => this.foldGrp(grp, body));
    for (const r of rows) this.favRow(body, r, lookupId(r));
  }

  // 跳转源笔记:在主区 markdown 叶子里打开(弹窗先关,主区切到目标);文件查找走 app.vault(workspace.vault 不可靠)。
  jump(path) {
    const app = this.plugin.app;
    if (studyPanel) studyPanel.close(); // 切走后弹窗收起,主区干净露出目标
    const f = app.vault.getAbstractFileByPath(path);
    if (!f) {
      new Notice(t("找不到 {p}", { p: path }));
      return;
    }
    const ws = app.workspace;
    const md = ws.getLeavesOfType("markdown");
    const leaf = md.length ? md[md.length - 1] : ws.getLeaf(true);
    Promise.resolve(leaf.openFile(f))
      .then(() => ws.revealLeaf(leaf))
      .catch((e) => {
        console.error("[bqb] jump:", e);
        new Notice(t("打开失败 {p}", { p: path }));
      });
  }
}

function registerQuizProcessor(plugin) {
  async function runRender(source, el, ctx) {
    const data = parseQuiz(source);
    const rawAttrs = { ...data.attrs }; // 填充前快照(未显式写的属性为 null)

    // 应用设置缺省:块属性显式优先;未设置的按设置填充。就地写回供后续统一读。
    if (data.attrs.mode == null) data.attrs.mode = plugin.settings.defaultMode || "immediate";
    if (data.attrs.shuffle == null) data.attrs.shuffle = plugin.settings.defaultShuffle !== false;
    if (data.attrs.number == null) data.attrs.number = plugin.settings.defaultNumbering || "none";
    if (data.attrs.submit == null) data.attrs.submit = plugin.settings.submitEnabled !== false;
    if (data.attrs.reset == null) data.attrs.reset = plugin.settings.resetMode || "auto";

    // —— 绑定渲染(bind/copy):查索引命中则渲染目标题,未命中按普通题 ——
    let bound = null;
    if (rawAttrs.binding) {
      bound = resolveBinding(rawAttrs, {
        defaults: {
          mode: plugin.settings.defaultMode || "immediate",
          shuffle: plugin.settings.defaultShuffle !== false,
          number: plugin.settings.defaultNumbering || "none",
        },
        defaultBindStem: plugin.settings.defaultBindStem === true,
      });
      plugin.debugLog("render bind/copy:", rawAttrs.binding.target, bound ? "hit" : "MISS(按普通题渲染)");
      // MISS 且索引还空(启动竞态)→ 补建索引,建完补渲会把本块救回
      if (!bound) plugin.ensureIndexForMiss();
      // live 绑定注册:命中与否都登记——miss(如启动时索引未就绪)在索引建好后由补渲救回;
      // 同一 el 同一目标只挂一次(防重渲堆积句柄)。
      const targetBase = baseOf(rawAttrs.binding.target);
      if (el.__quizBoundTarget !== targetBase) {
        el.__quizBoundTarget = targetBase;
        registerLiveBinding(targetBase, {
          alive: () => el.isConnected,
          rerender: () => runRender(source, el, ctx),
        });
      }
      if (bound && rawAttrs.binding.type === "bind") bound.attrs.mode = "static";
    }

    const display = bound || data;
    const file = ctx.sourcePath;
    // 卡片瞬态 key:有稳定 id 的块用 "文件+id"(计数器 id 永不变 → 编辑题干/选项不换 key,
    // 顺序与作答自然延续);无 id 的块(绑定显示/手写无 id)回落内容 key。
    // 选项真的变了由 optSig 守卫判定(见 resolveCard),与新开一样重摇。
    const hasId = display.attrs.id ? true : false;
    const cardKey = hasId
      ? file + "\u0000" + baseOf(display.attrs.id)
      : file + "\u0000" + display.question + "\u0001" +
        display.options.map((o) => o.state + "\u0001" + o.text).join("\u0002") +
        (display.details !== undefined ? "\u0001" + display.details : "");
    // 选项集签名(忽略顺序):选项增删/改文本/改正确态 → 守卫判定为重开(重摇)
    const optSig = optSigOf(display.options);
    const container = stableContainer(el);
    const isDynamic = display.attrs.mode !== "static";
    const isMulti =
      display.attrs.mode === "non-immediate" &&
      display.options.filter((o) => o.state === "c").length > 1;
    const block = buildBlock(el, display);
    // 提交/重置配置落显示对象:bind/copy 克隆不带这些属性,用宿主块已填缺省的 data.attrs 补齐
    // (display === data 时为空操作)。display.submit/reset 为规范化值,setupActions 直接读。
    if (display.attrs.submit == null) display.attrs.submit = data.attrs.submit;
    if (display.attrs.reset == null) display.attrs.reset = data.attrs.reset;
    display.submit = display.attrs.submit !== false;
    display.reset = display.attrs.reset === "manual" ? "manual" : "auto";
    display.showReset = plugin.settings.showReset !== false;
    // 批改文案模板(设置可调):{ans}=正确答案字母 {pick}=你的选择字母
const vt = verdictTexts(plugin.settings);
    display.verdictOk = vt.ok;
    display.verdictBad = vt.bad;
    // sticky = 手动重置模式:跨容器保留作答/批改态(切页回来停留在答案状态,直到按重置)
    const sticky = display.reset === "manual";

    // —— 决定顺序 ——
    let order;
    let states = null;
    if (bound) {
      // 绑定/复制:跟随原题洗牌后的实际显示顺序(currentOrder);未渲染过回落其源顺序
      order = display.order || sourceOrder(display.options);
      if (isDynamic) {
        // copy 可作答:接卡片瞬态,重渲后恢复作答/批改态
        const res = resolveCard(cardKey, container, optSig, sticky);
        if (res.redraw && res.entry) {
          states = res.entry.states || null;
          display.submitted = !!res.entry.submitted;
        }
        else saveCard(cardKey, container, order, null, optSig, false);
      }
    } else if (isDynamic) {
      const res = resolveCard(cardKey, container, optSig, sticky);
      if (res.redraw && res.entry) {
        order = res.entry.order || sourceOrder(display.options);
        states = res.entry.states || null;
        display.submitted = !!res.entry.submitted;
      } else {
        // 新开(新容器/换卡/重开文件/选项真变了)重新随机
        order = display.attrs.shuffle !== false ? randomOrder(display.options) : sourceOrder(display.options);
        saveCard(cardKey, container, order, null, optSig, false);
      }
      // 刷新索引里该题的当前显示顺序;仅当顺序真变了才广播(否则每个绑定重渲触发无限重渲风暴)
      if (display.attrs.id && order && setOrderOf(display.attrs.id, order)) {
        plugin.debugLog("order changed:", display.attrs.id, JSON.stringify(order));
        notifyLiveBindings(new Set([baseOf(display.attrs.id)]));
      }
    } else {
      order = sourceOrder(display.options);
    }

    // 批改流上下文(提交/重置按钮与批改态保存共用;此刻 order 已定稿,值捕获即可)
    const ctrl = { key: cardKey, container, order, optSig, rerender: () => runRender(source, el, ctx) };

    // 渲染题干、选项、解析(Markdown / LaTeX)
    const tasks = [];
    const questionEl = block.querySelector(".quiz-question");
    if (questionEl) {
      tasks.push(MarkdownRenderer.render(plugin.app, display.question, questionEl, ctx.sourcePath, plugin));
    }
    block.querySelectorAll(".quiz-option__body").forEach((bodyEl) => {
      const oi = parseInt(bodyEl.parentElement.dataset.optIdx, 10);
      const o = display.options.find((x) => x.optIdx === oi);
      if (o) {
        tasks.push(MarkdownRenderer.render(plugin.app, o.text, bodyEl, ctx.sourcePath, plugin));
      }
    });
    if (display.details !== undefined) {
      const detailsEl = block.querySelector(".quiz-details");
      if (detailsEl) {
        tasks.push(MarkdownRenderer.render(plugin.app, display.details, detailsEl, ctx.sourcePath, plugin));
      }
    }
    await Promise.all(tasks);

    // 恢复作答(仅动态块翻面重渲染)
    if (states) {
      for (const o of display.options) {
        if (states.has(o.optIdx)) o.state = states.get(o.optIdx);
      }
    }
    // 顺序应用
    if (isDynamic && order) reorderRowsTo(block, order);
    else if (bound && order) reorderRowsTo(block, order);
    applyVisuals(block, display, display.attrs.number, ctrl);
    noteRendered(cardKey, container);
    // 收藏 key:按题目 id 登记(不带文件前缀)→ 源题与 bind/copy 镜像(渲染目标题,
    // 其 attrs.id 被置 null)统一记账到同一 id 上:任一处收藏/取消收藏全部联动。
    // 无 id 且无绑定的块回落内容 cardKey(无法靠 id 归属,维持原行为)。
    const favKey = display.attrs.id
      ? baseOf(display.attrs.id)
      : (rawAttrs.binding ? baseOf(rawAttrs.binding.target) : cardKey);
    // 收藏按钮(编辑=排进 "</>" 图标行;阅读=块内右上角悬浮;key 稳定 → 收藏跨渲染保留)
    setupFavoriteButton(block, plugin, favKey);

    // 动态块绑定点击(copy 命中时同样可作答,瞬态只在本容器)
    if (isDynamic) {
      block.querySelectorAll(".quiz-option").forEach((optEl) => {
        optEl.addEventListener("click", () => {
          const oi = parseInt(optEl.dataset.optIdx, 10);
          const opt = display.options.find((x) => x.optIdx === oi);
          if (!opt) return;
          dynamicClick(block, display, opt, ctrl, isMulti);
        });
      });
    }
  }

  plugin.registerMarkdownCodeBlockProcessor("quiz", (source, el, ctx) => {
    runRender(source, el, ctx).catch((e) => console.error("[better-quizbox] render:", e));
  });
}

/* --------------------------------- 插件主体 --------------------------------- */

export default class QuizBlockPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // 兼容旧数据:补齐嵌套按钮配置;悬停从字符串(bright/dark)迁到数值(-1..1)
    this.settings.btnSubmit = Object.assign({}, DEFAULT_SETTINGS.btnSubmit, this.settings.btnSubmit);
    this.settings.btnReset = Object.assign({}, DEFAULT_SETTINGS.btnReset, this.settings.btnReset);
    for (const k of ["btnSubmit", "btnReset"]) {
      const c = this.settings[k];
      if (typeof c.hover !== "number") c.hover = c.hover === "dark" ? -0.12 : 0.12;
      if (c.hover === "string") c.hover = 0; // 双保险
    }
    // 兼容旧数据:补齐收藏按钮微调配置
    this.settings.favBtn = Object.assign({}, DEFAULT_SETTINGS.favBtn, this.settings.favBtn);
    // 兼容旧数据:收藏以前是字符串数组(卡片 key 或裸 id),现升级为 id → 结构体对象。
    // 迁移:新对象格式保留(仅补缺省字段);旧数组逐条取 id(剥文件前缀,内容串丢弃)→ 对象。
    const now = Date.now();
    const normId = (k) => {
      const s = String(k);
      const id = s.includes(KEY_FILE_SEP) ? s.split(KEY_FILE_SEP).pop() : s;
      return id && !id.includes(KEY_PART_SEP) ? id : null;
    };
    const favObj = {};
    const cur = this.settings.favorites || {};
    if (Array.isArray(cur)) {
      for (const k of cur) {
        const id = normId(k);
        if (id && !favObj[id]) favObj[id] = { addedAt: now, reviews: [] };
      }
    } else {
      for (const [id, rec] of Object.entries(cur)) {
        if (!id) continue;
        favObj[id] = Object.assign({ addedAt: now, reviews: [] }, rec && typeof rec === "object" ? rec : {});
      }
    }
    this.settings.favorites = favObj;
    // 分类改为独立存储(全库题目都可归类):旧收藏结构体里的 cats 迁到 catAssign 并从结构体移除
    const assign = (this.settings.catAssign && typeof this.settings.catAssign === "object" && !Array.isArray(this.settings.catAssign))
      ? this.settings.catAssign : {};
    for (const [id, rec] of Object.entries(this.settings.favorites)) {
      if (Array.isArray(rec.cats) && rec.cats.length && !assign[id]) {
        assign[id] = rec.cats.filter((c) => typeof c === "string" && c);
      }
      delete rec.cats;
    }
    this.settings.catAssign = assign;
    // 补齐自建分类清单(默认空,用户在「分类」页新建)
    this.settings.favCats = Array.isArray(this.settings.favCats) ? this.settings.favCats : [];
    // 题型规则兜底:仅保留 {name, code} 形态(损坏条目或旧实验格式直接丢弃)
    this.settings.qtypes = (Array.isArray(this.settings.qtypes) ? this.settings.qtypes : [])
      .filter((r) => r && r.name && typeof r.code === "string");
    // 复习排期表与每日热力表(stored 持久化;键为题目 id / YYYY-MM-DD)。旧数据没有 → 空对象
    if (!this.settings.study || typeof this.settings.study !== "object" || Array.isArray(this.settings.study)) this.settings.study = {};
    if (!this.settings.activity || typeof this.settings.activity !== "object" || Array.isArray(this.settings.activity)) this.settings.activity = {};
    this.applyButtonVars();
    this.addSettingTab(new QuizBoxSettingTab(this.app, this));
    // 设置页改完可回调:刷新学习面板(题库题型分组等即时生效)
    this.refreshPanel = () => refreshFavViews();
    setLogHook((...a) => this.debugLog(...a));
    // 处理器先注册(块立即可渲;绑定 miss 的也登记,live 补渲兜底)
    registerQuizProcessor(this);
    this.setupVaultListeners();
    // 收藏夹/复习独立窗口:像 SR 闪卡复习那样用 modal 弹窗(非标签页、非侧栏)。点星图标打开/聚焦。
    this.addRibbonIcon("star", "Better Quiz Box", () => openPanel(this));
    // 索引必须等 vault 就绪(onload 时 getMarkdownFiles() 还是 0,过早建索引=空索引)
    this.app.workspace.onLayoutReady(async () => {
      // ensureIndexForMiss 已建过(启动竞态保险先跑)就不重复全库重建
      if (this._indexReady) {
        this.debugLog("layout ready: index already built, skip");
        return;
      }
      await this.rebuildIndex();
      notifyLiveBindings(); // 索引建完统一补渲,救回窗口期 MISS 的绑定块
      this._indexReady = true;
      this.debugLog("index ready:", JSON.stringify(stats()));
    });
  }

  // 保险:绑定 MISS 且索引还是空的(启动竞态)时,补建一次索引并补渲
  async ensureIndexForMiss() {
    if (this._indexReady || this._indexPending) return;
    this._indexPending = true;
    this.debugLog("bind MISS with empty index → rebuilding");
    try {
      await this.rebuildIndex();
      notifyLiveBindings();
      this._indexReady = true;
      this.debugLog("index ready (late):", JSON.stringify(stats()));
    } finally {
      this._indexPending = false;
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  /* —— 按钮外观:设置 → CSS 变量(body 上,渲染层直接消费) —— */
  applyButtonVars() {
    if (typeof document === "undefined") return; // 非 Electron 环境(测试沙箱)静默跳过
    // 常规设计习惯:接近纯白(#fafafa)/接近纯黑(#1a1a1a),不用 #fff/#000 那么彻底
    const WHITE = "#fafafa";
    const BLACK = "#1a1a1a";
    const fgColor = (cfg, dark) => {
      if (cfg.fg === "white") return WHITE;
      if (cfg.fg === "black") return BLACK;
      // 自动 = 深色主题近白/浅色主题近黑(按用户主题,不读按钮深浅);反自动 = 相反
      const anti = cfg.fg === "anti";
      return (dark !== anti) ? WHITE : BLACK;
    };
    const hoverFactor = (v) => 1 + (typeof v === "number" ? v : 0); // -1..1 → 0..2,0=不变
    const s = this.settings.btnSubmit || {};
    const r = this.settings.btnReset || {};
    const dark = document.body.classList.contains("theme-dark");
    const set = (k, v) => document.body.style.setProperty(k, v);
    set("--bqb-submit-mix", String(s.mix != null ? s.mix : 30));
    set("--bqb-submit-bright", String(hoverFactor(s.hover)));
    set("--bqb-submit-color", fgColor(s, dark));
    set("--bqb-submit-weight", s.bold ? "600" : "400");
    set("--bqb-reset-mix", String(r.mix != null ? r.mix : 10));
    set("--bqb-reset-bright", String(hoverFactor(r.hover)));
    set("--bqb-reset-color", fgColor(r, dark));
    set("--bqb-reset-weight", r.bold ? "600" : "400");
    // 收藏按钮:尺寸与阅读视图偏移走 CSS 变量;编辑横向微调由 JS(placeFavoriteOnEmbed)读 settings
    const fb = this.settings.favBtn || {};
    set("--bqb-fav-size", (fb.size != null ? fb.size : 24) + "px");
    set("--bqb-fav-read-dx", (fb.readDX || 0) + "px");
    set("--bqb-fav-read-dy", (fb.readDY || 0) + "px");
  }

  // 调试日志(设置栏开关,默认关):排查问题时在控制台看 [bqb] 行
  debugLog(...args) {
    if (this.settings?.debug) console.log("[bqb]", ...args);
  }

  /* —— 全库 id 索引:bind/copy 的 O(1) 查表来源 —— */
  async rebuildIndex() {
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.extension === "md");
    const reads = [];
    for (const f of files) {
      reads.push(this.app.vault.read(f).then((t) => ({ f, t, ok: true })).catch(() => ({ f, t: null, ok: false })));
    }
    const rows = (await Promise.all(reads)).filter(Boolean);
    const failed = rows.filter((r) => !r.ok).length;
    const empty = rows.filter((r) => r.ok && !r.t).length;
    this.debugLog("rebuildIndex: files=", files.length, " readFailed=", failed, " readEmpty=", empty);
    const readFn = (f) => {
      const r = rows.find((x) => x.f === f);
      return r ? r.t : null;
    };
    buildIndex(files, readFn);
    // 索引建完刷新已打开的收藏夹:收藏夹叶子可能在索引就绪前就被恢复渲染,
    // 当时不查询不到源题(启动竞态),这里补一拍让它显示出真实条目
    refreshFavViews();
  }

  /* —— 单文件变更管线 —— */
  // 唯一入口:modify 事件(debounce 节流)。
  // id 是计数器编号,内容编辑不改任何 id → 本管线对"编辑已有题"零写盘(正面不额外闪),
  // 只在"出现没有 id 的新块"时才写盘一次赋号。索引始终随文本更新 → 绑定块内容跟随。
  async handleFileChange(file) {
    if (this._renumbering) return; // 重编号全程屏蔽自身触发的 modify(防 28 文件连锁风暴)
    if (!(file instanceof TFile) || file.extension !== "md") return;
    if (this._processing?.has(file.path)) return;
    if (!this._processing) this._processing = new Set();
    this._processing.add(file.path);
    try {
      const text = await this.app.vault.read(file);
      if (!text.includes("```quiz")) return;

      const codeLen = this.settings.idLength || 7;
      const fileId = fileIdOf(file.path, hashLenOf(codeLen));
      let finalText = text;
      if (this.settings.idMode === "auto") {
        const res = assignCounterIds(text, fileId, usedBlockNums(fileId), allIds(), codeLen);
        if (res.changed) {
          finalText = res.text;
          this.debugLog("assign ids:", file.path, "added", res.added);
          await this.app.vault.process(file, () => res.text); // 仅新建块赋号写盘,编辑已有题不触发
        }
      }

      // 索引随最终文本更新;id 不变,选项未变沿袭顺序 → 绑定块引用的仍是同一题,内容/顺序正确
      const changedIds = replaceFileEntries(file.path, finalText);
      if (changedIds.size) notifyLiveBindings(changedIds);
    } catch (e) {
      console.error("[better-quizbox] fileChange:", e);
    } finally {
      this._processing?.delete(file.path);
    }
  }

    /* —— vault 监听(常驻,唯一入口) —— */
  setupVaultListeners() {
    if (this._vaultRefs) return;
    const onModify = debounce((file) => this.handleFileChange(file), 600, true);
    const onDelete = (file) => {
      if (!(file instanceof TFile)) return;
      const gone = removeFileEntries(file.path);
      if (gone.size) notifyLiveBindings(gone);
    };
    const onRename = async (file, oldPath) => {
      removeFileEntries(oldPath);
      if (file instanceof TFile && file.extension === "md") await this.handleFileChange(file);
    };
    this._vaultRefs = [
      this.app.vault.on("modify", onModify),
      this.app.vault.on("delete", onDelete),
      this.app.vault.on("rename", onRename),
    ];
  }

  /* —— 设置栏按钮:全库重新编号(计数器连续重编;破坏性,仅按钮用) —— */
  async renumberAllIds() {
    if (this._renumbering) return; // 防双击/并发重入
    this._renumbering = true;
    try {
      await this._renumberAllIdsInner();
    } finally {
      this._renumbering = false;
    }
  }

  async _renumberAllIdsInner() {
    // 屏蔽目录:每行一个 vault 内相对路径(目录或单文件均可);匹配的文件跳过重编
    const excl = String(this.settings.renumberExclude || "")
      .split("\n")
      .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
      .filter(Boolean);
    const isExcluded = (p) => excl.some((x) => p === x || p.startsWith(x + "/"));
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.extension === "md" && !isExcluded(f.path));
    new Notice(t("扫描 {n} 个笔记…", { n: files.length }));
    let touchedFiles = 0;
    let touchedBlocks = 0;
    const globalMap = new Map();
    // 第一遍:各文件重排 id(从 0 连续),收集旧→新映射。
    // used = 全库当前 id 快照,跨文件共享并累积 → 前缀相同时自动错号,杜绝跨文件重复 id。
    const codeLen = this.settings.idLength || 7;
    const used = allIds();
    for (const f of files) {
      try {
        const text = await this.app.vault.read(f);
        if (!text.includes("```quiz")) continue;
        const fileId = fileIdOf(f.path, hashLenOf(codeLen));
        const res = renumberFile(text, fileId, codeLen, used);
        if (!res.changed) continue;
        const fileMap = collectIdMap(text, res.text);
        for (const [o, n] of fileMap) {
          if (!globalMap.has(o)) globalMap.set(o, n);
        }
        await this.app.vault.process(f, () => res.text);
        touchedFiles++;
        touchedBlocks += res.count;
        if (touchedFiles % 5 === 0) await new Promise((r) => setTimeout(r, 0)); // 让出主线程,UI 不僵
      } catch (e) {
        console.error("[better-quizbox] renumber " + f.path + ":", e);
      }
    }
    // 第二遍:改写引用了旧 id 的 bind/copy 块(跨文件查反查表)
    const filesToFix = new Set();
    for (const oldId of globalMap.keys()) {
      for (const p of getRefFiles(oldId)) filesToFix.add(p);
    }
    for (const p of filesToFix) {
      try {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (!(f instanceof TFile)) continue;
        const t = await this.app.vault.read(f);
        const res = rewriteRefsInText(t, globalMap);
        if (res.changed) await this.app.vault.modify(f, res.text);
      } catch (e) {
        console.error("[better-quizbox] renumber refs " + p + ":", e);
      }
    }
    await this.rebuildIndex();
    new Notice(t("已重新编号 {a} 题,分布于 {b} 个文件。", { a: touchedBlocks, b: touchedFiles }));
  }

  onunload() {
    if (this._vaultRefs) {
      for (const ref of this._vaultRefs) this.app.vault.offref(ref);
      this._vaultRefs = null;
    }
    if (studyPanel) { try { studyPanel.close(); } catch (e) {} studyPanel = null; }
    resetTransientState();
    clearIndex();
  }
}