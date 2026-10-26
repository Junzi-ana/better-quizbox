/* Better Quiz Box — 解析层(纯函数,无状态、无 DOM)
 * 负责:块属性注释解析 / quiz 源文本解析 / 顺序与配对辅助
 */

/* ------------------------------ 块属性(指令) -------------------------------- */

export const ATTR_KEYS = ["mode", "shuffle", "number", "id", "bind", "copy", "stem", "submit", "reset", "answer-paras"];
// 键名允许连字符(如 answer-paras)
const ATTR_PAIR_RE = /([A-Za-z][A-Za-z-]*)\s*[:=]\s*([^,;\n]*)/g;

// 解析一整条 HTML 注释指令:返回 [{key,val}, ...]
// 支持一行内多条,用逗号/分号/换行分隔,如 <!-- mode: static, number: abc -->
// 只识别 ATTR_KEYS 中的键;其它注释行原样保留(返回 [])
export function parseAttrComment(line) {
  const m = /^<!--([\s\S]*?)-->$/.exec(line.trim());
  if (!m) return [];
  const out = [];
  let mm;
  ATTR_PAIR_RE.lastIndex = 0;
  while ((mm = ATTR_PAIR_RE.exec(m[1])) !== null) {
    const key = mm[1].toLowerCase();
    if (ATTR_KEYS.includes(key)) {
      out.push({ key, val: mm[2].trim() });
    }
  }
  return out;
}

export function normalizeModeToken(v) {
  const t = v.toLowerCase().replace(/[\s_]+/g, "");
  if (t === "static") return "static";
  if (t === "nonimmediate" || t === "non-immediate") return "non-immediate";
  return "immediate";
}

export function normalizeBoolToken(v) {
  const t = v.toLowerCase();
  if (["off", "false", "no", "0"].includes(t)) return false;
  if (["on", "true", "yes", "1"].includes(t)) return true;
  return null;
}

export function normalizeNumberToken(v) {
  const t = v.toLowerCase().replace(/[\s_]+/g, "");
  // 显式 none:与"未设置"(null)区分,可在设置定了缺省编号后单独关掉
  if (t === "none") return "none";
  if (["abc", "alpha", "letters", "letter"].includes(t)) return "abc";
  if (["123", "number", "numeric", "digits", "num", "numbers"].includes(t)) return "123";
  return null;
}

