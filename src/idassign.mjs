/* Better Quiz Box — 自动 id 分配(内容派生)
 * 提供两件武器:
 *   1. scanQuizBlocks(text)  扫出一个 .md 文本里的所有 quiz 代码块(行区间 + 块源文本)
 *   2. applyAutoIds(text)    逐块计算内容派生 id 并写成 <!-- id: ... --> 行
 *      返回 { text, changed, blockChanges }:无变化时返回原引用,调用方据此决定是否写盘。
 *
 * id 语义(见 parse.mjs 的 contentId):由选项内容唯一决定 → 内容没变 id 不变,选项变了 id 才变。
 * 同一文件内重复内容的块按出现序加 -2/-3 后缀,保证文件内唯一。
 * 幂等:对已打好 id 的文本再跑一遍零改动(防 modify 事件循环)。
 */

import { parseQuiz, signature, fullSignature, contentId } from "./parse.mjs";

const FENCE_OPEN_RE = /^```[ \t]*quiz[ \t]*$/i;
const FENCE_CLOSE_RE = /^```[ \t]*$/;

// 扫描文本里的 quiz 围栏块;start/end 为行号(0 基),end 是闭合围栏行(未闭合则为 lines.length)
export function scanQuizBlocks(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!FENCE_OPEN_RE.test(lines[i])) { i++; continue; }
    let j = i + 1;
    while (j < lines.length && !FENCE_CLOSE_RE.test(lines[j])) j++;
    out.push({ start: i, end: j, source: lines.slice(i + 1, j).join("\n") });
    i = j + 1;
  }
  return out;
}

// 找块内(不含围栏行)第一个 id 属性行的行号;没有则 -1
function findIdAttrLine(lines, start, end) {
  for (let i = start + 1; i < end; i++) {
    const m = /^\s*<!--([\s\S]*?)-->\s*$/.exec(lines[i]);
    if (m && /(^|[\s,;])id\s*[:=]/.test(m[1])) return i;
  }
  return -1;
}

// 只替换行内 id 的值,保留同行其他属性与结尾 "-->"
// 值段懒惰匹配,前瞻在 -->/分号/逗号/行尾前停下(两种行形皆可: <!-- id: x --> 和 <!-- id: x, mode: static -->)
function replaceIdValue(line, newId) {
	return line.replace(/\b(id\s*[:=]\s*)([^,;\n]*?)(?=\s*--\s*>|[;,]|\s*$)/, (m, p1) => p1 + newId);
}

// 对文本应用自动 id;倒序处理块,插入行不影响前方块的行号
// bits 为 id 位数(4..10);对绑定/拷贝块(idindex 会另行补键)不分配 id
export function applyAutoIds(text, bits = 7) {
  const lines = text.split("\n");
  const blocks = scanQuizBlocks(text);
  const useCount = new Map(); // sig -> 该文件内已出现次数(同内容块 ->2/-3)
  let changed = false;
  let blockChanges = 0;

  for (let k = blocks.length - 1; k >= 0; k--) {
    const b = blocks[k];
    const parsed = parseQuiz(b.source);
    if (!parsed.options.length) continue; // 无选项的块不参与 id 分配
    if (parsed.attrs.binding) continue;   // bind/copy 块由 idindex 处理,不给它分配 id
    const sig = fullSignature(parsed.question, parsed.options);
    const nth = useCount.get(sig) || 0;
    useCount.set(sig, nth + 1);
    const id = nth === 0 ? contentId(sig, bits) : contentId(sig, bits) + "-" + (nth + 1);

    const idLine = findIdAttrLine(lines, b.start, b.end);
    if (idLine >= 0) {
      // 提取旧值与替换用同一套终止规则(懒惰+前瞻),保证幂等:oldVal===id 时零改动
      const pm = /\bid\s*[:=]\s*([^,;\n]*?)(?=\s*--\s*>|[;,]|\s*$)/.exec(lines[idLine]);
      const oldVal = pm ? pm[1].trim() : "";
      if (oldVal !== id) {
        lines[idLine] = replaceIdValue(lines[idLine], id);
        changed = true;
        blockChanges++;
      }
    } else {
      lines.splice(b.start + 1, 0, "<!-- id: " + id + " -->");
      changed = true;
      blockChanges++;
    }
  }
  return { text: changed ? lines.join("\n") : text, changed, blockChanges };
}

// 按文件内题目块的出现顺序,配对"旧文本的 id"与"新文本的 id",输出 base 级映射。
// 用 parseQuiz 正经解析(id 行可在块内任意位置,不依赖 "```quiz 后紧跟 id" 的文本形状)。
// 块数对不上(插入/删除)时返回空 map(放弃传播,宁可悬挂也不误改)。
export function collectIdMap(oldText, newText) {
  const map = new Map();
  const collect = (t, out) => {
    for (const b of scanQuizBlocks(t)) {
      const p = parseQuiz(b.source);
      if (p.attrs.binding || !p.options.length || !p.attrs.id) continue;
      out.push(baseStrip(p.attrs.id));
    }
  };
  const before = [];
  collect(oldText, before);
  const after = [];
  collect(newText, after);
  if (!before.length || before.length !== after.length) return map;
  for (let i = 0; i < before.length; i++) {
    if (before[i] && after[i] && before[i] !== after[i] && !map.has(before[i])) map.set(before[i], after[i]);
  }
  return map;
}

function baseStrip(s) {
  return s ? s.replace(/-\d+$/, "") : s;
}
// 只改引用行里的值,一行可含多个属性;其它行形(含多行注释、普通文本)不动。
// 值形如 <base> 或 <base>-N(<N> 为同文件序号),改写保留其后缀。
// 幂等:不涉及的旧值零改动。
export function rewriteRefsInText(text, map) {
  if (!map || !map.size) return { text, changed: false };
  const lines = text.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (!/\b(bind|copy)\s*[:=]/i.test(lines[i])) continue;
    const replaced = lines[i].replace(
      /\b(bind|copy)(\s*[:=]\s*)([a-z0-9]+(?:-\d+)?)(?=\s*--\s*>|[;,]|\s*$)/gi,
      (whole, kw, sep, val) => {
        const m = /^([a-z0-9]+)((?:-\d+)?)$/.exec(val);
        const nb = m && map.get(m[1]);
        if (!nb) return whole;
        return kw + sep + nb + (m[2] || "");
      }
    );
    if (replaced !== lines[i]) {
      lines[i] = replaced;
      changed = true;
    }
  }
  return { text: changed ? lines.join("\n") : text, changed };
}
