/* Better Quiz Box — 设置栏(双语,分组排布,进阶项折叠)
 * 设置只在块属性未显式给出时生效;块属性显式始终优先;设置只影响之后的渲染。
 */

import { PluginSettingTab, Setting } from "obsidian";
import { t } from "./i18n.mjs";

export const DEFAULT_SETTINGS = {
	// 出厂预设 = 作者(Junzi-ana)日常使用配置,他人安装即得此套默认(2026-10 固化)
	defaultMode: "non-immediate", // 主打模式:先选后查(单选多选)
	defaultShuffle: true, // 打乱选项
	defaultNumbering: "abc", // 默认选项编号 A B C
	submitEnabled: true, // non-immediate 提交按钮(按下批改并显示正确答案)
	resetMode: "manual", // user 偏好:跨容器保留批改态直到按重置
	showReset: true, // 批改后显示重置按钮
	verdictOk: "回答正确！正确答案：{ans}。", // 判对文案(出厂中文;非中文界面显示时自动切英文,见 main.verdictTexts)
	verdictBad: "回答错误！正确答案：{ans}，你的选择：{pick}。", // 判错文案({ans}/{pick} 占位)
	renumberExclude: "", // 重新编号屏蔽目录(每行一个路径)
	btnSubmit: { mix: 65, hover: 0.04, fg: "white", bold: false }, // 提交按钮外观(混色%/悬停±/字色/字重)
	btnReset: { mix: 25, hover: -0.04, fg: "black", bold: false }, // 重置按钮外观
	favorites: {}, // 收藏:题目 id → { addedAt 收藏时间, reviews 复习记录(接口预留) }(bind/copy 镜像与源题共享同一收藏)
	favCats: [], // 自建分类名单(收藏夹「分类」页管理)
	catAssign: {}, // 分类归属:题目 id → [分类名](独立于收藏,未收藏的题也能归类)
	study: {}, // 复习排期:题目 id → { reviews: [{ t 复习时间戳, ok 答对? }] }(全库题都有,独立于收藏)
	activity: {}, // 每日复习数:"YYYY-MM-DD" → n(主页热力图数据源)
	favBtn: { size: 24, editDX: 0, readDX: -3, readDY: -9 }, // 收藏按钮微调:尺寸px/编辑横向/阅读横向/阅读纵向
	idMode: "auto", // manual | auto(user 偏好自动分配)
	idLength: 6, // 3..9(user 偏好 6 位)
	defaultBindStem: true, // bind 是否保留题干(user 偏好保留)
	debug: false, // 调试日志
};

export class QuizBoxSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
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
					.addOption("immediate", t("即时判分(单选,快)"))
					.addOption("non-immediate", t("先选后查(单选/多选)"))
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

		/* ------------ 批改 ------------ */
		new Setting(containerEl).setName(t("批改(先选后查)")).setHeading();

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

		/* -------- 批改文案(进阶,折叠) -------- */
		const vfBody = fold(t("批改文案(测试)"));

		new Setting(vfBody)
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

		new Setting(vfBody)
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

		/* -------- 按钮外观(进阶,折叠) -------- */
		const btnBody = fold(t("按钮外观(测试)"));

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
							this.plugin.applyButtonVars();
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
							this.plugin.applyButtonVars();
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
							this.plugin.applyButtonVars();
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
							this.plugin.applyButtonVars();
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
					this.plugin.applyButtonVars();
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
						this.plugin.applyButtonVars();
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
							this.plugin.applyButtonVars();
							await this.plugin.saveSettings();
						})
				);
		};
		favNudge("editDX", t("编辑视图 · 横向微调"), t("在动态读位基础上再偏移(px,可负)"));
		favNudge("readDX", t("阅读视图 · 横向微调"), t("距右缘额外偏移(px,可负)"));
		favNudge("readDY", t("阅读视图 · 纵向微调"), t("距顶额外偏移(px,可负)"));

		/* ------------ 其他 ------------ */
		new Setting(containerEl).setName(t("其他")).setHeading();

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
	}
}
