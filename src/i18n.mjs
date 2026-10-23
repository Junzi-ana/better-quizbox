/* Better Quiz Box — 双语文本
 * 中文是源语言(开发语言):界面为中文时 t() 原样直通,零开销。
 * 其它界面语言查 EN 表;漏译的条目自动回落中文,不会崩。
 * 语言检测:先读 Obsidian 界面语言设置(localStorage.language),回退 Obsidian 注入的
 * moment.locale();都没有(window 不存在,如测试沙箱)时按中文处理。
 */

function detectLocale() {
  try {
    if (typeof window !== "undefined") {
      const saved = window.localStorage && window.localStorage.getItem("language");
      if (saved) return String(saved).toLowerCase();
      if (window.moment) return String(window.moment.locale()).toLowerCase();
    }
  } catch (e) {
    /* 取不到就回落中文 */
  }
  return "zh";
}

export const isZh = detectLocale().startsWith("zh");

// 星期名(英文取 Obsidian 惯用三字母缩写)
export const WEEKDAYS = isZh
  ? "日一二三四五六".split("")
  : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// 英文表:key = 中文原文(与代码里的字面量逐字一致),value = 英文。
const EN = {
  /* —— 批改流 —— */
  "提交": "Submit",
  "重置": "Reset",
  "回答正确！": "Correct!",
  "回答错误！正确答案：{ans}，你的选择：{pick}": "Wrong! Answer: {ans}; yours: {pick}",

  /* —— 收藏/通知 —— */
  "已取消收藏": "Unfavorited",
  "已收藏": "Favorited",
  "取消收藏": "Unfavorite",
  "收藏本题": "Favorite this question",
  "找不到 {p}": "Not found: {p}",
  "打开失败 {p}": "Failed to open: {p}",
  "扫描 {n} 个笔记…": "Scanning {n} notes…",
  "已重新编号 {a} 题,分布于 {b} 个文件。": "Renumbered {a} questions in {b} files.",

  /* —— 学习面板:通用 —— */
  "返回主页": "Back",
  "Better Quiz Box": "Better Quiz Box",

  /* —— 主页 —— */
  "夜深了": "Working late",
  "早上好": "Good morning",
  "上午好": "Good morning",
  "中午好": "Good afternoon",
  "下午好": "Good afternoon",
  "晚上好": "Good evening",
  "{m}月{d}日 周{w}": "{w}, {m}/{d}",
  "{m}月": "{m}/",
  "总题数": "Total",
  "已学习": "Learned",
  "待复习": "Due",
  "待学习": "New",
  "开始复习": "Review",
  "题库": "Question bank",
  "学习记录": "Activity",
  "没有复习记录": "No reviews on this day",
  "学习新卡片 {a} 张 · 复习旧卡片 {b} 张": "New: {a} · Review: {b}",
  "答对 {a} · 答错 {b}": "Correct: {a} · Wrong: {b}",
  "正确率 {p}%": "{p}% correct",
  "{d} · 复习 {n} 题": "{d} · {n} reviewed",

  /* —— 复习页 —— */
  "全库还没有可复习的 quiz(id 索引为空)。": "No questions to review yet (the id index is empty).",
  "第 {a} / {b} 题": "Q {a} / {b}",
  "新卡": "New",
  "复习": "Review",
  "(无题干)": "(no stem)",
  "下次复习:{t}": "Next: {t}",
  "复习完成": "Review complete",
  "共 {n} 题 · 答对 {a} · 答错 {b}": "Total: {n} · Correct: {a} · Wrong: {b}",
  "下一题": "Next",
  "完成": "Done",

  /* —— 题库页 —— */
  "显示收藏": "Favorites only",
  "还没有收藏。点题目右上角的星收藏。": "No favorites yet. Tap the star on a question to add one.",
  "还没有题目": "No questions yet",
  "正在扫描,列表可能不全;": "Scanning; list may be incomplete;",
  "共 {a} 题,已收藏 {b} 题": "{a} questions, {b} favorited",
  "找不到源题": "Source question missing",
  "按目录": "By folder",
  "分类": "Categories",
  "下次 {t}": "Next: {t}",
  "归类到…": "Categories…",
  "未分类": "Uncategorized",
  "已失效": "Missing",
  "新分类名…": "New category…",
  "创建": "Create",
  "删除分类": "Delete category",

  /* —— 设置页 —— */
  "作答": "Answering",
  "默认作答模式": "Default mode",
  "块内未写 mode 时生效": "Used when the block has no mode attribute",
  "即时判分(单选,快)": "Instant grading (single choice)",
  "先选后查(单选/多选)": "Select then submit (single/multiple)",
  "静态展示": "Static",
  "默认打乱选项": "Shuffle options",
  "块内未写 shuffle 时生效": "Used when the block has no shuffle attribute",
  "默认选项编号": "Option numbering",
  "块内未写 number 时生效": "Used when the block has no number attribute",
  "无": "None",
  "批改(先选后查)": "Grading (select then submit)",
  "提交按钮": "Submit button",
  "重置按钮": "Reset button",
  "批改并显示答案": "Grade and reveal the answer",
  "重置方式": "Reset mode",
  "自动:切页自动重置;手动:保留到按重置": "Auto: reset on tab switch; Manual: keep until reset",
  "自动重置": "Auto",
  "手动重置": "Manual",
  "批改后显示重置按钮": "Show reset button after grading",
  "自动重置下可关;手动重置恒显示": "Optional in auto mode; always shown in manual",
  "批改文案(测试)": "Verdict text (advanced)",
  "判对文案": "Correct text",
  "支持占位符 {ans}=正确答案 {pick}=你的选择": "Placeholders: {ans} = answer, {pick} = your pick",
  "判错文案": "Wrong text",
  "同上;空占位符会被剔除": "Same placeholders; empty ones are dropped",
  "题目 ID": "Question IDs",
  "自动分配": "Auto assign",
  "自动给没有 id 的题分配 id": "Assign ids to questions without one",
  "手动": "Manual",
  "自动": "Auto",
  "id 码长": "ID length",
  "只影响新分配的 id": "Only affects newly assigned ids",
  "全库重新编号": "Renumber all",
  "全部题目重新编号,引用自动同步": "Renumber every question; references update automatically",
  "重新编号": "Renumber",
  "将重写全部题目 id,确认?": "This rewrites all question ids. Continue?",
  "重新编号屏蔽目录": "Excluded paths",
  "每行一个路径(目录或单文件),重新编号时跳过": "One path per line (folder or file); skipped when renumbering",
  "按钮外观(测试)": "Button appearance (advanced)",
  "强调色混合": "Accent mix",
  "强调色掺入背景的比例,%越大越浓": "How much accent mixes into the background",
  "悬停幅度": "Hover shift",
  "负=变暗,正=变亮;0=不变": "Negative darkens, positive brightens; 0 = off",
  "字色": "Text color",
  "自动 = 深色主题近白/浅色主题近黑;反自动相反": "Auto = near-white on dark themes, near-black on light; Anti = the reverse",
  "反自动": "Anti",
  "白": "White",
  "黑": "Black",
  "字重": "Font weight",
  "按钮文字加粗与否": "Bold button text",
  "加粗": "Bold",
  "常规": "Regular",
  "交换两按钮配置": "Swap button styles",
  "提交与重置按钮的外观互换": "Swap the submit/reset appearance",
  "交换": "Swap",
  "收藏按钮": "Favorite button",
  "按钮尺寸": "Button size",
  "按钮边长(px),图标随之缩放": "Edge length in px; icon scales accordingly",
  "编辑视图 · 横向微调": "Edit view · horizontal offset",
  "在动态读位基础上再偏移(px,可负)": "Extra horizontal offset in px (may be negative)",
  "阅读视图 · 横向微调": "Reading view · horizontal offset",
  "距右缘额外偏移(px,可负)": "Extra offset from the right edge (may be negative)",
  "阅读视图 · 纵向微调": "Reading view · vertical offset",
  "距顶额外偏移(px,可负)": "Extra offset from the top (may be negative)",
  "其他": "Other",
  "绑定默认保留题干": "Keep stem on bind",
  "bind 默认保留题干": "Bound blocks keep the stem by default",
  "调试日志": "Debug log",
  "控制台(过滤 bqb)输出插件事件;排查用": "Log plugin events to the console (filter: bqb)",
};

// 取词:非中文环境查表,带 {x} 占位替换;漏译回落中文原文。
export function t(key, params) {
  let s = (!isZh && EN[key]) || key;
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.split("{" + k + "}").join(String(params[k]));
    }
  }
  return s;
}
