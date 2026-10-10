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
- Automatic stable block IDs, with `bind` / `copy` blocks that mirror a question elsewhere and follow its order.
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
| `id` | auto (counter) or any name | file hash + block number | Identifies a block; auto-assigned to blocks lacking one and never rewritten when the question changes |
| `bind` | a block id | — | Renders a read-only copy of that question (stem hidden by default) |
| `copy` | a block id | — | Renders an editable copy of that question, keeping its mode |
| `stem` | `on` / `off` | `off` for `bind`, `on` for `copy` | Keep the target's stem |

Several attributes can share one comment: `<!-- mode: static, number: abc -->`.

Duplicate options (same text, ignoring case and surrounding whitespace) are deduplicated.

### Block IDs, bind and copy

Every dynamic block can carry an `id`. In auto mode (default) a block that has no `id` gets a stable counter id = file-name hash prefix + block number (code length adjustable, default 7). An id, once assigned, is never rewritten: editing the stem or options doesn't change it, so `bind`/`copy` references never break. A "Renumber all block IDs" button in the settings renumbers every block per file from 0 and updates references to match.

A `bind` block renders the target question read-only (correct options highlighted); by default the stem is hidden — add `<!-- stem: on -->` to keep it. A `copy` block renders an editable copy that keeps the target's own mode, so you can answer it independently. Both follow the target's current shuffled option order. An id that can't be resolved simply renders the block as a normal question. `bind`/`copy` blocks themselves get no id.

### Modes

| Mode | Behavior | Typical use |
|------|----------|-------------|
| `static` | Correct options highlighted; the block is not clickable | Notes and answer sheets |
| `immediate` | Every click is judged at once: green ✓ or red ✗ | Quick self-testing |
| `non-immediate` | Clicks only highlight selections; with two or more `[c]` options the block becomes multi-select | Exam-style practice |

## Settings

Settings → Better Quiz Box; explicit block attributes always win:

- **Default answer mode** — `immediate` / `non-immediate` / `static`
- **Shuffle options by default** — on / off
- **Default option numbering** — none / A B C / 1 2 3
- **Block id assignment** — manual / auto (auto assigns a stable counter id to each block lacking one; ids are never rewritten, so editing a question doesn't change its id)
- **Id code length** — 3–9 characters (default 7); half is the file-name hash, the other half a zero-padded block number, odd lengths give the hash the extra digit
- **Keep stem in bind blocks** — off by default
- **Renumber all block IDs** — renumber every block per file from 0 (references are updated to match; cross-file collisions are avoided automatically)

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
- 自动稳定的块 id（计数器编号，永不改写）；`bind` / `copy` 块可在他处镜像某道题并跟随其顺序。
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
| `id` | 自动（计数器编号）或任意名字 | 文件 hash + 块号 | 块的标识；自动分配给没有 id 的块，题面变化时永不改写 |
| `bind` | 某个块的 id | — | 只读渲染该题（默认隐藏题干） |
| `copy` | 某个块的 id | — | 可作答渲染该题，保留其模式 |
| `stem` | `on` / `off` | `bind` 为 `off`、`copy` 为 `on` | 是否保留目标题干 |

多条属性可以共用一行注释：`<!-- mode: static, number: abc -->`。

文本相同的选项（忽略大小写与首尾空白）会被去重。

### 块 id、bind 与 copy

每个动态块都可以带一个 `id`。自动模式（缺省）下，没有 id 的块会得到一个**稳定的计数器编号** = 文件名 hash 前缀 + 块号（码长可调，缺省 7）。id 一旦分配**永不改写**：改题干或选项都不会改变它，所以 `bind`/`copy` 引用永远不会失效。设置里的「全库重新编号」按钮会逐文件从 0 重编所有块，并同步更新引用。

`bind` 块只读渲染目标题（正确项高亮），默认隐藏题干，写 `<!-- stem: on -->` 可保留；`copy` 块渲染可作答的副本，保留目标自身的模式，可以独立作答。两者都跟随目标题当前的打乱顺序。id 无法解析时，该块按普通题渲染。`bind`/`copy` 块本身不分配 id。

### 三种模式

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `static` | 高亮正确选项，块不可点击 | 笔记、答案页 |
| `immediate` | 每次点击立即判分：对绿 ✓、错红 ✗ | 快速自测 |
| `non-immediate` | 点击仅高亮所选；有两个及以上 `[c]` 时转为多选 | 考试式练习 |

## 设置

设置 → Better Quiz Box；块内显式属性始终优先：

- **默认作答模式**——`immediate` / `non-immediate` / `static`
- **默认打乱选项**——开 / 关
- **默认选项编号**——无 / ABC / 123
- **题目 id 分配**——手动 / 自动（自动给没有 id 的块分配稳定的计数器编号；id 永不改写，改题面不变）
- **id 码长**——3–9 位（缺省 7）；一半文件名 hash、一半块号定长，奇数时多一位 hash
- **bind 块保留题干**——缺省关
- **全库重新编号**——逐文件从 0 连续重编所有块的 id（引用自动同步，跨文件撞号自动错开）

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
