/* Better Quiz Box — 设置栏
 * 提供三项缺省设置:块属性未指定时生效;块内显式属性始终优先。
 * 设置只影响之后的渲染(已在页面上的块不回溯)。
 */

import { PluginSettingTab, Setting } from "obsidian";

export const DEFAULT_SETTINGS = {
	defaultMode: "immediate", // static | immediate | non-immediate
	defaultShuffle: true, // 未写 shuffle: 属性时的缺省
	defaultNumbering: "none", // none | abc | 123
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
			.setName("Default answer mode")
			.setDesc("Used by quiz blocks without an explicit <!-- mode: ... --> attribute.")
			.addDropdown((drop) =>
				drop
					.addOption("immediate", "Immediate (judge every click)")
					.addOption("non-immediate", "Non-immediate (select first, check later)")
					.addOption("static", "Static (show answers, no clicking)")
					.setValue(this.plugin.settings.defaultMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultMode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Shuffle options by default")
			.setDesc("Used by quiz blocks without an explicit <!-- shuffle: ... --> attribute.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultShuffle)
					.onChange(async (value) => {
						this.plugin.settings.defaultShuffle = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default option numbering")
			.setDesc("Label style used by quiz blocks without an explicit <!-- number: ... --> attribute.")
			.addDropdown((drop) =>
				drop
					.addOption("none", "None")
					.addOption("abc", "A B C")
					.addOption("123", "1 2 3")
					.setValue(this.plugin.settings.defaultNumbering)
					.onChange(async (value) => {
						this.plugin.settings.defaultNumbering = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
