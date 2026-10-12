/* Better Quiz Box — 设置栏(全中文,分组排布,测试类样式折叠)
 * 设置只在块属性未显式给出时生效;块属性显式始终优先;设置只影响之后的渲染。
 */

import { PluginSettingTab, Setting } from "obsidian";

export const DEFAULT_SETTINGS = {
	defaultMode: "immediate",
	defaultShuffle: true,
	defaultNumbering: "none",
	submitEnabled: true, // non-immediate 提交按钮(按下批改并显示正确答案)
	resetMode: "auto", // auto(切页重渲染即重置) | manual(批改态保留直到按重置)
	showReset: true, // 自动重置时批改后是否显示重置按钮(手动重置时恒显示)
	verdictOk: "回答正确！", // 判对文案
	verdictBad: "回答错误！正确答案：{ans}，你的选择：{pick}", // 判错文案({ans}/{pick} 占位)
	renumberExclude: "", // 重新编号屏蔽目录(每行一个路径)
	btnSubmit: { mix: 30, hover: 0, fg: "auto", bold: true }, // 提交按钮外观(混色%/悬停±/字色/字重)
	btnReset: { mix: 10, hover: 0, fg: "auto", bold: false }, // 重置按钮外观
	favorites: [], // 已收藏的块 key 列表(前端先行,后续做收藏夹视图)
	favBtn: { size: 24, editDX: 0, readDX: 0, readDY: 0 }, // 收藏按钮微调:尺寸px/编辑横向/阅读横向/阅读纵向
	idMode: "manual", // manual | auto
	idLength: 7, // 3..9
	defaultBindStem: false, // bind 是否保留题干(默认不保留)
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

		// 折叠分组:标题行点击开合;open = 默认展开(测试类样式默认收起)
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
		new Setting(containerEl).setName("作答").setHeading();

		new Setting(containerEl)
			.setName("默认作答模式")
			.setDesc("块内未写 mode 时生效")
			.addDropdown((drop) =>
				drop
					.addOption("immediate", "即时判分(单选,快)")
					.addOption("non-immediate", "先选后查(单选多选,主打)")
					.addOption("static", "静态展示")
					.setValue(this.plugin.settings.defaultMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultMode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("默认打乱选项")
			.setDesc("块内未写 shuffle 时生效")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultShuffle)
					.onChange(async (value) => {
						this.plugin.settings.defaultShuffle = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("默认选项编号")
			.setDesc("块内未写 number 时生效")
			.addDropdown((drop) =>
				drop
					.addOption("none", "无")
					.addOption("abc", "A B C")
					.addOption("123", "1 2 3")
					.setValue(this.plugin.settings.defaultNumbering)
					.onChange(async (value) => {
						this.plugin.settings.defaultNumbering = value;
						await this.plugin.saveSettings();
					})
			);

		/* ------------ 批改 ------------ */
		new Setting(containerEl).setName("批改(先选后查)").setHeading();

		new Setting(containerEl)
			.setName("提交按钮")
			.setDesc("选中后右下角提交,按下批改并显示答案;关闭则纯作答。块内 submit 可覆盖")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.submitEnabled)
					.onChange(async (value) => {
						this.plugin.settings.submitEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("重置方式")
			.setDesc("自动:切页即重置;手动:保留到按重置。块内 reset 可覆盖")
			.addDropdown((drop) =>
				drop
					.addOption("auto", "自动重置")
					.addOption("manual", "手动重置")
					.setValue(this.plugin.settings.resetMode)
					.onChange(async (value) => {
						this.plugin.settings.resetMode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("批改后显示重置按钮")
			.setDesc("自动重置下可关;手动重置恒显示")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showReset)
					.onChange(async (value) => {
						this.plugin.settings.showReset = value;
						await this.plugin.saveSettings();
					})
			);

		/* -------- 批改文案(测试,折叠) -------- */
		const vfBody = fold("批改文案(测试)");

		new Setting(vfBody)
			.setName("判对文案")
			.setDesc("支持占位符 {ans}=正确答案 {pick}=你的选择")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.verdictOk)
					.onChange(async (value) => {
						this.plugin.settings.verdictOk = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(vfBody)
			.setName("判错文案")
			.setDesc("同上;空占位符会被剔除")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.verdictBad)
					.onChange(async (value) => {
						this.plugin.settings.verdictBad = value;
						await this.plugin.saveSettings();
					})
			);

		/* ------------ 题目 ID ------------ */
		new Setting(containerEl).setName("题目 ID").setHeading();

		new Setting(containerEl)
			.setName("自动分配")
			.setDesc("给没有 id 的块分配计数器编号;已分配的永不改写")
			.addDropdown((drop) =>
				drop
					.addOption("manual", "手动")
					.addOption("auto", "自动")
					.setValue(this.plugin.settings.idMode)
					.onChange(async (value) => {
						this.plugin.settings.idMode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("id 码长")
			.setDesc("3–9 位:一半文件名 hash、一半块号,奇数多一位 hash;只影响之后新分配的块")
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
			.setName("全库重新编号")
			.setDesc("全部 quiz 块按计数器连续重编,引用自动同步")
			.addButton((btn) =>
				btn.setButtonText("重新编号").onClick(() => {
					if (window.confirm("将重写全库 quiz 块的 id,确认执行?")) {
						this.plugin.renumberAllIds();
					}
				})
			);

		new Setting(containerEl)
			.setName("重新编号屏蔽目录")
			.setDesc("每行一个路径(目录或单文件),重新编号时跳过")
			.addTextArea((area) =>
				area
					.setValue(this.plugin.settings.renumberExclude)
					.onChange(async (value) => {
						this.plugin.settings.renumberExclude = value;
						await this.plugin.saveSettings();
					})
			);

		/* -------- 按钮外观(测试,折叠) -------- */
		const btnBody = fold("按钮外观(测试)");

		// 每个按钮 4 项:混色比例 / 悬停(左暗右亮) / 字色(自动|反自动|白|黑) / 字重
		const btnRow = (key, label) => {
			const cfg = this.plugin.settings[key];
			new Setting(btnBody)
				.setName(`${label} · 强调色混合`)
				.setDesc("强调色掺入背景的比例,%越大越浓")
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
				.setName(`${label} · 悬停幅度`)
				.setDesc("左暗右亮;0 = 悬停不变")
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
				.setName(`${label} · 字色`)
				.setDesc("自动 = 深色主题近白/浅色主题近黑;反自动相反")
				.addDropdown((drop) =>
					drop
						.addOption("auto", "自动")
						.addOption("anti", "反自动")
						.addOption("white", "白")
						.addOption("black", "黑")
						.setValue(cfg.fg || "auto")
						.onChange(async (v) => {
							cfg.fg = v;
							this.plugin.applyButtonVars();
							await this.plugin.saveSettings();
						})
				);
			new Setting(btnBody)
				.setName(`${label} · 字重`)
				.setDesc("按钮文字加粗与否")
				.addDropdown((drop) =>
					drop
						.addOption("bold", "加粗")
						.addOption("normal", "常规")
						.setValue(cfg.bold ? "bold" : "normal")
						.onChange(async (v) => {
							cfg.bold = v === "bold";
							this.plugin.applyButtonVars();
							await this.plugin.saveSettings();
						})
				);
		};
		btnRow("btnSubmit", "提交按钮");
		btnRow("btnReset", "重置按钮");

		new Setting(btnBody)
			.setName("交换两按钮配置")
			.setDesc("提交/重置的外观互换(混色/悬停/字色/字重)")
			.addButton((btn) =>
				btn.setButtonText("交换").onClick(async () => {
					const tmp = { ...this.plugin.settings.btnSubmit };
					this.plugin.settings.btnSubmit = { ...this.plugin.settings.btnReset };
					this.plugin.settings.btnReset = tmp;
					this.plugin.applyButtonVars();
					await this.plugin.saveSettings();
					this.display(); // 重绘面板反映互换后的值
				})
			);

		/* -------- 收藏按钮(折叠) -------- */
		const favBody = fold("收藏按钮");

		new Setting(favBody)
			.setName("按钮尺寸")
			.setDesc("按钮边长(px),图标随之缩放")
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
		favNudge("editDX", "编辑视图 · 横向微调", "在动态读位基础上再偏移(px,可负)");
		favNudge("readDX", "阅读视图 · 横向微调", "距右缘额外偏移(px,可负)");
		favNudge("readDY", "阅读视图 · 纵向微调", "距顶额外偏移(px,可负)");

		/* ------------ 其他 ------------ */
		new Setting(containerEl).setName("其他").setHeading();

		new Setting(containerEl)
			.setName("绑定默认保留题干")
			.setDesc("bind 默认藏题干;块内 stem 可覆盖")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultBindStem)
					.onChange(async (value) => {
						this.plugin.settings.defaultBindStem = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("调试日志")
			.setDesc("控制台(过滤 bqb)输出插件事件;排查用")
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
