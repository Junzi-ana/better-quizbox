/* Better Quiz Box — 设置栏(全中文)
 * 设置只在块属性未显式给出时生效;块属性显式始终优先;设置只影响之后的渲染。
 */

import { PluginSettingTab, Setting } from "obsidian";

export const DEFAULT_SETTINGS = {
	defaultMode: "immediate",
	defaultShuffle: true,
	defaultNumbering: "none",
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

		new Setting(containerEl)
			.setName("默认作答模式")
			.setDesc("块内未写 mode: 属性时生效")
			.addDropdown((drop) =>
				drop
					.addOption("immediate", "即时判分")
					.addOption("non-immediate", "先选后查")
					.addOption("static", "静态展示")
					.setValue(this.plugin.settings.defaultMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultMode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("默认打乱选项")
			.setDesc("块内未写 shuffle: 属性时生效")
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
			.setDesc("块内未写 number: 属性时生效")
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

		new Setting(containerEl)
			.setName("题目 id 分配")
			.setDesc("自动:给没有 id 的 quiz 块分配计数器编号;已分配的 id 永不改写,内容编辑不影响 id")
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
			.setDesc("3–9 位;一半文件名 hash、另一半块号定长,奇数时多一位 hash(如码长 7 = hash 4 + 块号 3)。只影响之后新分配的块,已分配的 id 不变")
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
			.setName("绑定默认保留题干")
			.setDesc("bind 默认不显示题干;开启后默认保留。copy 始终保留,块内 stem 属性可单独覆盖")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultBindStem)
					.onChange(async (value) => {
						this.plugin.settings.defaultBindStem = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("全库重新编号")
			.setDesc("所有笔记里 quiz 块的 id 按计数器连续重编(引用旧 id 的 bind/copy 自动同步)")
			.addButton((btn) =>
				btn.setButtonText("重新编号").onClick(() => {
					if (window.confirm("将重写全库 quiz 块的 id,确认执行?")) {
						this.plugin.renumberAllIds();
					}
				})
			);

		new Setting(containerEl)
			.setName("调试日志")
			.setDesc("在开发者控制台(Ctrl+Shift+I → Console,过滤 bqb)输出插件事件;排查用,平时关着")
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
