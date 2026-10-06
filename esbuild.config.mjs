/*
 * Better Quiz Box — 构建脚本
 * 用法:
 *   npm run dev      开发构建(带 inline sourcemap,输出到 vault 插件目录)
 *   npm run build    生产构建(无 sourcemap,tree-shaking)
 *
 * 构建产物 main.js 直接写入 Obsidian vault 的插件目录,
 * 重建/禁用重启用插件即生效。
 */

import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 部署目标自动判定(可用环境变量 VAULT_PLUGIN_DIR 强制覆盖):
//  - 仓库检出(祖先有 .git): 产物留仓库根,配合 GitHub Actions 发版
//  - vault 内(vault 布局,无 .git): 产物写到父目录 = 插件装载目录,重载即生效
function findRepoRoot(dir) {
	let cur = dir;
	for (;;) {
		if (fs.existsSync(path.join(cur, ".git"))) return cur;
		const up = path.dirname(cur);
		if (up === cur) return null;
		cur = up;
	}
}
const PLUGIN_DIR =
	process.env.VAULT_PLUGIN_DIR ||
	findRepoRoot(__dirname) ||
	path.resolve(__dirname, "..");

const prod = process.argv[2] === "production";

await esbuild.build({
	entryPoints: [path.join(__dirname, "src", "main.mjs")],
	bundle: true,
	external: ["obsidian"],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: path.join(PLUGIN_DIR, "main.js"),
});

// 同步静态文件到部署目标(styles.css 以项目内签名为准;manifest 仅当未部署目标覆盖时才推,
// 以免覆盖 vault 里用户已定制的声明——构建总是同步 styles 与 manifest 的"项目源"版本)
fs.copyFileSync(path.join(__dirname, "styles.css"), path.join(PLUGIN_DIR, "styles.css"));
fs.copyFileSync(path.join(__dirname, "manifest.json"), path.join(PLUGIN_DIR, "manifest.json"));

const where = findRepoRoot(__dirname) ? findRepoRoot(__dirname) : "插件装载目录";
console.log(prod ? `生产构建完成(main.js + styles.css + manifest.json 已同步到 ${where})` : "开发构建完成");
