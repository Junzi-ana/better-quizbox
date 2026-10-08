/* Better Quiz Box — 设置栏(全中文)
 * 四项设置:块属性显式给出时始终优先;设置只影响之后的渲染。
 */

import { PluginSettingTab, Setting } from "obsidian";

export const DEFAULT_SETTINGS = {
	defaultMode: "immediate",
	defaultShuffle: true,
	defaultNumbering: "none",
	idMode: "manual", // manual | auto
	idLength: 7, // 4..10
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
			.setDesc("自动:按整道题内容生成 id 并写入文件;题面改动后 id 随之更新")
			.addDropdown((drop) =>
				drop
					.addOption("manual", "手动")
					.addOption("auto", "自动")
					.setValue(this.plugin.settings.idMode)
					.onChange(async (value) => {
						this.plugin.settings.idMode = value;
						await this.plugin.saveSettings();
						this.plugin.syncIdAutomation();
					})
			);

		new Setting(containerEl)
			.setName("id 位数")
			.setDesc("新分配的 id 长度(4–10 位)。已分配的 id 不变,直到编辑该题或全库重编号")
			.addSlider((slider) =>
				slider
					.setLimits(4, 10, 1)
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
			.setDesc("重写所有笔记里 quiz 块的 id(仅动 quiz 块)")
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
