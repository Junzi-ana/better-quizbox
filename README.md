# Better Quiz Box

Multiple-choice quiz blocks for [Obsidian](https://obsidian.md). Click the options to answer — your answers live in memory only, so the note itself is never modified. Questions, options, and explanations all render through Obsidian's Markdown renderer, so LaTeX works everywhere.

Built to pair with the [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) plugin: when a flashcard flips to its back, the option order and your previous answers survive the re-render.

**English** | [中文](#中文)

---

## Example

````markdown
```quiz
<!-- mode: non-immediate -->
What is $\int_0^1 x \, dx$?

[ ] $\frac{1}{3}$
[c] $\frac{1}{2}$
[ ] $1$
[h] The antiderivative of $x$ is $\frac{x^2}{2}$, evaluated from 0 to 1.
```
````

## Features

- Three answer modes: instant judgement, answer-then-check, or a plain static display.
- Questions, options, and explanations accept multi-line Markdown and LaTeX.
- Automatic option shuffling, with a stable order shared between card faces.
- Answers never touch the note file — closing the file resets everything.
- Works in reading view and flashcard review; in the editor it shows as a normal code block.

## Usage

A quiz is a fenced code block tagged `quiz`:

```
Question text                      (multi-line, Markdown / LaTeX)
[ ] distractor
[c] correct option
[h] explanation                    (optional, after the last option)
```

Option markers:

- `[ ]` — an unselected option.
- `[c]` — the correct option. Two or more `[c]` marks turn a `non-immediate` block into a multi-select.
- `[h]` — ends the last option and starts the explanation. Lines between the last option and `[h]` become extra lines of that option; leaving out `[h]` treats everything after the last option as the explanation.
- Legacy `[w]` / `[r]` markers are accepted and treated as unselected.

### Block attributes

Attributes are whole-line HTML comments, one per line, placed anywhere inside the block. The first occurrence wins; later ones are ignored.

| Attribute | Values | Default | Effect |
|-----------|--------|---------|--------|
| `mode` | `static` / `immediate` / `non-immediate` | `immediate` | Answering behavior |
| `shuffle` | `on` / `off` | `on` | Option shuffling (dynamic blocks only) |
| `number` | `abc` / `123` / `none` | `none` | Display A/B/C or 1/2/3 labels |
| `id` | any name | derived from options | Groups dynamic blocks for order sharing |
| `bind` | any name | derived from options | Makes a static block follow a dynamic block's order |

Several attributes can share one comment: `<!-- mode: static, number: abc -->`.

Duplicate options (same text, ignoring case and surrounding whitespace) are deduplicated.

### Modes

| Mode | Behavior | Typical use |
|------|----------|-------------|
| `static` | Correct options highlighted; the block is not clickable | Notes and answer sheets |
| `immediate` | Every click is judged at once: green ✓ or red ✗ | Quick self-testing |
| `non-immediate` | Clicks only highlight selections; with two or more `[c]` options the block becomes multi-select | Exam-style practice |

## Settings

Three defaults live in Settings → Better Quiz Box; explicit block attributes always win:

- **Default answer mode** — `immediate` / `non-immediate` / `static`
- **Shuffle options by default** — on / off
- **Default option numbering** — none / A B C / 1 2 3

Changes apply to newly rendered blocks; already-rendered ones stay as they are. A block can always override a default with its own attribute, e.g. `<!-- number: none -->` turns numbering off for that block even when a default is set.

## Installation

Manual: grab `main.js`, `manifest.json`, and `styles.css` from the latest [release](../../releases), put them into `<vault>/.obsidian/plugins/better-quizbox/`, then enable the plugin under Settings → Community plugins.

Or with [BRAT](https://github.com/TfTHacker/obsidian42-brat): add `Junzi-ana/better-quizbox` as a beta plugin.

## Development

```bash
npm install
npm run build
```

The build bundles `src/` into `main.js` at the repository root. To cut a release, push a plain version tag (no `v` prefix, e.g. `3.0.0`) — GitHub Actions builds the plugin and drafts a release with `main.js`, `manifest.json`, and `styles.css` attached.

## License

[MIT](LICENSE)

---

<div align="right"><a href="#better-quiz-box">Back to top ↑</a></div>

## 中文

[Obsidian](https://obsidian.md) 的多项选择题块插件。点击选项即可作答，答案只保存在内存中，笔记文件不会被改动。题干、选项、解析都经由 Obsidian 的 Markdown 渲染，LaTeX 公式随处可用。

专为配合 [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) 插件的复习流程而设计：记忆卡翻面重渲染时，选项顺序与已作答的内容都会保留。

[English](#better-quiz-box) | **中文**

---

### 示例

````markdown
```quiz
<!-- mode: non-immediate -->
求 $\int_0^1 x \, dx$。

[ ] $\frac{1}{3}$
[c] $\frac{1}{2}$
[ ] $1$
[h] $x$ 的原函数是 $\frac{x^2}{2}$，代入上下限计算。
```
````

### 特性

- 三种作答模式：即时判分、先答后查、纯静态展示。
- 题干、选项、解析均支持多行 Markdown 与 LaTeX。
- 选项自动打乱，正反面共享同一顺序。
- 作答不触碰笔记文件——关闭文件即自动复位。
- 阅读视图与闪卡复习中可用；编辑器中显示为普通代码块。

### 用法

一道题就是一个 `quiz` 围栏代码块：

```
题干                                （多行，Markdown / LaTeX）
[ ] 干扰项
[c] 正确选项
[h] 解析                            （可选，位于最后一个选项之后）
```

选项标记：

- `[ ]` —— 未选中的选项。
- `[c]` —— 正确选项。出现两个及以上 `[c]` 时，`non-immediate` 块转为多选。
- `[h]` —— 结束最后一个选项、开始解析。最后一个选项与 `[h]` 之间的行会并入该选项；省略 `[h]` 时，最后一个选项之后的全部内容都视为解析。
- 兼容旧写法 `[w]` / `[r]`，一律按未选处理。

### 块属性

块属性是一整行的 HTML 注释，每行一条，写在块内任意位置。首个出现的生效，后续重复的被忽略。

| 属性 | 取值 | 缺省 | 作用 |
|------|------|------|------|
| `mode` | `static` / `immediate` / `non-immediate` | `immediate` | 作答行为 |
| `shuffle` | `on` / `off` | `on` | 打乱选项（仅动态块） |
| `number` | `abc` / `123` / `none` | `none` | 显示 A/B/C 或 1/2/3 编号 |
| `id` | 任意名字 | 按选项自动推导 | 动态块的分组标识，共享顺序 |
| `bind` | 任意名字 | 按选项自动推导 | 让静态块跟随某动态块的顺序 |

多条属性可以共用一行注释：`<!-- mode: static, number: abc -->`。

文本相同的选项（忽略大小写与首尾空白）会被去重。

### 三种模式

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `static` | 高亮正确选项，块不可点击 | 笔记、答案页 |
| `immediate` | 每次点击立即判分：对绿 ✓、错红 ✗ | 快速自测 |
| `non-immediate` | 点击仅高亮所选；有两个及以上 `[c]` 时转为多选 | 考试式练习 |

## 设置

设置 → Better Quiz Box 里有三项缺省值；块内显式属性始终优先：

- **默认作答模式**——`immediate` / `non-immediate` / `static`
- **默认打乱选项**——开 / 关
- **默认选项编号**——无 / ABC / 123

改动只影响之后渲染的块，已在页面上的不变。块内可以用自己的属性覆盖缺省，例如设了默认编号后，单个块写 `<!-- number: none -->` 即可关掉编号。

## 安装

手动安装：从最新 [Release](../../releases) 下载 `main.js`、`manifest.json`、`styles.css`，放入 `<vault>/.obsidian/plugins/better-quizbox/`，然后在 设置 → 第三方插件 中启用。

或通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat)：添加 `Junzi-ana/better-quizbox` 为 beta 插件。

## 开发

```bash
npm install
npm run build
```

构建会把 `src/` 打包为仓库根目录下的 `main.js`。发版时打一个纯版本号的 tag（不带 `v` 前缀，如 `3.0.0`），GitHub Actions 会自动构建并创建附带 `main.js`、`manifest.json`、`styles.css` 的草稿 Release。

## 许可

[MIT](LICENSE)
