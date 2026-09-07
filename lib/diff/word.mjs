// Port of delta's align.rs and tokenization/annotation from edits.rs.
// Copyright 2020 Dan Davison. MIT; see THIRD_PARTY_NOTICES.md.
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export function tokenize(line) {
  const tokens = [""];
  let offset = 0;
  for (const m of line.matchAll(/[\p{L}\p{M}\p{N}\p{Pc}\u200c\u200d]+/gu)) {
    if (offset === 0 && m.index > 0) tokens.push("");
    tokens.push(
      ...Array.from(segmenter.segment(line.slice(offset, m.index)), (x) => x.segment),
      m[0],
    );
    offset = m.index + m[0].length;
  }
  if (offset < line.length) {
    if (offset === 0) tokens.push("");
    tokens.push(...Array.from(segmenter.segment(line.slice(offset)), (x) => x.segment));
  }
  return tokens;
}
export function alignTokens(x, y) {
  const w = x.length + 1,
    h = y.length + 1;
  // Bound pathological long-line work; callers degrade to line highlighting.
  if (w * h > 1000000) return null;
  const cost = new Uint32Array(w * h),
    parent = new Uint32Array(w * h),
    op = new Uint8Array(w * h);
  for (let i = 1; i < w; i++) {
    cost[i] = i * 2 + 1;
    op[i] = 1;
  }
  for (let j = 1; j < h; j++) {
    cost[j * w] = j * 2 + 1;
    op[j * w] = 2;
  }
  for (let i = 0; i < x.length; i++)
    for (let j = 0; j < y.length; j++) {
      const left = (j + 1) * w + i,
        up = j * w + i + 1,
        diag = j * w + i,
        idx = (j + 1) * w + i + 1;
      // Delta tie order: insertion, deletion, then equal. Gap-open penalty = 1.
      let c = cost[up] + 2 + (op[up] === 0 ? 1 : 0),
        p = up,
        o = 2;
      const del = cost[left] + 2 + (op[left] === 0 ? 1 : 0);
      if (del < c) {
        c = del;
        p = left;
        o = 1;
      }
      if (x[i] === y[j] && cost[diag] < c) {
        c = cost[diag];
        p = diag;
        o = 0;
      }
      cost[idx] = c;
      parent[idx] = p;
      op[idx] = o;
    }
  const ops = [];
  let pos = w * h - 1;
  while (true) {
    ops.push(op[pos]);
    if (parent[pos] === 0) break;
    pos = parent[pos];
  }
  return ops.reverse();
}
export function wordDiff(before, after) {
  const x = tokenize(before),
    y = tokenize(after),
    ops = alignTokens(x, y);
  if (!ops)
    return {
      before: [{ text: before, changed: false }],
      after: [{ text: after, changed: false }],
      distance: 1,
    };
  const a = [],
    b = [];
  let xi = 0,
    yi = 0,
    numer = 0,
    denom = 0,
    prevA = false,
    prevB = false;
  // Display-width distance is exact for ASCII code. Non-ASCII uses grapheme count.
  const width = (s) => Array.from(segmenter.segment(s.trim())).length;
  for (let i = 0; i < ops.length;) {
    const o = ops[i];
    let n = 1;
    while (ops[i + n] === o) n++;
    if (o === 1) {
      const text = x.slice(xi, xi + n).join("");
      xi += n;
      a.push({ text, changed: true });
      numer += width(text);
      denom += width(text);
      prevA = true;
    } else if (o === 2) {
      const text = y.slice(yi, yi + n).join("");
      yi += n;
      b.push({ text, changed: true });
      numer += width(text);
      denom += width(text);
      prevB = true;
    } else {
      const text = x.slice(xi, xi + n).join("");
      xi += n;
      const coalesce =
        !text.trim() &&
        ((prevA && prevB && (xi < x.length - 1 || yi < y.length - 1)) || (!prevA && !prevB));
      a.push({ text, changed: coalesce ? prevA : false });
      b.push({
        text: y.slice(yi, yi + n).join(""),
        changed: coalesce ? prevB : false,
      });
      yi += n;
      denom += 2 * width(text);
      prevA = false;
      prevB = false;
    }
    i += n;
  }
  return { before: a, after: b, distance: denom ? numer / denom : 0 };
}
