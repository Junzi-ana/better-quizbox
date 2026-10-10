/* Better Quiz Box — 自动 id 分配(计数器,内容无关)
 *
 * id = 文件名 hash 前缀 + 块号,码长可调(3..9):
 *   hash 位 = ceil(码长/2)(奇数多一位给 hash),块号位 = floor(码长/2)(定长,超位自然变长)
 *   例:码长 7 → hash 4 位 + 块号 3 位(如 a3f0 042);码长 6 → hash 3 + 块 3。
 * 稳定性铁律:
 *   - id 一旦分配永不改写(内容怎么编辑都不动)→ 引用永不变更 → 无传播改写、无 defer、无别名
 *   - 只给"没有 id 行的 quiz 块"分配;同文件新块接着该文件已用过的最大号续编
 *
 * 注意:改"码长"只影响之后新分配的块;已分配 id 的块无论长度如何一律不动(铁律)。
 */

import { parseQuiz } from "./parse.mjs";

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

// 码长 → hash 位(ceil 一半,奇数多给 hash);块号位 = 码长 - hash 位
export function hashLenOf(codeLen) {
  return Math.ceil(codeLen / 2);
}

// 文件路径 → base36 hash 全值(定长 13 位),截取 hashLen 位作前缀;同一文件同一长度前缀稳定
export function fileIdOf(filePath, hashLen) {
  let h = 0x811c9dc5;
  const s = String(filePath || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const full = h.toString(36).padStart(13, "0");
  return full.slice(0, hashLen);
}

// 块号格式化:定长 numLen 位(0..10^numLen-1);超位自然变长
function blockNum(n, numLen) {
  return n < 10 ** numLen ? String(n).padStart(numLen, "0") : String(n);
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
function replaceIdValue(line, newId) {
  return line.replace(/\b(id\s*[:=]\s*)([^,;\n]*?)(?=\s*--\s*>|[;,]|\s*$)/, (m, p1) => p1 + newId);
}

/**
 * 给文本里"没有 id 的 quiz 块"分配计数器 id。已有 id 的块(铁律)一律不动。
 * @param text     文件全文
 * @param fileId   文件 hash 前缀(fileIdOf,hashLen 按 codeLen)
 * @param usedNums 该文件已占用的块号 Set<number>(来自索引)
 * @param takenIds 全库已在册的全部 id Set<string>(全库唯一防线:hash 前缀冲突时块号错开)
 * @param codeLen  码长(3..9);hash 位=ceil/2,块号位=floor/2
 * @returns { text, changed, added }
 */
export function assignCounterIds(text, fileId, usedNums, takenIds, codeLen) {
  const numLen = codeLen - hashLenOf(codeLen);
  const lines = text.split("\n");
  const blocks = scanQuizBlocks(text);
  let max = -1; // 空文件首号 = 0(块号定长 numLen 位)
  if (usedNums) for (const n of usedNums) if (n > max) max = n;
  let changed = false;
  let added = 0;

  for (const b of blocks) {
    const parsed = parseQuiz(b.source);
    if (!parsed.options.length) continue;        // 无选项的块不参与
    if (parsed.attrs.binding) continue;          // bind/copy 块不分配 id
    if (findIdAttrLine(lines, b.start, b.end) >= 0) continue; // 已有 id,永不动
    let n = max + 1;
    while (
      (usedNums && usedNums.has(n)) ||
      (takenIds && takenIds.has(fileId + blockNum(n, numLen)))
    ) n++;                                        // 跳过被占用/全库已被别的文件占走的号
    max = n;
    const pos = b.start + 1;
    lines.splice(pos, 0, "<!-- id: " + fileId + blockNum(n, numLen) + " -->");
    // 插入行后,后续块 start/end 右移,保持后续定位正确
    for (const bb of blocks) {
      if (bb.start >= pos) { bb.start++; bb.end++; }
    }
    changed = true;
    added++;
  }
  return { text: changed ? lines.join("\n") : text, changed, added };
}

/* ---------------- 以下仅供"全库重新编号"按钮使用(按需破坏性重建) ---------------- */

// 按文件重排所有块 id:连续重编(忽略旧号)。
// takenIds:全库已在册 id 集合(调用方跨文件共享并累积)——hash 前缀与他文件相同时跳过其号,
// 防止跨文件撞出重复 id;新分配的号也登记进去。
export function renumberFile(text, fileId, codeLen, takenIds) {
  const numLen = codeLen - hashLenOf(codeLen);
  const lines = text.split("\n");
  const blocks = scanQuizBlocks(text);
  // 先算每块原有的 id 行行号(此时行号是原文本的;后续插入会波及后续块)
  const idLines = blocks.map((b) => findIdAttrLine(lines, b.start, b.end));
  let changed = false;
  let count = 0;
  for (let bi = 0; bi < blocks.length; bi++) {
    const parsed = parseQuiz(blocks[bi].source);
    if (!parsed.options.length || parsed.attrs.binding) continue; // 不参与的块不动
    const idLine = idLines[bi];
    let n = 0;
    while (takenIds && takenIds.has(fileId + blockNum(n, numLen))) n++;
    const id = fileId + blockNum(n, numLen);
    if (takenIds) takenIds.add(id);
    if (idLine >= 0) {
      const pm = /\bid\s*[:=]\s*([^,;\n]*?)(?=\s*--\s*>|[;,]|\s*$)/.exec(lines[idLine]);
      const oldVal = pm ? pm[1].trim() : "";
      if (oldVal !== id) {
        lines[idLine] = replaceIdValue(lines[idLine], id);
        changed = true;
        count++;
      }
    } else {
      const pos = blocks[bi].start + 1;
      lines.splice(pos, 0, "<!-- id: " + id + " -->");
      for (let bj = bi + 1; bj < blocks.length; bj++) {
        blocks[bj].start++;
        blocks[bj].end++;
        if (idLines[bj] >= pos) idLines[bj]++;
      }
      changed = true;
      count++;
    }
  }
  return { text: changed ? lines.join("\n") : text, changed, count };
}

// 重编号映射收集:旧 id → 新 id(仅重编号按钮用;按出现序配对)
export function collectIdMap(oldText, newText) {
  const map = new Map();
  const collect = (t, out) => {
    for (const b of scanQuizBlocks(t)) {
      const p = parseQuiz(b.source);
      if (p.attrs.binding || !p.options.length || !p.attrs.id) continue;
      out.push(p.attrs.id);
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

// 只改引用行里的值;幂等:不涉及的旧值零改动。兼容旧数据的 -N 后缀(改写保留后缀)。
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