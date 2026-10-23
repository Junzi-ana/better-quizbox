
## 中文

在 [Obsidian](https://obsidian.md) 文档中创建可交互的选择题，且作答时笔记文件不会改动。题干、选项、解析都支持 markdown 原生格式。本插件设计之初是为了配合 [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) 插件制作选择题形式的闪卡。目前原生 UI 开发中，仍将保留对 Spaced Repetition 插件的支持。

[English](#better-quiz-box) | **中文**

---

### 示例

````markdown
```quiz
<!-- id: sok013 -->
<!-- mode: non-immediate -->
求 $\int_0^1 x \, dx$。

[ ] $\frac{1}{3}$
[c] $\frac{1}{2}$
[ ] $1$
[h] $x$ 的原函数是 $\frac{x^2}{2}$，代入上下限计算。
```
````

### 特性

- 三种作答模式：即时判分、先选后提交、纯静态展示。
- 题干、选项、解析均支持多行 Markdown 与 LaTeX。
- 支持选项自动打乱。
- 每个块分配唯一的 id，支持通过 `bind` / `copy` 在他处镜像某道题目并跟随其选项顺序。
- 支持收藏题目，并建立收藏夹（**收藏夹、复习相关功能仍在开发中**）
- 交互过程不改写笔记文件。

### 用法

一道题就是一个 `quiz` 围栏代码块：

```
题干                                （多行，Markdown / LaTeX）
[ ] 干扰项
[c] 正确选项
[h] 提示 / 解析                            （可选，位于最后一个选项之后）
```

选项标记：

- `[ ]` —— 未选中的选项。
- `[c]` —— 正确选项。出现两个及以上 `[c]` 时，`non-immediate` 块转为多选。
- `[h]` —— 结束最后一个选项、开始解析。省略 `[h]` 时，最后一个选项下一行的全部内容都视为解析。

文本相同的选项会被去重。

### 块属性

块属性是一整行的 HTML 注释，多条属性可以共用一行注释，例如 `<!-- mode: static, number: abc -->`。

| 属性        | 取值                                       | 缺省              | 作用                                |
| --------- | ---------------------------------------- | --------------- | --------------------------------- |
| `mode`    | `static` / `immediate` / `non-immediate` | `non-immediate` | 作答行为                              |
| `shuffle` | `on` / `off`                             | `on`            | 打乱选项（仅非静态块）                       |
| `number`  | `abc` / `123` / `none`                   | `abc`           | 显示 A/B/C 或 1/2/3 编号               |
| `id`      | 自动编号或任意名字                                | 自动编号            | 块的标识，自动分配给没有 id 的块                |
| `bind`    | 某个块的 id                                  | —               | 只读渲染该题                            |
| `copy`    | 某个块的 id                                  | —               | 可作答渲染该题，保留其模式                     |
| `stem`    | `on` / `off`                             | `on`            | 保留目标题干 / 只渲染选项                    |
| `submit`  | `on` / `off`                             | `on`            | 若关闭，则 `non-immediate` 模式只能交互，无法批改 |
| `reset`   | `auto` / `manual`                        | `manual`        | `submit` 开启时，批改后是否自动重置            |

## 设置

设置 → Better Quiz Box；块内显式属性始终优先：

- **默认作答模式**——`immediate` / `non-immediate` / `static`
- **默认打乱选项**——开 / 关
- **默认选项编号**——无 / ABC / 123
- **批改**—— `non-immediate` 是否可提交批改，若关闭则只有基础的选择交互，用于作为闪卡的正面
- **批改文案**——判对/判错模板可自定义；`{ans}` = 正确答案、`{pick}` = 你的选择（为非中文母语者提供）
- **按钮外观（折叠）**——开发测试用，已调好，勿动
- **题目 id 分配**——手动 / 自动（自动给没有 id 的块分配稳定的计数器编号）
- **id 码长**——3–9 位
- **全库重新编号**——逐文件从 0 连续重编所有块的 id（引用自动同步，跨文件撞号自动错开）
- **重新编号屏蔽目录**——每行一个路径，重新编号时跳过
- **bind 块保留题干**——缺省开（单块写 `<!-- stem: off -->` 可关）
- **收藏按钮**——开发测试用，已调好，勿动

改动只影响之后渲染的块，已在页面上的不变。块内可以用自己的属性覆盖缺省，例如设了默认编号后，单个块写 `<!-- number: none -->` 即可关掉编号。

## 安装

手动安装：从最新 [Release](../../releases) 下载 `main.js`、`manifest.json`、`styles.css`，放入 `<vault>/.obsidian/plugins/better-quizbox/`，然后在 设置 → 第三方插件 中启用。

或通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat)：添加 `Junzi-ana/better-quizbox` 为 beta 插件。

## 许可

[MIT](LICENSE)

---

# Better Quiz Box

Create interactive multiple-choice quiz blocks in your [Obsidian](https://obsidian.md) notes — answering never modifies the note file. Stems, options and explanations all support native Markdown. The plugin was originally designed to make multiple-choice flashcards for the [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) plugin. A native UI is currently in development; support for the Spaced Repetition plugin will be retained.

**English** | [中文](#中文)

---

### Example

````markdown
```quiz
<!-- id: sok013 -->
<!-- mode: non-immediate -->
求 $\int_0^1 x \, dx$。

[ ] $\frac{1}{3}$
[c] $\frac{1}{2}$
[ ] $1$
[h] $x$ 的原函数是 $\frac{x^2}{2}$，代入上下限计算。
```
````

### Features

- Three answering modes: instant grading, select-then-submit, and static display.
- Stems, options and explanations support multi-line Markdown and LaTeX.
- Options can be shuffled automatically.
- Every block gets a unique id; `bind` / `copy` mirror a question elsewhere and follow its option order.
- Favorite questions and organize them in a favorites panel (**favorites and review features are still in development**)
- Answering never rewrites the note file.

### Usage

A question is a `quiz` fenced code block:

```
stem                                (multi-line, Markdown / LaTeX)
[ ] distractor
[c] correct option
[h] hint / explanation              (optional, after the last option)
```

Option markers:

- `[ ]` — an unselected option.
- `[c]` — the correct option. With two or more `[c]`, a `non-immediate` block becomes multiple-choice.
- `[h]` — ends the last option and starts the explanation. Without `[h]`, everything on the lines after the last option is treated as the explanation.

Options with identical text are deduplicated.

### Block attributes

Block attributes are full-line HTML comments; several attributes can share one comment, e.g. `<!-- mode: static, number: abc -->`.

| Attribute | Values                                   | Default         | Purpose                                                  |
| --------- | ---------------------------------------- | --------------- | -------------------------------------------------------- |
| `mode`    | `static` / `immediate` / `non-immediate` | `non-immediate` | Answering behavior                                       |
| `shuffle` | `on` / `off`                             | `on`            | Shuffle options (non-static blocks only)                 |
| `number`  | `abc` / `123` / `none`                   | `abc`           | Show A/B/C or 1/2/3 numbering                            |
| `id`      | auto number or any name                  | auto number     | Block identity; auto-assigned to blocks without an id    |
| `bind`    | the id of another block                  | —               | Render that question read-only                           |
| `copy`    | the id of another block                  | —               | Render it answerable, keeping its mode                   |
| `stem`    | `on` / `off`                             | `on`            | Keep the target stem / render options only               |
| `submit`  | `on` / `off`                             | `on`            | If off, `non-immediate` blocks stay interactive, no grading |
| `reset`   | `auto` / `manual`                        | `manual`        | With `submit` on, whether to auto-reset after grading    |

## Settings

Settings → Better Quiz Box; explicit block attributes always win:

- **Default mode** — `immediate` / `non-immediate` / `static`
- **Shuffle options** — on / off
- **Option numbering** — none / ABC / 123
- **Grading** — whether `non-immediate` blocks can be submitted for grading; if off, only basic selection interaction remains, useful as the front of a flashcard
- **Verdict text** — correct/wrong templates are customizable; `{ans}` = correct answer, `{pick}` = your pick
- **Button appearance (collapsed)** — for development testing; already tuned, leave as is
- **Question id assignment** — manual / auto (auto assigns stable counter ids to blocks without one)
- **ID length** — 3–9 digits
- **Renumber all** — renumber every block's id from 0, file by file (references update automatically; cross-file collisions are shifted apart)
- **Excluded paths** — one path per line, skipped when renumbering
- **Keep stem on bind** — on by default (a single block can opt out via `<!-- stem: off -->`)
- **Favorite button** — for development testing; already tuned, leave as is

Changes only affect blocks rendered afterwards; blocks already on the page stay as they are. A block can override defaults with its own attributes — e.g. with a default numbering set, a single block can turn numbering off with `<!-- number: none -->`.

## Installation

Manual: download `main.js`, `manifest.json` and `styles.css` from the latest [Release](../../releases) into `<vault>/.obsidian/plugins/better-quizbox/`, then enable the plugin under Settings → Community plugins.

Or via [BRAT](https://github.com/TfTHacker/obsidian42-brat): add `Junzi-ana/better-quizbox` as a beta plugin.

## License

[MIT](LICENSE)