// 块外解析读几段:正整数才认,其余(空/0/负数/胡写)返回 null → 按默认 1 段
export function normalizeCountToken(v) {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 重置方式: auto(切页重渲染即重置) / manual(批改状态保留直到按重置按钮);非法值返回 null(视为未设置)
export function normalizeResetToken(v) {
  const t = v.toLowerCase().replace(/[\s_]+/g, "");
  if (t === "manual") return "manual";
  if (t === "auto") return "auto";
  return null;
}

// bind/copy 引用值的合法性:4..10 位 base36 id,可带 -N 同文件序号后缀;合法返回规范化值
export function normalizeRefToken(v) {
  const t = v.trim().toLowerCase();
  return /^[a-z0-9]{4,10}(?:-\d+)?$/.test(t) ? t : null;
}

/* ---------------------------------- 解析 ---------------------------------- */

// 选项行: [ ] 未选  [c] 正确(源码遗留的 [w]/[r] 一律按未选处理)
const OPTION_RE = /^\[([ crw])\] (.*)$/;
// 结尾说明标记行
const HINT_RE = /^\[h\]\s?(.*)$/;

export function trimBlankEdges(lines) {
  let s = 0;
  while (s < lines.length && lines[s].trim() === "") s++;
  let e = lines.length - 1;
  while (e >= s && lines[e].trim() === "") e--;
  return s <= e ? lines.slice(s, e + 1) : [];
}

export function parseQuiz(source) {
  const raw = source.split("\n");
  const attrs = { mode: null, shuffle: null, number: null, id: null, binding: null, stem: null, submit: null, reset: null, answerParas: null };
  const content = [];
  for (const line of raw) {
    const attrsList = parseAttrComment(line);
    if (attrsList.length) {
      // 每个属性首个生效;属性注释行一律不进入内容
      for (const a of attrsList) {
        if (a.key === "bind" || a.key === "copy") {
          // bind/copy:值为目标 id 引用;只认合法格式;非法值不占用"首个生效"。
          // 两者互斥,全块第一个合法的出现胜出,其余(bind/copy 混用/多个 id)忽略。
          const legal = normalizeRefToken(a.val);
          if (legal && !attrs.binding) attrs.binding = { type: a.key, target: legal };
          continue;
        }
        if (a.val === "") continue; // 空值不占用"首个生效",后续同名属性仍可生效
        const key = a.key === "answer-paras" ? "answerParas" : a.key; // 连字符键 → 字段名
        if (attrs[key] !== null) continue;
        if (key === "mode") attrs.mode = normalizeModeToken(a.val);
        else if (key === "shuffle") attrs.shuffle = normalizeBoolToken(a.val);
        else if (key === "number") attrs.number = normalizeNumberToken(a.val);
        else if (key === "stem") attrs.stem = normalizeBoolToken(a.val);
        else if (key === "submit") attrs.submit = normalizeBoolToken(a.val);
        else if (key === "reset") attrs.reset = normalizeResetToken(a.val);
        else if (key === "answerParas") attrs.answerParas = normalizeCountToken(a.val);
        else attrs[key] = a.val;
      }
      continue;
    }
    content.push(line);
  }
  // mode 未设置时保持 null,由处理器按插件设置填充缺省(块属性显式给出的仍在此解析)

  const optMeta = []; // { i: content 行号, state, first }
  content.forEach((line, i) => {
    const m = OPTION_RE.exec(line);
    if (m) {
      optMeta.push({
        i,
        state: m[1] === "c" ? "c" : " ",
        first: m[2] != null ? m[2] : ""
      });
    }
  });

  if (optMeta.length === 0) {
    return {
      question: trimBlankEdges(content).join("\n"),
      options: [],
      details: undefined,
      attrs
    };
  }

  const question = trimBlankEdges(content.slice(0, optMeta[0].i)).join("\n");

  const optionRows = [];
  let details;
  for (let k = 0; k < optMeta.length; k++) {
    const meta = optMeta[k];
    const start = meta.i + 1;
    const end = k + 1 < optMeta.length ? optMeta[k + 1].i : content.length;
    const seg = content.slice(start, end);
    const textLines = [meta.first];
    if (k === optMeta.length - 1) {
      // 尾部:[h] 之前的文本(含空行/顶格)并入末选项;[h] 之后为解析/说明
      const hIdx = seg.findIndex((ln) => HINT_RE.test(ln));
      if (hIdx >= 0) {
        textLines.push(...seg.slice(0, hIdx));
        const after = seg.slice(hIdx);
        const firstRest = after[0].replace(/^\[h\]\s?/, "");
        const detailLines = [];
        if (firstRest.trim() !== "") detailLines.push(firstRest);
        detailLines.push(...after.slice(1));
        const det = trimBlankEdges(detailLines).join("\n");
        if (det.trim() !== "") details = det;
      } else {
        // 无 [h]:末选项后的换行文本属于末选项本身(提示必须显式 [h] 才存在)
        textLines.push(...seg);
      }
    } else {
      // 中间段(到下一个选项标记为止):非选项行均为上一选项的续行
      textLines.push(...seg);
    }
    optionRows.push({
      state: meta.state,
      text: textLines.join("\n").trimEnd()
    });
  }

  const seen = new Set();
  const options = optionRows.filter((o) => {
    const key = o.text.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // optIdx:选项在去重后列表中的序号(0..n-1)。它是与源码行号无关的稳定坐标，
  // 正面(含题干)与背面(无题干)的同一选项共享同一 optIdx,绑定/重排才可靠。
  options.forEach((o, i) => {
    o.optIdx = i;
  });

  return { question, options, details, attrs };
}

/* ---------------------------- 块外解析(题目下方的解析正文) ---------------------------- */

// 遇到这些行就停:下一块(任意围栏)、标题、分隔线(即下一题/下一节的开头)、
// 整行 HTML 注释(块属性、Spaced Repetition 的 <!--SR:...--> 之类,不算解析)
function isAnswerStopLine(line) {
  const s = line.trim();
  return s.startsWith("```") || s.startsWith("<!--") || /^#{1,6}\s/.test(s) || /^(?:-{3,}|\*{3,}|_{3,})$/.test(s);
}

// 读题目块正下方的解析:段 = 由空行分隔的连续非空行;paras 段收满即停(默认 1 段)。
// fenceEnd 为闭合围栏行号(0 基)。返回 Markdown 文本,没有内容返回 ""。
// 注意:这是"解析"(answer),与块内的 [h] 提示(details)是两回事,互不覆盖。
export function extractAnswer(lines, fenceEnd, paras = 1) {
  const want = Math.max(1, Math.floor(paras) || 1);
  let i = fenceEnd + 1;
  while (i < lines.length && lines[i].trim() === "") i++; // 跳过紧贴围栏的空行
  const got = [];
  let stop = false;
  while (i < lines.length && got.length < want && !stop) {
    if (isAnswerStopLine(lines[i])) break;
    const buf = [];
    while (i < lines.length && lines[i].trim() !== "") {
      // 段中途撞上下一块/标题/分隔线也停(中间没空行时,`---` 会被当成上文的标题下划线)
      if (isAnswerStopLine(lines[i])) { stop = true; break; }
      buf.push(lines[i]);
      i++;
    }
    if (buf.length) got.push(buf.join("\n"));
    while (i < lines.length && lines[i].trim() === "") i++; // 段间可能不止一个空行
  }
  return got.join("\n\n");
}

/* ------------------------------ 顺序/配对辅助 -------------------------------- */

export function sourceOrder(options) {
  return options.map((o) => o.optIdx);
}

export function randomOrder(options) {
  const arr = sourceOrder(options);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
