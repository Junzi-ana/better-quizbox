/* Better Quiz Box
 * 交互式多项选择题块插件(纯瞬态作答;Markdown/LaTeX 题干、选项与解析;
 * static / immediate / non-immediate 三种模式;SR 复习友好,支持顺序绑定与翻面复原)
 *
 * 源码风格与包结构:
 *   src/parse.mjs    解析层(块属性注释 + quiz 源文本解析 + 顺序/配对辅助)
 *   src/state.mjs    状态层(顺序注册表 + 卡片级瞬态作答存储,内存不落盘)
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
 *     <!-- id: 名字 -->        动态块标识(缺省按"选项+正确项"自动配对)
 *     <!-- bind: 名字 -->      静态块绑定某动态块的打乱顺序
 *
 * 顺序与作答复原:动态块缺省自动打乱,每次"新开"(新容器/换卡/重开文件)重新随机;
 * 同卡翻面重渲染保持原顺序与作答。静态块绑定后与对应动态块同步顺序。
 */

import {
  parseQuiz,
  sourceOrder,
  randomOrder,
  dynamicKey,
  staticBindKey
} from "./parse.mjs";
import {
  registryFor,
  publishOrder,
  subscribeStatic,
  reorderRowsTo,
  resolveCard,
  saveCard,
  noteRendered,
  stableContainer,
  resetTransientState
} from "./state.mjs";
import { buildBlock, applyVisuals, dynamicClick } from "./render.mjs";
import { DEFAULT_SETTINGS, QuizBoxSettingTab } from "./settings.mjs";
import { Plugin, MarkdownRenderer } from "obsidian";

/* -------------------------------- 处理器注册 -------------------------------- */

function registerQuizProcessor(plugin) {
  plugin.registerMarkdownCodeBlockProcessor("quiz", async (source, el, ctx) => {
    const data = parseQuiz(source);
    // 应用设置栏缺省:块内显式属性优先;未设置的属性(null)按插件设置填充。
    // 就地写回 data.attrs,使后续(订阅/视觉/点击)统一读到已解析的值。
    if (data.attrs.mode == null) data.attrs.mode = plugin.settings.defaultMode || "immediate";
    if (data.attrs.shuffle == null) data.attrs.shuffle = plugin.settings.defaultShuffle !== false;
    if (data.attrs.number == null) data.attrs.number = plugin.settings.defaultNumbering || "none";
    const file = ctx.sourcePath;
    const key = file + "\u0000" + source;
    const container = stableContainer(el);
    const isDynamic = data.attrs.mode !== "static";
    // 多选题判定:非即时(non-immediate)且正确项 [c] 不少于 2 个 → 各选项独立开/关
    const isMulti =
      data.attrs.mode === "non-immediate" &&
      data.options.filter((o) => o.state === "c").length > 1;
    const block = buildBlock(el, data);

    // —— 决定顺序 ——
    let order;
    let states = null;
    let bindKey = null;
    if (isDynamic) {
      const res = resolveCard(key, container);
      if (res.redraw && res.entry) {
        order = res.entry.order || sourceOrder(data.options);
        states = res.entry.states || null;
      } else {
        const shuffleOn = data.attrs.shuffle !== false; // 缺省开
        order = shuffleOn ? randomOrder(data.options) : sourceOrder(data.options);
        saveCard(key, container, order, null);
      }
      publishOrder(file, dynamicKey(data.attrs, data.options), order);
    } else {
      bindKey = staticBindKey(data.attrs, data.options);
      const entry = subscribeStatic(
        file,
        bindKey,
        block,
        data,
        data.attrs.number,
        applyVisuals
      );
      order = entry.order ? entry.order : sourceOrder(data.options);
      if (entry.order) {
        // 发布回调里已应用;此处仍需要一次重排+视觉
        reorderRowsTo(block, entry.order);
      }
    }

    // 渲染题干、选项、解析(Markdown / LaTeX)
    const tasks = [];
    const questionEl = block.querySelector(".quiz-question");
    if (questionEl) {
      tasks.push(MarkdownRenderer.render(plugin.app, data.question, questionEl, ctx.sourcePath, plugin));
    }
    block.querySelectorAll(".quiz-option__body").forEach((bodyEl) => {
      const oi = parseInt(bodyEl.parentElement.dataset.optIdx, 10);
      const o = data.options.find((x) => x.optIdx === oi);
      if (o) {
        tasks.push(MarkdownRenderer.render(plugin.app, o.text, bodyEl, ctx.sourcePath, plugin));
      }
    });
    if (data.details !== undefined) {
      const detailsEl = block.querySelector(".quiz-details");
      if (detailsEl) {
        tasks.push(MarkdownRenderer.render(plugin.app, data.details, detailsEl, ctx.sourcePath, plugin));
      }
    }
    await Promise.all(tasks);

    // 恢复作答(仅动态块翻面重渲染)
    if (states) {
      for (const o of data.options) {
        if (states.has(o.optIdx)) o.state = states.get(o.optIdx);
      }
    }
    // 顺序应用
    if (isDynamic && order) reorderRowsTo(block, order);
    applyVisuals(block, data, data.attrs.number);
    // 终态对账:静态块在异步渲染完成后,再以注册表最新顺序重排一次,
    // 即使发布/订阅时序有交错也能收敛到与正面一致
    if (!isDynamic && bindKey) {
      const regEntry = registryFor(file).get(bindKey);
      if (regEntry && regEntry.order) {
        reorderRowsTo(block, regEntry.order);
        applyVisuals(block, data, data.attrs.number);
      }
    }
    noteRendered(key, container);

    // 动态块绑定点击
    if (isDynamic) {
      block.querySelectorAll(".quiz-option").forEach((optEl) => {
        optEl.addEventListener("click", () => {
          const oi = parseInt(optEl.dataset.optIdx, 10);
          const opt = data.options.find((x) => x.optIdx === oi);
          if (!opt) return;
          dynamicClick(block, data, opt, key, container, order, isMulti);
        });
      });
    }
  });
}

/* --------------------------------- 插件主体 --------------------------------- */

export default class QuizBlockPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new QuizBoxSettingTab(this.app, this));
    registerQuizProcessor(this);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  onunload() {
    resetTransientState();
  }
}