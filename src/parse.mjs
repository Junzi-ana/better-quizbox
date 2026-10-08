/* Better Quiz Box — 解析层(纯函数,无状态、无 DOM)
 * 负责:块属性注释解析 / quiz 源文本解析 / 顺序与配对辅助
 */

/* ------------------------------ 块属性(指令) -------------------------------- */

export const ATTR_KEYS = ["mode", "shuffle", "number", "id", "bind", "copy", "stem"];
const ATTR_PAIR_RE = /([A-Za-z]+)\s*[:=]\s*([^,;\n]*)/g;

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
  const attrs = { mode: null, shuffle: null, number: null, id: null, binding: null, stem: null };
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
        if (attrs[a.key] !== null) continue;
        if (a.key === "mode") attrs.mode = normalizeModeToken(a.val);
        else if (a.key === "shuffle") attrs.shuffle = normalizeBoolToken(a.val);
        else if (a.key === "number") attrs.number = normalizeNumberToken(a.val);
        else if (a.key === "stem") attrs.stem = normalizeBoolToken(a.val);
        else attrs[a.key] = a.val;
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
        // 无 [h]:保持旧规则,整段尾部视为解析/说明
        const det = trimBlankEdges(seg).join("\n");
        if (det.trim() !== "") details = det;
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

// 用于"同文件自动配对":选项文本 + 正确标记(忽略顺序)
export function signature(options) {
  return options
    .map((o) => o.state + "\u0001" + o.text.trim().toLowerCase().replace(/\s+/g, " "))
    .sort()
    .join("\u0002");
}

// 整题签名:题干 + 选项(均为 parse 剥离 HTML 注释后的内容,天然不含标记)
export function fullSignature(question, options) {
  const q = question.trim().toLowerCase().replace(/\s+/g, " ");
  return q + "\u0002" + signature(options);
}

/* ------------------------------ 自动 id(内容派生) ---------------------------- */
// id = base36(0-9a-z,不分大小写) 的整题摘要,位数可调(设置 4..10,缺省 7):
// 签名 = 题干 + 选项(parse 已剥离 HTML 注释行,天然不含标记),同一道题在任意文件/顺序下 id 相同。
// 7 位时 36^7 ≈ 7.8e10 空间;同文件内偶发相同时由 idassign 加 -2/-3 后缀兜底。

// FNV-1a 32 位,双种子各管哈希的一半
function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// 内容签名 → 稳定 id(纯函数,同步);bits 为 id 位数(4..10)
export function contentId(sig, bits = 7) {
  const a = fnv1a(sig, 0x811c9dc5);
  const b = fnv1a(sig, 0x1e17d5c0);
  const n = (BigInt(a) << 32n) | BigInt(b);
  // 2^64 在 base36 至多 13 位;补齐后取前 bits 位
  return n.toString(36).padStart(13, "0").slice(0, bits);
}

// 整题内容签名:见上方 fullSignature(题干 + 选项)
