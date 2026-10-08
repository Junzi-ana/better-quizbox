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
import { applyAutoIds, rewriteRefsInText, collectIdMap } from "./idassign.mjs";
import {
  baseOf,
  lookupId,
  setOrderOf,
  getRefFiles,
  replaceFileEntries,
  buildIndex,
  removeFileEntries,
  clearIndex,
  aliasId,
  registerLiveBinding,
  notifyLiveBindings,
  resolveBinding,
  setLogHook,
  stats
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
    // 卡片瞬态的 key 用"剥掉属性行的内容"计算:写/改 id 注释行不算内容变化,
    // 同卡翻面照常复用顺序与作答(写 id 不引发洗牌);真换卡/重开(容器变)仍重新洗牌。
    const contentKey =
      file + "\u0000" + display.question + "\u0001" +
      display.options.map((o) => o.state + "\u0001" + o.text).join("\u0002") +
      (display.details !== undefined ? "\u0001" + display.details : "");
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
        const res = resolveCard(contentKey, container);
        if (res.redraw && res.entry) states = res.entry.states || null;
        else saveCard(contentKey, container, order, null);
      }
    } else if (isDynamic) {
      const res = resolveCard(contentKey, container);
      if (res.redraw && res.entry) {
        order = res.entry.order || sourceOrder(display.options);
        states = res.entry.states || null;
      } else {
        // 新开(新容器/换卡/重开文件)重新随机
        order = display.attrs.shuffle !== false ? randomOrder(display.options) : sourceOrder(display.options);
        saveCard(contentKey, container, order, null);
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
    noteRendered(contentKey, container);

    // 动态块绑定点击(copy 命中时同样可作答,瞬态只在本容器)
    if (isDynamic) {
      block.querySelectorAll(".quiz-option").forEach((optEl) => {
        optEl.addEventListener("click", () => {
          const oi = parseInt(optEl.dataset.optIdx, 10);
          const opt = display.options.find((x) => x.optIdx === oi);
          if (!opt) return;
          dynamicClick(block, display, opt, contentKey, container, order, isMulti);
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
  // 唯一入口:modify 事件(debounce 节流)。原则:每个文件每轮最多写盘一次——
  //   1) 自动模式重算 id(纯文本,不写盘) → old→new 映射
  //   2) 引用改写(纯文本,含本文件的 bind/copy 一并算入) → 本文件"最终文本"
  //   3) 本文件一次写盘;别处被改写的文件也各写一次
  //   4) 置换索引 → 精准通知绑定块重渲
  async handleFileChange(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    // 防递归(保险):自己写盘触发的 modify 事件不再进管线(管线内已自足)
    if (this._processing?.has(file.path)) {
      this.debugLog("skip in-flight:", file.path);
      return;
    }
    if (!this._processing) this._processing = new Set();
    this._processing.add(file.path);
    try {
      const text = await this.app.vault.read(file);
      if (!text.includes("```quiz")) return;

      let finalText = text;
      let idMap = new Map();
      // 自动模式:重算 id。只在真的有变化时才算改写——无变化时不写盘,
      // 否则写盘触发 modify 再进管线,自我喂养成写盘风暴(V10 的教训)。
      if (this.settings.idMode === "auto") {
        const res = applyAutoIds(text, this.settings.idLength);
        if (res.changed) {
          idMap = collectIdMap(text, res.text);
          finalText = res.text;
          this.debugLog("id rewrite:", file.path, JSON.stringify([...idMap]));
        }
      }

      // 引用改写(纯文本计算,含本文件;必须先于写盘/通知,否则绑定块拿旧 id 查不到 → 空块)
      let others = new Map(); // 别处文件路径 → 新文本
      if (idMap.size) {
        const rewrites = await this.buildRefRewrites(idMap);
        for (const [p, newText] of rewrites.perFile) {
          if (p !== file.path) others.set(p, newText);
          else finalText = newText; // 本文件的绑定引用并入同一次写盘
        }
      }

      // 编辑器占用本文件时不写盘(写盘会和输入缓冲打架 → id 翻转/闪烁):
      // 只更新内存索引为新文本 + 留旧→新别名(绑定块在内存中完全一致,旧引用继续可解析)。
      // 用户切走/关闭文件时 Obsidian 落盘触发 modify,那时再真实写盘。
      if (finalText !== text && this.app.workspace.activeEditor?.file?.path === file.path) {
        this.debugLog("defer write (editor active):", file.path, JSON.stringify([...idMap]));
        for (const [o, n] of idMap) aliasId(o, n);
        const changedBases = replaceFileEntries(file.path, finalText);
        if (changedBases.size) notifyLiveBindings(changedBases);
        return;
      }

      // 本文件一次写盘(finalText = id 重算 + 本文件引用改写的合并结果)
      if (finalText !== text) await this.app.vault.process(file, () => finalText);

      // 别处被改写的文件各写一次(改写结果已在纯文本阶段算好)
      for (const [p, newText] of others) {
        const f2 = this.app.vault.getAbstractFileByPath(p);
        if (!(f2 instanceof TFile)) continue;
        if (this._processing.has(p)) continue;
        this._processing.add(p);
        try {
          await this.app.vault.modify(f2, newText);
          const bases = replaceFileEntries(p, newText);
          if (bases.size) notifyLiveBindings(bases);
        } finally {
          this._processing.delete(p);
        }
      }

      // 置换本文件索引(此刻文本已含全部新 id/新引用) → 精准通知绑定块
      const changedBases = replaceFileEntries(file.path, finalText);
      if (changedBases && changedBases.size) notifyLiveBindings(changedBases);
    } catch (e) {
      console.error("[better-quizbox] fileChange:", e);
    } finally {
      this._processing?.delete(file.path);
    }
  }

  // 引用改写(纯文本计算,不写盘):对反查表列出的每个文件读出文本、算出新文本。
  // 返回 { perFile: Map(文件路径 → 改写后文本) };写盘由调用方决定(同文件合并,防多重刷新)。
  async buildRefRewrites(map) {
    const perFile = new Map();
    if (!map || !map.size) return { perFile };
    const filesToFix = new Set();
    for (const oldBase of map.keys()) {
      for (const p of getRefFiles(oldBase)) filesToFix.add(p);
    }
    this.debugLog("refRewrite:", JSON.stringify([...map]), "→ files:", [...filesToFix]);
    for (const p of filesToFix) {
      const f = this.app.vault.getAbstractFileByPath(p);
      if (!(f instanceof TFile)) continue;
      try {
        const t = await this.app.vault.read(f);
        const res = rewriteRefsInText(t, map);
        if (res.changed) perFile.set(p, res.text);
      } catch (e) {
        console.error("[better-quizbox] refRewrite " + p + ":", e);
      }
    }
    return { perFile };
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

  /* —— 设置栏按钮:全库重编号(内容派生,保证文件内唯一;只动 quiz 块) —— */
  async renumberAllIds() {
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.extension === "md");
    new Notice("Better Quiz Box: 扫描 " + files.length + " 个笔记…");
    let touchedFiles = 0;
    let touchedBlocks = 0;
    const globalMap = new Map();
    for (const f of files) {
      try {
        const text = await this.app.vault.read(f);
        if (!text.includes("```quiz")) continue;
        const res = applyAutoIds(text, this.settings.idLength);
        if (!res.changed) continue;
        // 收集旧→新映射(索引仍持旧值),供随后改写所有引用
        const fileMap = collectIdMap(text, res.text);
        for (const [o, n] of fileMap) {
          if (!globalMap.has(o)) globalMap.set(o, n);
        }
        await this.app.vault.process(f, () => res.text);
        touchedFiles++;
        touchedBlocks += res.blockChanges;
      } catch (e) {
        console.error("[better-quizbox] renumber " + f.path + ":", e);
      }
    }
    // 引用了旧 id 的 bind/copy 块同步改写(纯文本计算,统一写盘),随后整体重建索引
    const rewrites = await this.buildRefRewrites(globalMap);
    for (const [p, newText] of rewrites.perFile) {
      const f = this.app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) await this.app.vault.modify(f, newText);
    }
    await this.rebuildIndex();
    new Notice("Better Quiz Box: 已重编号 " + touchedBlocks + " 块,分布于 " + touchedFiles + " 个文件。");
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