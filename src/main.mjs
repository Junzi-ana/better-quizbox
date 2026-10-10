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
import { buildBlock, applyVisuals, dynamicClick } from "./render.mjs";
import { DEFAULT_SETTINGS, QuizBoxSettingTab } from "./settings.mjs";
import { assignCounterIds, renumberFile, collectIdMap, rewriteRefsInText, fileIdOf, hashLenOf } from "./idassign.mjs";
import {
  baseOf,
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
  allIds
} from "./idindex.mjs";
import { Plugin, MarkdownRenderer, debounce, Notice, TFile } from "obsidian";

/* -------------------------------- 处理器注册 -------------------------------- */

function registerQuizProcessor(plugin) {
  async function runRender(source, el, ctx) {
    const data = parseQuiz(source);
    const rawAttrs = { ...data.attrs }; // 填充前快照(未显式写的属性为 null)

    // 应用设置缺省:块属性显式优先;未设置的按设置填充。就地写回供后续统一读。
    if (data.attrs.mode == null) data.attrs.mode = plugin.settings.defaultMode || "immediate";
    if (data.attrs.shuffle == null) data.attrs.shuffle = plugin.settings.defaultShuffle !== false;
    if (data.attrs.number == null) data.attrs.number = plugin.settings.defaultNumbering || "none";

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
    const optSig = display.options
      .map((o) => o.state + "\u0001" + o.text.trim().toLowerCase().replace(/\s+/g, " "))
      .sort()
      .join("\u0002");
    const container = stableContainer(el);
    const isDynamic = display.attrs.mode !== "static";
    const isMulti =
      display.attrs.mode === "non-immediate" &&
      display.options.filter((o) => o.state === "c").length > 1;
    const block = buildBlock(el, display);

    // —— 决定顺序 ——
    let order;
    let states = null;
    if (bound) {
      // 绑定/复制:跟随原题洗牌后的实际显示顺序(currentOrder);未渲染过回落其源顺序
      order = display.order || sourceOrder(display.options);
      if (isDynamic) {
        // copy 可作答:接卡片瞬态,重渲后恢复作答
        const res = resolveCard(cardKey, container, optSig);
        if (res.redraw && res.entry) states = res.entry.states || null;
        else saveCard(cardKey, container, order, null, optSig);
      }
    } else if (isDynamic) {
      const res = resolveCard(cardKey, container, optSig);
      if (res.redraw && res.entry) {
        order = res.entry.order || sourceOrder(display.options);
        states = res.entry.states || null;
      } else {
        // 新开(新容器/换卡/重开文件/选项真变了)重新随机
        order = display.attrs.shuffle !== false ? randomOrder(display.options) : sourceOrder(display.options);
        saveCard(cardKey, container, order, null, optSig);
      }
      // 刷新索引里该题的当前显示顺序,并广播给跟随它的绑定/复制块(它们重读最新顺序)
      if (display.attrs.id && order) {
        setOrderOf(display.attrs.id, order);
        notifyLiveBindings(new Set([baseOf(display.attrs.id)]));
      }
    } else {
      order = sourceOrder(display.options);
    }

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
    applyVisuals(block, display, display.attrs.number);
    noteRendered(cardKey, container);

    // 动态块绑定点击(copy 命中时同样可作答,瞬态只在本容器)
    if (isDynamic) {
      block.querySelectorAll(".quiz-option").forEach((optEl) => {
        optEl.addEventListener("click", () => {
          const oi = parseInt(optEl.dataset.optIdx, 10);
          const opt = display.options.find((x) => x.optIdx === oi);
          if (!opt) return;
          dynamicClick(block, display, opt, cardKey, container, order, isMulti);
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
    this.addSettingTab(new QuizBoxSettingTab(this.app, this));
    setLogHook((...a) => this.debugLog(...a));
    // 处理器先注册(块立即可渲;绑定 miss 的也登记,live 补渲兜底)
    registerQuizProcessor(this);
    this.setupVaultListeners();
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
  }

  /* —— 单文件变更管线 —— */
  // 唯一入口:modify 事件(debounce 节流)。
  // id 是计数器编号,内容编辑不改任何 id → 本管线对"编辑已有题"零写盘(正面不额外闪),
  // 只在"出现没有 id 的新块"时才写盘一次赋号。索引始终随文本更新 → 绑定块内容跟随。
  async handleFileChange(file) {
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
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.extension === "md");
    new Notice("Better Quiz Box: 扫描 " + files.length + " 个笔记…");
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
    new Notice("Better Quiz Box: 已重新编号 " + touchedBlocks + " 块,分布于 " + touchedFiles + " 个文件。");
  }

  onunload() {
    if (this._vaultRefs) {
      for (const ref of this._vaultRefs) this.app.vault.offref(ref);
      this._vaultRefs = null;
    }
    resetTransientState();
    clearIndex();
  }
}