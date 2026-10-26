/* Better Quiz Box — 设置栏(双语,分组排布,进阶项折叠)
 * 设置只在块属性未显式给出时生效;块属性显式始终优先;设置只影响之后的渲染。
 */

import { PluginSettingTab, Setting } from "obsidian";
import { EditorView, keymap, lineNumbers, drawSelection, highlightSpecialChars } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { indentOnInput, indentUnit, bracketMatching, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { tags as hlTags } from "@lezer/highlight";
import { t } from "./i18n.mjs";
import { normalizeBoolToken } from "./parse.mjs";

// 外观微调控件开关:false = 设置页不显示(按钮外观/收藏按钮/提示边距);
// 相关参数值已固化进 DEFAULT_SETTINGS,改回 true 即可原样重现这些控件。
const SHOW_CSS_TWEAKS = false;

export const DEFAULT_SETTINGS = {	// 出厂预设 = 作者(Junzi-ana)日常使用配置,他人安装即得此套默认(2026-10 固化)
	defaultMode: "non-immediate", // 主打模式:先选后查(单选多选)
	defaultShuffle: true, // 打乱选项
	defaultNumbering: "abc", // 默认选项编号 A B C
	submitEnabled: true, // non-immediate 提交按钮(按下批改并显示正确答案)
	resetMode: "manual", // user 偏好:跨容器保留批改态直到按重置
	showReset: true, // 批改后显示重置按钮
	verdictOk: "回答正确！正确答案：{ans}。", // 判对文案(出厂中文;非中文界面显示时自动切英文,见 main.verdictTexts)
	verdictBad: "回答错误！正确答案：{ans}，你的选择：{pick}。", // 判错文案({ans}/{pick} 占位)
	hintReveal: "click", // [h] 提示显示时机:click(默认,批改后显示,与历史行为一致) / always(常驻显示)
	hintMarginLeft: 2, // [h] 提示文本左边距(px;控件已隐藏,值为出厂预设)
	hintMarginRight: 0, // [h] 提示文本右边距(px;同上)
	hintMarginTop: 12, // [h] 提示文本与末选项之间的间距(px;同上)
	reviewScale: 80, // 复习页字号(相对笔记正文的百分比;卡片内一切尺寸按 em 等比跟随)
	renumberExclude: "", // 重新编号屏蔽目录(每行一个路径)
	btnSubmit: { mix: 80, hover: 0.08, fg: "white", bold: false }, // 提交按钮外观(混色%/悬停±/字色/字重;控件已隐藏,值为出厂预设)
	btnReset: { mix: 15, hover: -0.04, fg: "black", bold: false }, // 重置按钮外观(同上)
	favorites: {}, // 收藏:题目 id → { addedAt 收藏时间, reviews 复习记录(接口预留) }(bind/copy 镜像与源题共享同一收藏)
	favCats: [], // 自建分类名单(收藏夹「分类」页管理)
	catAssign: {}, // 分类归属:题目 id → [分类名](独立于收藏,未收藏的题也能归类)
	qtypes: [ // 自定义题型:每条 { name, code, shuffle? },code 为函数体源码,收到选项数组 o,返回真值即命中;按序首个命中即定型(都不中→按正确数归单选/多选);shuffle 声明该题型默认是否打乱(true/false,省略=跟随设置默认)
		{
			name: "判断",
			shuffle: false, // 判断题只有对错,固定顺序(对错位置不漂移);块内仍可显式覆盖
			code: `// 两选项、唯一正确、短文本(中文≤2字 或 拉丁≤7字符)
return o.length === 2
  && o.filter(x => x.state === "c").length === 1
  && o.every(x => {
    const s = String(x.text || "").trim();
    const wide = [...s].some(ch => ch.codePointAt(0) > 0x2e7f); // 中文等全角字符
    return [...s].length <= (wide ? 2 : 7);
  });`,
		},
		{
			name: "大多选",
			code: `// 不少于五个选项,且不是单选
return o.length >= 5 && o.filter(x => x.state === "c").length !== 1;`,
		},
	],
	study: {}, // 复习排期:题目 id → { reviews: [{ t 复习时间戳, ok 答对? }] }(全库题都有,独立于收藏)
	activity: {}, // 每日复习数:"YYYY-MM-DD" → n(主页热力图数据源)
	favBtn: { size: 24, editDX: 0, readDX: -3, readDY: -9 }, // 收藏按钮微调:尺寸px/编辑横向/阅读横向/阅读纵向
	idMode: "auto", // manual | auto(user 偏好自动分配)
	idLength: 6, // 3..9(user 偏好 6 位)
	defaultBindStem: true, // bind 是否保留题干(user 偏好保留)
	debug: false, // 调试日志
};

// 题型脚本文本 ⇄ 规则数组:「## 名称」独占一行开一条新题型,其下到下一个「## 」为该题型的函数体。
// name 之前的游离内容忽略;函数体开始之前允许一行「shuffle: true/false」声明该题型默认是否打乱选项。
export function parseTypeScripts(text) {
	const out = [];
	let cur = null;
	for (const line of String(text || "").split("\n")) {
		const m = line.match(/^##\s+(.+?)\s*$/);
		if (m) {
			cur = { name: m[1], code: "" };
			out.push(cur);
			continue;
		}
		if (!cur) continue;
		const sh = cur.code.trim() === "" && line.match(/^\s*shuffle\s*:\s*(\S+)\s*$/i); // 指令行只认函数体开始之前
		if (sh) {
			cur.shuffle = normalizeBoolToken(sh[1]); // 不认识的词按"未声明"处理
			continue;
		}
		cur.code += line + "\n";
	}
	return out.filter((r) => r.name && r.code.trim());
}

export function formatTypeScripts(list) {
	return (list || [])
		.map((r) => `## ${r.name}${r.shuffle == null ? "" : `\nshuffle: ${r.shuffle ? "true" : "false"}`}\n${String(r.code || "").trim()}`)
		.join("\n\n");
}

/* -------- CodeMirror 主题与语法高亮(配色抄 latex-suite 的 obsidian 主题:全部走主题变量) -------- */
const cmConfig = {
	background: "var(--background-primary)",
	foreground: "var(--text-normal)",
	selection: "var(--text-selection)",
	cursor: "var(--text-normal)",
	activeLine: "var(--background-primary)",
	matchingBracket: "var(--background-modifier-accent)",
	keyword: "#d73a49",
	variable: "var(--text-normal)",
	function: "var(--text-accent-hover)",
	string: "var(--text-accent)",
	constant: "var(--text-accent-hover)",
	type: "var(--text-accent-hover)",
	class: "#6f42c1",
	number: "var(--text-accent-hover)",
	comment: "var(--text-faint)",
	invalid: "var(--text-error)",
	regexp: "var(--text-accent)",
};

const cmTheme = EditorView.theme({
	"&": { color: cmConfig.foreground, backgroundColor: cmConfig.background },
	".cm-content": { caretColor: cmConfig.cursor },
	"&.cm-focused .cm-cursor": { borderLeftColor: cmConfig.cursor },
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, & ::selection": { backgroundColor: cmConfig.selection },
	".cm-matchingBracket, .cm-nonmatchingBracket": { backgroundColor: cmConfig.matchingBracket, outline: "none" },
	".cm-gutters": { backgroundColor: cmConfig.background, color: cmConfig.comment, borderRight: "1px solid var(--background-modifier-border)" },
	".cm-lineNumbers, .cm-gutterElement": { color: "inherit" },
}, { dark: false });

const cmHighlight = HighlightStyle.define([
	{ tag: hlTags.keyword, color: cmConfig.keyword },
	{ tag: [hlTags.name, hlTags.deleted, hlTags.character, hlTags.macroName], color: cmConfig.variable },
	{ tag: [hlTags.propertyName], color: cmConfig.function },
	{ tag: [hlTags.processingInstruction, hlTags.string, hlTags.inserted, hlTags.special(hlTags.string)], color: cmConfig.string },
	{ tag: [hlTags.function(hlTags.variableName), hlTags.labelName], color: cmConfig.function },
	{ tag: [hlTags.color, hlTags.constant(hlTags.name), hlTags.standard(hlTags.name)], color: cmConfig.constant },
	{ tag: [hlTags.definition(hlTags.name), hlTags.separator], color: cmConfig.variable },
	{ tag: [hlTags.className], color: cmConfig.class },
	{ tag: [hlTags.number, hlTags.changed, hlTags.annotation, hlTags.modifier, hlTags.self, hlTags.namespace], color: cmConfig.number },
	{ tag: [hlTags.typeName], color: cmConfig.type },
	{ tag: [hlTags.operator, hlTags.operatorKeyword], color: cmConfig.keyword },
	{ tag: [hlTags.url, hlTags.escape, hlTags.regexp, hlTags.link], color: cmConfig.regexp },
	{ tag: [hlTags.meta, hlTags.comment], color: cmConfig.comment },
	{ tag: [hlTags.atom, hlTags.bool, hlTags.special(hlTags.variableName)], color: cmConfig.variable },
	{ tag: hlTags.invalid, color: cmConfig.invalid },
]);

export class QuizBoxSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		if (this.qtView) { this.qtView.destroy(); this.qtView = null; } // 设置页重渲染前清掉旧 CodeMirror 实例
		containerEl.empty();

		// 折叠分组:标题行点击开合;open = 默认展开(进阶类样式默认收起)
		const fold = (title, open = false) => {
			const wrap = containerEl.createDiv({ cls: "bqb-fold" + (open ? " bqb-open" : "") });
			const head = new Setting(wrap).setName(title).setHeading().setClass("bqb-fold-head");
			const body = wrap.createDiv({ cls: "bqb-fold-body" });
			if (!open) body.style.display = "none";
			head.settingEl.addEventListener("click", () => {
				const show = body.style.display === "none";
				body.style.display = show ? "" : "none";
				wrap.toggleClass("bqb-open", show);
			});
			return body;
		};

		/* ------------ 作答 ------------ */
		new Setting(containerEl).setName(t("作答")).setHeading();

		new Setting(containerEl)
			.setName(t("默认作答模式"))
			.setDesc(t("块内未写 mode 时生效"))
			.addDropdown((drop) =>
				drop
					.addOption("immediate", t("即时批改"))
					.addOption("non-immediate", t("提交批改"))
					.addOption("static", t("静态展示"))
					.setValue(this.plugin.settings.defaultMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultMode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("默认打乱选项"))
			.setDesc(t("块内未写 shuffle 时生效"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultShuffle)
					.onChange(async (value) => {
						this.plugin.settings.defaultShuffle = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("默认选项编号"))
			.setDesc(t("块内未写 number 时生效"))
			.addDropdown((drop) =>
				drop
					.addOption("none", t("无"))
					.addOption("abc", "A B C")
					.addOption("123", "1 2 3")
					.setValue(this.plugin.settings.defaultNumbering)
					.onChange(async (value) => {
						this.plugin.settings.defaultNumbering = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("提示常驻显示"))
			.setDesc(t("开=[h] 提示做题时即显示;关(默认)=批改后才显示(static 块始终显示)"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hintReveal === "always")
					.onChange(async (value) => {
						this.plugin.settings.hintReveal = value ? "always" : "click";
						await this.plugin.saveSettings();
					})
			);

		/* ------------ 提交批改 ------------ */
		new Setting(containerEl).setName(t("提交批改")).setHeading();

		new Setting(containerEl)
			.setName(t("提交按钮"))
			.setDesc(t("批改并显示答案"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.submitEnabled)
					.onChange(async (value) => {
						this.plugin.settings.submitEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("重置方式"))
			.setDesc(t("自动:切页自动重置;手动:保留到按重置"))
			.addDropdown((drop) =>
				drop
					.addOption("auto", t("自动重置"))
					.addOption("manual", t("手动重置"))
					.setValue(this.plugin.settings.resetMode)
					.onChange(async (value) => {
						this.plugin.settings.resetMode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("批改后显示重置按钮"))
			.setDesc(t("自动重置下可关;手动重置恒显示"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showReset)
					.onChange(async (value) => {
						this.plugin.settings.showReset = value;
						await this.plugin.saveSettings();
					})
			);

		/* 批改文案(占位符 {ans}/{pick}) */
		new Setting(containerEl)
			.setName(t("判对文案"))
			.setDesc(t("支持占位符 {ans}=正确答案 {pick}=你的选择"))
			.addText((text) =>
				text
					.setValue(this.plugin.settings.verdictOk)
					.onChange(async (value) => {
						this.plugin.settings.verdictOk = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("判错文案"))
			.setDesc(t("同上;空占位符会被剔除"))
			.addText((text) =>
				text
					.setValue(this.plugin.settings.verdictBad)
					.onChange(async (value) => {
						this.plugin.settings.verdictBad = value;
						await this.plugin.saveSettings();
					})
			);

		/* ------------ 题目 ID ------------ */
		new Setting(containerEl).setName(t("题目 ID")).setHeading();

		new Setting(containerEl)
			.setName(t("自动分配"))
			.setDesc(t("自动给没有 id 的题分配 id"))
			.addDropdown((drop) =>
				drop
					.addOption("manual", t("手动"))
					.addOption("auto", t("自动"))
					.setValue(this.plugin.settings.idMode)
					.onChange(async (value) => {
						this.plugin.settings.idMode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("id 码长"))
			.setDesc(t("只影响新分配的 id"))
			.addSlider((slider) =>
				slider
					.setLimits(3, 9, 1)
					.setValue(this.plugin.settings.idLength)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.idLength = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("全库重新编号"))
			.setDesc(t("全部题目重新编号,引用自动同步"))
			.addButton((btn) =>
				btn.setButtonText(t("重新编号")).onClick(() => {
					if (window.confirm(t("将重写全部题目 id,确认?"))) {
						this.plugin.renumberAllIds();
					}
				})
			);

		new Setting(containerEl)
			.setName(t("重新编号屏蔽目录"))
			.setDesc(t("每行一个路径(目录或单文件),重新编号时跳过"))
			.addTextArea((area) =>
				area
					.setValue(this.plugin.settings.renumberExclude)
					.onChange(async (value) => {
						this.plugin.settings.renumberExclude = value;
						await this.plugin.saveSettings();
					})
			);

		/* ------------ 进阶 ------------ */
		/* ------------ 其他 ------------ */
		new Setting(containerEl).setName(t("其他")).setHeading();

		// 复习页字号:卡片内全部尺寸按 em 排版,以正文百分比缩放即整体等比(题目/编号框/按钮/提示)
		new Setting(containerEl)
			.setName(t("复习页字号"))
			.setDesc(t("百分比,相对笔记正文;复习窗口比笔记窄,整块内容按此等比缩放"))
			.addSlider((slider) =>
				slider
					.setLimits(60, 120, 1)
					.setValue(this.plugin.settings.reviewScale)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.reviewScale = value;
						this.plugin.applyCssVars();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("绑定默认保留题干"))
			.setDesc(t("bind 默认保留题干"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultBindStem)
					.onChange(async (value) => {
						this.plugin.settings.defaultBindStem = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("调试日志"))
			.setDesc(t("控制台(过滤 bqb)输出插件事件;排查用"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debug)
					.onChange(async (value) => {
						this.plugin.settings.debug = value;
						await this.plugin.saveSettings();
					})
			);

		/* -------- 题型脚本(折叠) -------- */
		const qtBody = fold(t("题型脚本"));
		const qtSetting = new Setting(qtBody)
			.setName(t("题型脚本文本"))
			.setDesc(t("每段以「## 题型名」单独一行开头;其下可写一行 shuffle: true/false 声明该题型默认是否打乱选项(块内标注 > 此声明 > 设置默认);再下面是返回 true/false 的 JavaScript,收到选项数组 o(x.text 文本、x.state \"c\"=正确、x.optIdx 序号),返回真值即判定为该题型,按顺序第一个命中生效,都不命中则归入单选/多选。此代码在您的笔记库中以本插件身份运行,仅写您自己可运行的规则。"))
			.setClass("bqb-qtypes-editor");

		// CodeMirror 编辑器(latex-suite 同款方案):js 语法高亮/行号/括号匹配/撤销历史
		const cmHost = qtSetting.controlEl.createDiv({ cls: "bqb-qtypes-cmhost" });
		const qtErr = qtSetting.controlEl.createDiv({ cls: "bqb-qtypes-error" }); // 错误行在编辑器下方
		this.qtView = new EditorView({
			parent: cmHost,
			state: EditorState.create({
				doc: formatTypeScripts(this.plugin.settings.qtypes),
				extensions: [
					lineNumbers(),
					highlightSpecialChars(),
					history(),
					javascript(),
					drawSelection(),
					EditorState.allowMultipleSelections.of(true),
					indentOnInput(),
					indentUnit.of("  "),
					cmTheme,
					syntaxHighlighting(cmHighlight, { fallback: true }),
					EditorView.lineWrapping,
					bracketMatching(),
					keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
					EditorView.updateListener.of((v) => {
						if (v.docChanged) this.qtApply(v.state.doc.toString(), qtErr);
					}),
				],
			}),
		});

		/* -------- 外观微调(暂时隐藏) --------
		 * 按钮外观 / 收藏按钮 / 提示边距:值已固化进出厂预设(DEFAULT_SETTINGS)。
		 * 需要再调时把文件顶部的 SHOW_CSS_TWEAKS 改回 true,控件即重现(块内缩进保持原样)。 */
		if (SHOW_CSS_TWEAKS) {
		// 提示文本边距:左右分别调 + 与末选项的间距;立即写 CSS 变量,无需重渲染
		const lookBody = fold(t("提示边距"));
		const hintSlider = (key, min, max, label, desc) => {
			new Setting(lookBody)
				.setName(label)
				.setDesc(desc)
				.addSlider((slider) =>
					slider
						.setLimits(min, max, 1)
						.setValue(this.plugin.settings[key])
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings[key] = value;
							this.plugin.applyCssVars();
							await this.plugin.saveSettings();
						})
				);
		};
		hintSlider("hintMarginLeft", 0, 96, t("提示左边距"), t("px,提示文本左端的位置"));
		hintSlider("hintMarginRight", 0, 96, t("提示右边距"), t("px,提示文本右端的位置"));
		hintSlider("hintMarginTop", 0, 48, t("提示上边距"), t("px,提示文本到末选项框的距离"));

		/* -------- 按钮外观(折叠) -------- */
		const btnBody = fold(t("按钮外观"));

		// 每个按钮 4 项:混色比例 / 悬停(负暗正亮) / 字色(自动|反自动|白|黑) / 字重
		const btnRow = (key, label) => {
			const cfg = this.plugin.settings[key];
			new Setting(btnBody)
				.setName(`${label} · ${t("强调色混合")}`)
				.setDesc(t("强调色掺入背景的比例,%越大越浓"))
				.addSlider((slider) =>
					slider
						.setLimits(0, 100, 1)
						.setValue(cfg.mix != null ? cfg.mix : 30)
						.setDynamicTooltip()
						.onChange(async (v) => {
							cfg.mix = v;
							this.plugin.applyCssVars();
							await this.plugin.saveSettings();
						})
				);
			new Setting(btnBody)
				.setName(`${label} · ${t("悬停幅度")}`)
				.setDesc(t("负=变暗,正=变亮;0=不变"))
				.addSlider((slider) =>
					slider
						.setLimits(-1, 1, 0.02)
						.setValue(typeof cfg.hover === "number" ? cfg.hover : 0)
						.setDynamicTooltip()
						.onChange(async (v) => {
							cfg.hover = v;
							this.plugin.applyCssVars();
							await this.plugin.saveSettings();
						})
				);
			new Setting(btnBody)
				.setName(`${label} · ${t("字色")}`)
				.setDesc(t("自动 = 深色主题近白/浅色主题近黑;反自动相反"))
				.addDropdown((drop) =>
					drop
						.addOption("auto", t("自动"))
						.addOption("anti", t("反自动"))
						.addOption("white", t("白"))
						.addOption("black", t("黑"))
						.setValue(cfg.fg || "auto")
						.onChange(async (v) => {
							cfg.fg = v;
							this.plugin.applyCssVars();
							await this.plugin.saveSettings();
						})
				);
			new Setting(btnBody)
				.setName(`${label} · ${t("字重")}`)
				.setDesc(t("按钮文字加粗与否"))
				.addDropdown((drop) =>
					drop
						.addOption("bold", t("加粗"))
						.addOption("normal", t("常规"))
						.setValue(cfg.bold ? "bold" : "normal")
						.onChange(async (v) => {
							cfg.bold = v === "bold";
							this.plugin.applyCssVars();
							await this.plugin.saveSettings();
						})
				);
		};
		btnRow("btnSubmit", t("提交按钮"));
		btnRow("btnReset", t("重置按钮"));

		new Setting(btnBody)
			.setName(t("交换两按钮配置"))
			.setDesc(t("提交与重置按钮的外观互换"))
			.addButton((btn) =>
				btn.setButtonText(t("交换")).onClick(async () => {
					const tmp = { ...this.plugin.settings.btnSubmit };
					this.plugin.settings.btnSubmit = { ...this.plugin.settings.btnReset };
					this.plugin.settings.btnReset = tmp;
					this.plugin.applyCssVars();
					await this.plugin.saveSettings();
					this.display(); // 重绘面板反映互换后的值
				})
			);

		/* -------- 收藏按钮(折叠) -------- */
		const favBody = fold(t("收藏按钮"));

		new Setting(favBody)
			.setName(t("按钮尺寸"))
			.setDesc(t("按钮边长(px),图标随之缩放"))
			.addSlider((slider) =>
				slider
					.setLimits(16, 36, 1)
					.setValue(this.plugin.settings.favBtn.size)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.favBtn.size = v;
						this.plugin.applyCssVars();
						await this.plugin.saveSettings();
					})
			);

		const favNudge = (field, label, desc) => {
			new Setting(favBody)
				.setName(label)
				.setDesc(desc)
				.addText((text) =>
					text
						.setValue(String(this.plugin.settings.favBtn[field]))
						.onChange(async (v) => {
							const n = parseFloat(v);
							this.plugin.settings.favBtn[field] = isNaN(n) ? 0 : n;
							this.plugin.applyCssVars();
							await this.plugin.saveSettings();
						})
				);
		};
		favNudge("editDX", t("编辑视图 · 横向微调"), t("在动态读位基础上再偏移(px,可负)"));
		favNudge("readDX", t("阅读视图 · 横向微调"), t("距右缘额外偏移(px,可负)"));
		favNudge("readDY", t("阅读视图 · 纵向微调"), t("距顶额外偏移(px,可负)"));
		}
	}

	// 题型脚本变更:逐条试编译(与运行时 compileTypeRules 同款 new Function)。
	// 语法错误 → 不保存(settings.qtypes 保持旧值),错误显示在编辑器下方;全部通过才保存并刷新题库页。
	async qtApply(text, qtErr) {
		const parsed = parseTypeScripts(text);
		for (const r of parsed) {
			try {
				new Function("o", `"use strict";\n${r.code}`);
			} catch (e) {
				qtErr.setText(`${t("语法错误")}: ## ${r.name} — ${e.message}`);
				return;
			}
		}
		qtErr.setText("");
		this.plugin.settings.qtypes = parsed;
		await this.plugin.saveSettings();
		this.plugin.refreshPanel?.(); // 开着的题库页立即按新规则重新分组
	}

	hide() {
		if (this.qtView) { this.qtView.destroy(); this.qtView = null; } // 关闭设置页时释放 CodeMirror
	}
}
