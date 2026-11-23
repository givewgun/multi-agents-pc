import { runCases } from './tasks.js';

function extractCode(text) {
  const m = /```(?:js|javascript)?\s*([\s\S]*?)```/i.exec(text);
  return (m ? m[1] : text).trim();
}

const DIRECT = 'Answer directly from the information below. Do not use any tools, files, or shell commands.\n\n';
const FOOTER = '\nReply with only the code in one ```js block.';

function gradeCases(text, cases) {
  const code = extractCode(text);
  if (/\beval\s*\(|\bFunction\s*\(/.test(code)) {
    return { pass: false, score: 0, why: 'used eval/Function' };
  }
  try {
    const out = runCases(code, cases.map((c) => c.expr));
    let passed = 0;
    const fails = [];
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const r = out[i];
      const ok = c.throws
        ? !r.ok && !/\bis not defined\b/.test(r.error || '')
        : r.ok && JSON.stringify(r.value) === JSON.stringify(c.want);
      if (ok) passed++;
      else if (fails.length < 3) fails.push(c.label);
    }
    const score = passed / cases.length;
    return {
      pass: score === 1,
      score,
      why: fails.length ? `failed: ${fails.join(', ')}` : '',
    };
  } catch (e) {
    return { pass: false, score: 0, why: `code error: ${e.message}` };
  }
}

const SEMVER_REF = `function satisfies(version, range) {
  function parseVer(s) {
    const m = /^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$/.exec(s.trim());
    if (!m) throw new Error('Invalid version: ' + s);
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      pre: m[4] ? m[4].split('.') : [],
    };
  }
  function cmpPre(a, b) {
    if (!a.length && !b.length) return 0;
    if (!a.length) return 1;
    if (!b.length) return -1;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const an = /^\\d+$/.test(a[i]);
      const bn = /^\\d+$/.test(b[i]);
      if (an && bn) {
        const d = Number(a[i]) - Number(b[i]);
        if (d !== 0) return d > 0 ? 1 : -1;
      } else if (an !== bn) {
        return an ? -1 : 1;
      } else if (a[i] !== b[i]) {
        return a[i] < b[i] ? -1 : 1;
      }
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  }
  function cmpVer(a, b) {
    if (a.major !== b.major) return a.major > b.major ? 1 : -1;
    if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
    if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
    return cmpPre(a.pre, b.pre);
  }
  function expandComparator(tok) {
    const m = /^(>=|<=|>|<|=|\\^|~)?(.+)$/.exec(tok);
    if (!m) return [];
    const op = m[1] || '';
    const body = m[2];
    const dash = body.indexOf('-');
    const core = dash === -1 ? body : body.slice(0, dash);
    const preStr = dash === -1 ? '' : body.slice(dash + 1);
    const parts = core.split('.');
    const isX = (p) => p === undefined || p === 'x' || p === 'X' || p === '*';
    const M = isX(parts[0]) ? null : Number(parts[0]);
    const mi = isX(parts[1]) ? null : Number(parts[1]);
    const pa = isX(parts[2]) ? null : Number(parts[2]);
    const pre = preStr ? preStr.split('.') : [];
    const v = (major, minor, patch, pr = []) => ({ major, minor, patch, pre: pr });
    if (M === null) {
      if (op === '>' || op === '<') return [{ op: '<', ver: v(0, 0, 0) }];
      return [{ op: '>=', ver: v(0, 0, 0) }];
    }
    if (!op || op === '=') {
      if (mi === null) return [{ op: '>=', ver: v(M, 0, 0) }, { op: '<', ver: v(M + 1, 0, 0) }];
      if (pa === null) return [{ op: '>=', ver: v(M, mi, 0) }, { op: '<', ver: v(M, mi + 1, 0) }];
      return [{ op: '=', ver: v(M, mi, pa, pre) }];
    }
    if (op === '^') {
      const lower = v(M, mi ?? 0, pa ?? 0, pre);
      let upper;
      if (M > 0) upper = v(M + 1, 0, 0);
      else if (mi === null) upper = v(1, 0, 0);
      else if (mi > 0) upper = v(0, mi + 1, 0);
      else if (pa === null) upper = v(0, 1, 0);
      else upper = v(0, 0, pa + 1);
      return [{ op: '>=', ver: lower }, { op: '<', ver: upper }];
    }
    if (op === '~') {
      const lower = v(M, mi ?? 0, pa ?? 0, pre);
      const upper = mi === null ? v(M + 1, 0, 0) : v(M, mi + 1, 0);
      return [{ op: '>=', ver: lower }, { op: '<', ver: upper }];
    }
    if (op === '>=' || op === '<') {
      return [{ op, ver: v(M, mi ?? 0, pa ?? 0, pre) }];
    }
    if (op === '<=') {
      if (mi === null) return [{ op: '<', ver: v(M + 1, 0, 0) }];
      if (pa === null) return [{ op: '<', ver: v(M, mi + 1, 0) }];
      return [{ op: '<=', ver: v(M, mi, pa, pre) }];
    }
    if (op === '>') {
      if (mi === null) return [{ op: '>=', ver: v(M + 1, 0, 0) }];
      if (pa === null) return [{ op: '>=', ver: v(M, mi + 1, 0) }];
      return [{ op: '>', ver: v(M, mi, pa, pre) }];
    }
    return [];
  }
  function checkOp(ver, comp) {
    const c = cmpVer(ver, comp.ver);
    if (comp.op === '=') return c === 0;
    if (comp.op === '>') return c > 0;
    if (comp.op === '>=') return c >= 0;
    if (comp.op === '<') return c < 0;
    if (comp.op === '<=') return c <= 0;
    return false;
  }
  const target = parseVer(version);
  const sets = range.split('||');
  for (const rawSet of sets) {
    const trimmed = rawSet.trim();
    if (trimmed === '') {
      if (target.pre.length === 0) return true;
      continue;
    }
    const tokens = trimmed.split(/\\s+/);
    const comps = [];
    for (const tok of tokens) comps.push(...expandComparator(tok));
    if (!comps.every((c) => checkOp(target, c))) continue;
    if (target.pre.length === 0) return true;
    const preOk = comps.some((c) =>
      c.ver.pre.length > 0 &&
      c.ver.major === target.major &&
      c.ver.minor === target.minor &&
      c.ver.patch === target.patch
    );
    if (preOk) return true;
  }
  return false;
}`;

const CSV_REF = `function parseCSV(text) {
  if (text === '') return [];
  const rows = [];
  let row = [];
  let field = '';
  let state = 0; // 0: start, 1: unquoted, 2: quoted, 3: afterQuote
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state === 0) {
      if (ch === '"') {
        state = 2;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\\r' && text[i + 1] === '\\n') {
        i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
        state = 1;
      }
    } else if (state === 1) {
      if (ch === '"') {
        throw new Error('Unexpected quote in unquoted field');
      } else if (ch === ',') {
        row.push(field);
        field = '';
        state = 0;
      } else if (ch === '\\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        state = 0;
      } else if (ch === '\\r' && text[i + 1] === '\\n') {
        i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        state = 0;
      } else {
        field += ch;
      }
    } else if (state === 2) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          state = 3;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === ',') {
        row.push(field);
        field = '';
        state = 0;
      } else if (ch === '\\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        state = 0;
      } else if (ch === '\\r' && text[i + 1] === '\\n') {
        i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        state = 0;
      } else {
        throw new Error('Unexpected character after closing quote');
      }
    }
  }
  if (state === 2) throw new Error('Unterminated quoted field');
  if (state !== 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}`;

const CRON_REF = `function nextRun(expr, fromIso) {
  if (typeof expr !== 'string' || typeof fromIso !== 'string') throw new Error('Invalid argument');
  const fromDate = new Date(fromIso);
  if (Number.isNaN(fromDate.getTime())) throw new Error('Invalid date');
  const parts = expr.trim().split(/\\s+/);
  if (parts.length !== 5) throw new Error('Invalid cron expression');

  function parseField(str, min, max, isDow) {
    const set = new Set();
    for (const item of str.split(',')) {
      const m = /^(\\*|\\d+-\\d+|\\d+)(?:\\/(\\d+))?$/.exec(item);
      if (!m) throw new Error('Malformed field: ' + item);
      let step = 1;
      if (m[2] !== undefined) {
        if (m[1] !== '*' && !m[1].includes('-')) throw new Error('Invalid stepped value: ' + item);
        step = Number(m[2]);
        if (!Number.isInteger(step) || step < 1) throw new Error('Invalid step: ' + item);
      }
      let start, end;
      if (m[1] === '*') {
        start = min;
        end = max;
      } else if (m[1].includes('-')) {
        const [a, b] = m[1].split('-').map(Number);
        if (a < min || b > max || a > b) throw new Error('Range out of bounds: ' + item);
        start = a;
        end = b;
      } else {
        const a = Number(m[1]);
        if (a < min || a > max) throw new Error('Value out of bounds: ' + item);
        start = a;
        end = a;
      }
      for (let v = start; v <= end; v += step) {
        set.add(isDow && v === 7 ? 0 : v);
      }
    }
    return set;
  }

  const mins = parseField(parts[0], 0, 59, false);
  const hours = parseField(parts[1], 0, 23, false);
  const doms = parseField(parts[2], 1, 31, false);
  const months = parseField(parts[3], 1, 12, false);
  const dows = parseField(parts[4], 0, 7, true);
  const domWild = parts[2] === '*';
  const dowWild = parts[4] === '*';

  function dayMatches(dom, dow) {
    if (!domWild && !dowWild) return doms.has(dom) || dows.has(dow);
    return doms.has(dom) && dows.has(dow);
  }

  const limitDate = new Date(fromDate.getTime());
  limitDate.setUTCFullYear(limitDate.getUTCFullYear() + 5);
  const limitMs = limitDate.getTime();

  let t = Math.floor(fromDate.getTime() / 60000) * 60000 + 60000;
  while (t <= limitMs) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    if (!months.has(mo + 1)) {
      t = Date.UTC(y, mo + 1, 1, 0, 0, 0, 0);
      continue;
    }
    const day = d.getUTCDate();
    if (!dayMatches(day, d.getUTCDay())) {
      t = Date.UTC(y, mo, day + 1, 0, 0, 0, 0);
      continue;
    }
    const hr = d.getUTCHours();
    if (!hours.has(hr)) {
      t = Date.UTC(y, mo, day, hr + 1, 0, 0, 0);
      continue;
    }
    if (!mins.has(d.getUTCMinutes())) {
      t += 60000;
      continue;
    }
    return d.toISOString();
  }
  throw new Error('No run found within 5 years');
}`;

const GLOB_REF = `function globMatch(pattern, path) {
  function expandBraces(pat) {
    let inClass = false;
    let open = -1;
    for (let i = 0; i < pat.length; i++) {
      const ch = pat[i];
      if (ch === '\\\\') { i++; continue; }
      if (inClass) {
        if (ch === ']') inClass = false;
        continue;
      }
      if (ch === '[') {
        inClass = true;
        if (pat[i + 1] === '!') i++;
        if (pat[i + 1] === ']') i++;
      } else if (ch === '{') {
        open = i;
        break;
      }
    }
    if (open === -1) return [pat];
    const parts = [];
    let cur = '';
    let close = -1;
    let cls = false;
    for (let i = open + 1; i < pat.length; i++) {
      const ch = pat[i];
      if (ch === '\\\\') {
        cur += ch + (pat[i + 1] ?? '');
        i++;
        continue;
      }
      if (cls) {
        cur += ch;
        if (ch === ']') cls = false;
        continue;
      }
      if (ch === '[') {
        cls = true;
        cur += ch;
      } else if (ch === ',') {
        parts.push(cur);
        cur = '';
      } else if (ch === '}') {
        parts.push(cur);
        close = i;
        break;
      } else {
        cur += ch;
      }
    }
    if (close === -1) return [pat];
    const prefix = pat.slice(0, open);
    const suffix = pat.slice(close + 1);
    const out = [];
    for (const alt of parts) {
      for (const rest of expandBraces(prefix + alt + suffix)) out.push(rest);
    }
    return out;
  }

  function tokenizeSeg(segPat) {
    const tokens = [];
    for (let i = 0; i < segPat.length; i++) {
      const ch = segPat[i];
      if (ch === '\\\\') {
        tokens.push({ t: 'lit', ch: i + 1 < segPat.length ? segPat[++i] : '\\\\' });
      } else if (ch === '*') {
        tokens.push({ t: 'star' });
      } else if (ch === '?') {
        tokens.push({ t: 'q' });
      } else if (ch === '[') {
        let j = i + 1;
        let neg = false;
        if (j < segPat.length && segPat[j] === '!') { neg = true; j++; }
        const chars = [];
        const ranges = [];
        let closed = false;
        while (j < segPat.length) {
          if (segPat[j] === ']' && (chars.length > 0 || ranges.length > 0)) {
            closed = true;
            break;
          }
          let c1 = segPat[j++];
          if (c1 === '\\\\' && j < segPat.length) c1 = segPat[j++];
          if (j + 1 < segPat.length && segPat[j] === '-' && segPat[j + 1] !== ']') {
            j++;
            let c2 = segPat[j++];
            if (c2 === '\\\\' && j < segPat.length) c2 = segPat[j++];
            ranges.push([c1, c2]);
          } else {
            chars.push(c1);
          }
        }
        if (!closed) {
          tokens.push({ t: 'lit', ch: '[' });
        } else {
          tokens.push({ t: 'cls', neg, chars, ranges });
          i = j;
        }
      } else {
        tokens.push({ t: 'lit', ch });
      }
    }
    return tokens;
  }

  function matchClass(tok, ch) {
    let hit = tok.chars.includes(ch);
    if (!hit) {
      for (const [lo, hi] of tok.ranges) {
        if (ch >= lo && ch <= hi) { hit = true; break; }
      }
    }
    return tok.neg ? !hit : hit;
  }

  function matchSingleSeg(segPat, seg) {
    const toks = tokenizeSeg(segPat);
    const memo = new Map();
    function dp(ti, si) {
      const key = ti + ',' + si;
      if (memo.has(key)) return memo.get(key);
      let res = false;
      if (ti === toks.length && si === seg.length) res = true;
      else if (ti < toks.length && toks[ti].t === 'star') {
        res = dp(ti + 1, si) || (si < seg.length && dp(ti, si + 1));
      } else if (ti < toks.length && si < seg.length) {
        const tok = toks[ti];
        if (tok.t === 'q') res = dp(ti + 1, si + 1);
        else if (tok.t === 'lit') res = tok.ch === seg[si] && dp(ti + 1, si + 1);
        else if (tok.t === 'cls') res = matchClass(tok, seg[si]) && dp(ti + 1, si + 1);
      }
      memo.set(key, res);
      return res;
    }
    return dp(0, 0);
  }

  function matchPath(pat, target) {
    const pSegs = pat.split('/');
    const tSegs = target.split('/');
    const memo = new Map();
    function dp(pi, si) {
      const key = pi + ',' + si;
      if (memo.has(key)) return memo.get(key);
      let res = false;
      if (pi === pSegs.length && si === tSegs.length) res = true;
      else if (pi < pSegs.length && pSegs[pi] === '**') {
        res = dp(pi + 1, si) || (si < tSegs.length && dp(pi, si + 1));
      } else if (pi < pSegs.length && si < tSegs.length) {
        res = matchSingleSeg(pSegs[pi], tSegs[si]) && dp(pi + 1, si + 1);
      }
      memo.set(key, res);
      return res;
    }
    return dp(0, 0);
  }

  return expandBraces(pattern).some((p) => matchPath(p, path));
}`;

const CALENDAR_REF = `class Calendar {
  constructor() {
    this.events = [];
  }
  _validate(a, b) {
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b) || a >= b) {
      throw new Error('Invalid interval');
    }
  }
  book(start, end) {
    this._validate(start, end);
    const pts = [[start, 1], [end, -1]];
    for (const [s, e] of this.events) {
      pts.push([s, 1], [e, -1]);
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    for (const [, d] of pts) {
      cur += d;
      if (cur > 2) return false;
    }
    this.events.push([start, end]);
    return true;
  }
  maxOverlap() {
    const pts = [];
    for (const [s, e] of this.events) {
      pts.push([s, 1], [e, -1]);
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    let best = 0;
    for (const [, d] of pts) {
      cur += d;
      if (cur > best) best = cur;
    }
    return best;
  }
  freeSlots(from, to) {
    this._validate(from, to);
    const busy = [];
    for (const [s, e] of this.events) {
      const cs = Math.max(s, from);
      const ce = Math.min(e, to);
      if (cs < ce) busy.push([cs, ce]);
    }
    busy.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const free = [];
    let cur = from;
    for (const [s, e] of busy) {
      if (s > cur) free.push([cur, s]);
      if (e > cur) cur = e;
    }
    if (cur < to) free.push([cur, to]);
    return free;
  }
}`;

export const HARD_TASKS = [
  {
    id: 'hard-semver',
    category: 'feature',
    prompt: `${DIRECT}Write a JavaScript function \`satisfies(version, range)\` -> boolean (plain function declaration, helpers allowed, no imports or exports, no eval or Function constructor).

Specification:
- Versions are \`MAJOR.MINOR.PATCH\` with optional \`-prerelease\` (non-negative integers; no \`v\` prefix or build metadata).
- Prerelease consists of dot-separated identifiers: numeric identifiers (\`/^[0-9]+$/\`) compare numerically; non-numeric identifiers compare lexicographically by ASCII; numeric < non-numeric; fewer identifiers < more identifiers when all leading identifiers match; a version with a prerelease is always < the same \`MAJOR.MINOR.PATCH\` without a prerelease.
- Range is one or more comparator sets separated by \`||\` (OR). Each comparator set is whitespace-separated comparators (AND), with operators attached directly to the version (no space between operator and version).
- Empty comparator set or \`*\` / \`x\` / \`X\` matches any non-prerelease version.
- Supported comparators: \`=\`, \`>\`, \`>=\`, \`<\`, \`<=\`, bare version (same as \`=\`), caret \`^\`, tilde \`~\`, and x-ranges (\`1.x\`, \`1.2.x\`, \`1.*\`, \`*\`, or omitted minor/patch like \`1.2\` or \`1\`).
- Caret \`^\`: allows changes that do not modify the left-most non-zero component of \`(MAJOR, MINOR, PATCH)\`: e.g. \`^1.2.3\` := \`>=1.2.3 <2.0.0\`, \`^0.2.3\` := \`>=0.2.3 <0.3.0\`, \`^0.0.3\` := \`>=0.0.3 <0.0.4\`, \`^0.0\` := \`>=0.0.0 <0.1.0\`, \`^0\` := \`>=0.0.0 <1.0.0\`.
- Tilde \`~\`: \`~1.2.3\` := \`>=1.2.3 <1.3.0\`, \`~1.2\` := \`>=1.2.0 <1.3.0\`, \`~1\` := \`>=1.0.0 <2.0.0\`.
- Partial/x comparators: bare \`1.2\` / \`1.2.x\` := \`>=1.2.0 <1.3.0\`, bare \`1\` / \`1.x\` := \`>=1.0.0 <2.0.0\`; \`>=1.2\` := \`>=1.2.0\`, \`<1.2\` := \`<1.2.0\`, \`<=1.2\` := \`<1.3.0\`, \`>1.2\` := \`>=1.3.0\`.
- npm prerelease rule: a version with a prerelease satisfies a comparator set ONLY if all comparators in that set hold AND at least one comparator in that same set has a prerelease tag with the exact same \`(MAJOR, MINOR, PATCH)\` tuple. \`*\` matches only non-prerelease versions.
${FOOTER}`,
    grade(text) {
      const cases = [
        ['1.2.4', '=1.2.3', false],
        ['1.9.9', '^1.2.3', true],
        ['2.0.0', '^1.2.3', false],
        ['0.2.9', '^0.2.3', true],
        ['0.3.0', '^0.2.3', false],
        ['0.0.3', '^0.0.3', true],
        ['0.0.4', '^0.0.3', false],
        ['1.2.9', '~1.2.3', true],
        ['1.3.0', '~1.2.3', false],
        ['1.9.0', '~1', true],
        ['2.0.0', '~1', false],
        ['1.2.5', '~1.2', true],
        ['1.2.9', '1.2', true],
        ['1.3.0', '1.2.x', false],
        ['3.4.5', '*', true],
        ['1.0.0-alpha', '*', false],
        ['1.2.3-alpha.10', '>=1.2.3-alpha.2 <1.2.4', true],
        ['1.2.3-1', '<1.2.3-alpha', true],
        ['1.2.3-alpha', '<1.2.3-alpha.1', true],
        ['1.2.4-alpha', '>=1.2.3-alpha <2.0.0', false],
        ['1.2.3-beta', '^1.2.3-alpha', true],
        ['1.2.3', '^1.2.3-alpha', true],
        ['2.0.0-alpha', '>=1.0.0-alpha || >=2.0.0', false],
        ['2.1.0', '>=1.0.0 <1.5.0 || >=2.0.0 <2.2.0', true],
      ].map(([v, r, want]) => ({
        label: `${v} @ ${r}`,
        expr: `satisfies(${JSON.stringify(v)}, ${JSON.stringify(r)})`,
        want,
      }));
      return gradeCases(text, cases);
    },
    reference: SEMVER_REF,
  },
  {
    id: 'hard-csv',
    category: 'feature',
    prompt: `${DIRECT}Write a JavaScript function \`parseCSV(text)\` -> array of rows (arrays of strings) (plain function declaration, helpers allowed, no imports or exports, no eval or Function constructor).

Specification (strict RFC 4180):
- Comma \`,\` separates fields; fields may be double-quoted \`"..."\`.
- Inside double-quoted fields, \`""\` represents a literal \`"\`, and commas, \`\\r\`, \`\\n\`, and \`\\r\\n\` are preserved verbatim as field content.
- Records are separated by \`\\n\` or \`\\r\\n\`.
- Empty input \`""\` returns \`[]\`. Empty fields are \`""\`.
- A single trailing \`\\n\` or \`\\r\\n\` terminates the last record without creating an extra row. A blank line between records (e.g. \`a\\n\\nb\`) or a second trailing newline (e.g. \`a,b\\n\\n\`) produces a row \`[""]\`.
- Whitespace is never trimmed: leading/trailing spaces in unquoted fields are kept as-is.
- Throw an \`Error\` on: an unterminated quote; a \`"\` appearing inside an unquoted field (including after leading whitespace like \` "a"\`); or any character after a closing quote other than \`,\`, \`\\n\`, \`\\r\\n\`, or end of input (including trailing spaces like \`"a" \`).
${FOOTER}`,
    grade(text) {
      const okCases = [
        ['', []],
        ['a,b,c', [['a', 'b', 'c']]],
        ['a,b\nc,d', [['a', 'b'], ['c', 'd']]],
        ['a,b\r\nc,d\r\n', [['a', 'b'], ['c', 'd']]],
        ['a,b\n', [['a', 'b']]],
        ['a,b\n\n', [['a', 'b'], ['']]],
        ['a\n\nb', [['a'], [''], ['b']]],
        [',', [['', '']]],
        ['a,,', [['a', '', '']]],
        [',a', [['', 'a']]],
        ['""', [['']]],
        ['""""', [['"']]],
        ['"a""b","c""""d"', [['a"b', 'c""d']]],
        ['"a,b","c,d"', [['a,b', 'c,d']]],
        ['"line1\nline2",x\ny,"z\r\nw"', [['line1\nline2', 'x'], ['y', 'z\r\nw']]],
        ['"a\rb",c', [['a\rb', 'c']]],
        [' a , b ', [[' a ', ' b ']]],
        ['a,b\nc', [['a', 'b'], ['c']]],
      ].map(([input, want]) => ({
        label: JSON.stringify(input),
        expr: `parseCSV(${JSON.stringify(input)})`,
        want,
      }));
      const errCases = [
        '"unterminated',
        '"abc""',
        'a"b,c',
        ' "a",b',
        '"a"x,b',
        '"a" ,b',
      ].map((input) => ({
        label: `throws(${JSON.stringify(input)})`,
        expr: `parseCSV(${JSON.stringify(input)})`,
        throws: true,
      }));
      return gradeCases(text, [...okCases, ...errCases]);
    },
    reference: CSV_REF,
  },
  {
    id: 'hard-cron',
    category: 'feature',
    prompt: `${DIRECT}Write a JavaScript function \`nextRun(expr, fromIso)\` -> UTC ISO string via \`Date.prototype.toISOString()\` (plain function declaration, helpers allowed, no imports or exports, no eval or Function constructor).

Specification:
- \`expr\` is a standard 5-field UTC cron string separated by whitespace: \`minute hour day-of-month month day-of-week\` (numeric only; month/weekday names are not required).
- Valid bounds: minute \`0-59\`, hour \`0-23\`, day-of-month \`1-31\`, month \`1-12\`, day-of-week \`0-7\` where both \`0\` and \`7\` mean Sunday.
- Each field is a comma-separated list of items: \`*\`, single integer \`a\`, inclusive range \`a-b\` (\`a <= b\`), \`*/n\`, or \`a-b/n\` (\`a <= b\`, step \`n >= 1\`).
- Vixie cron day rule: a day-of-month or day-of-week field is unrestricted only when it equals \`*\`. If BOTH day-of-month and day-of-week are restricted, a date matches if EITHER matches; otherwise BOTH must match.
- Drop seconds and milliseconds from \`fromIso\`, then return the first matching minute strictly after \`fromIso\` (i.e. starting from truncated \`fromIso\` + 1 minute).
- Search at most 5 years ahead from \`fromIso\`. Throw an \`Error\` if no match exists within 5 years, or if \`expr\` or \`fromIso\` is malformed.
${FOOTER}`,
    grade(text) {
      const okCases = [
        ['* * * * *', '2026-01-01T12:00:00.000Z', '2026-01-01T12:01:00.000Z'],
        ['* * * * *', '2026-01-01T12:00:59.999Z', '2026-01-01T12:01:00.000Z'],
        ['*/15 * * * *', '2026-01-01T12:15:30.000Z', '2026-01-01T12:30:00.000Z'],
        ['5-35/10 9-17 * * *', '2026-01-01T17:35:00.000Z', '2026-01-02T09:05:00.000Z'],
        ['0 0 * * 7', '2026-01-01T00:00:00.000Z', '2026-01-04T00:00:00.000Z'],
        ['0 8 * * 5-7', '2026-01-03T09:00:00.000Z', '2026-01-04T08:00:00.000Z'],
        ['0 0 15 * 1', '2026-01-10T00:00:00.000Z', '2026-01-12T00:00:00.000Z'],
        ['0 0 15 * 1', '2026-01-13T00:00:00.000Z', '2026-01-15T00:00:00.000Z'],
        ['0 0 31 2 1', '2026-02-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z'],
        ['0 0 31 * *', '2026-01-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z'],
        ['0 0 29 2 *', '2024-03-01T00:00:00.000Z', '2028-02-29T00:00:00.000Z'],
        ['30 23 31 12 *', '2026-12-31T23:30:00.000Z', '2027-12-31T23:30:00.000Z'],
        ['0,30 6,18 1,15 1,7 *', '2026-01-15T18:30:00.000Z', '2026-07-01T06:00:00.000Z'],
        ['59 23 * * 0', '2026-01-04T23:59:00.000Z', '2026-01-11T23:59:00.000Z'],
      ].map(([expr, fromIso, want]) => ({
        label: `${expr} @ ${fromIso}`,
        expr: `nextRun(${JSON.stringify(expr)}, ${JSON.stringify(fromIso)})`,
        want,
      }));
      const errCases = [
        ['0 0 31 2 *', '2026-01-01T00:00:00.000Z'],
        ['0 0 29 2 *', '2096-03-01T00:00:00.000Z'],
        ['0 0 31 4,6,9,11 *', '2026-01-01T00:00:00.000Z'],
        ['60 * * * *', '2026-01-01T00:00:00.000Z'],
        ['* 24 * * *', '2026-01-01T00:00:00.000Z'],
        ['*/0 * * * *', '2026-01-01T00:00:00.000Z'],
        ['5-2 * * * *', '2026-01-01T00:00:00.000Z'],
        ['* * * *', '2026-01-01T00:00:00.000Z'],
      ].map(([expr, fromIso]) => ({
        label: `throws(${expr})`,
        expr: `nextRun(${JSON.stringify(expr)}, ${JSON.stringify(fromIso)})`,
        throws: true,
      }));
      return gradeCases(text, [...okCases, ...errCases]);
    },
    reference: CRON_REF,
  },
  {
    id: 'hard-glob',
    category: 'feature',
    prompt: `${DIRECT}Write a JavaScript function \`globMatch(pattern, path)\` -> boolean (plain function declaration, helpers allowed, no imports or exports, no eval or Function constructor).

Specification:
- Path segments are separated by \`/\`. The entire \`path\` must match \`pattern\`.
- \`*\` matches zero or more characters except \`/\`; \`?\` matches exactly one character except \`/\`.
- \`**\` as an entire path segment matches zero or more whole segments (e.g. \`a/**/b\` matches \`a/b\`, \`a/x/b\`, \`a/x/y/b\`; \`**/c\` matches \`c\` and \`a/c\`; \`a/**\` matches \`a/x\` and \`a/x/y\`). If \`**\` is only part of a segment (e.g. \`a**b\`), it acts as single-segment wildcards and cannot cross \`/\`.
- Character classes \`[abc]\`, \`[a-z]\`, \`[!abc]\` match one character and never match \`/\`.
- Brace alternatives \`{a,b,c}\` match any listed alternative (multiple brace groups may appear in one pattern, and alternatives may contain other glob syntax including \`/\` and \`**\`; nested braces are not required).
- Backslash \`\\\` escapes the next character literally (e.g. \`\\*\`, \`\\?\`, \`\\{\`, \`\\\\\`). Regex metacharacters such as \`.\`, \`+\`, \`(\`, \`)\`, \`$\`, \`^\` are literal characters.
- A leading \`.\` in a segment is NOT special (dotfiles match \`*\`).
${FOOTER}`,
    grade(text) {
      const cases = [
        ['*.js', 'app.js', true],
        ['*.js', 'src/app.js', false],
        ['*.js', '.hidden.js', true],
        ['a?c', 'abc', true],
        ['a?c', 'a/c', false],
        ['a/**/b', 'a/b', true],
        ['a/**/b', 'a/x/y/b', true],
        ['**/c', 'c', true],
        ['**/c', 'a/b/c', true],
        ['a/**', 'a/x/y', true],
        ['a**b', 'a/b', false],
        ['a**b', 'axxb', true],
        ['file[0-9].txt', 'file7.txt', true],
        ['file[0-9].txt', 'filea.txt', false],
        ['a[!0-9]b', 'axb', true],
        ['a[!0-9]b', 'a5b', false],
        ['a[!0-9]b', 'a/b', false],
        ['src/*.{js,ts}', 'src/index.ts', true],
        ['{a,b}/{x,y}.txt', 'b/x.txt', true],
        ['src/{*.js,lib/**/*.ts}', 'src/lib/a/b/c.ts', true],
        ['a\\*b\\?c', 'a*b?c', true],
        ['a\\*b', 'axb', false],
        ['v1.0+(a)$^', 'v1.0+(a)$^', true],
        ['v1.0', 'v1x0', false],
        ['a/**/**/b', 'a/b', true],
      ].map(([pat, path, want]) => ({
        label: `${pat} :: ${path}`,
        expr: `globMatch(${JSON.stringify(pat)}, ${JSON.stringify(path)})`,
        want,
      }));
      return gradeCases(text, cases);
    },
    reference: GLOB_REF,
  },
  {
    id: 'hard-interval-tree',
    category: 'feature',
    prompt: `${DIRECT}Write a JavaScript \`class Calendar\` (plain class declaration, helpers allowed, no imports or exports, no eval or Function constructor) with these methods:
- \`book(start, end)\` -> boolean: books the half-open interval \`[start, end)\` ONLY if adding it would not cause a triple booking (at most 2 simultaneously overlapping booked events allowed at any point). Returns \`true\` if booked, \`false\` if rejected (rejected events are not stored). Adjacent intervals \`[a, b)\` and \`[b, c)\` do not overlap. Coordinates may be any finite numbers (negative, floating-point, or large).
- \`maxOverlap()\` -> integer: maximum number of simultaneously overlapping booked events (\`0\` if none).
- \`freeSlots(from, to)\` -> array of \`[s, e]\` maximal sub-intervals of \`[from, to)\` covered by zero booked events, sorted by start time.
- Both \`book(start, end)\` and \`freeSlots(from, to)\` must throw an \`Error\` if either argument is not a finite number or if \`start >= end\` (respectively \`from >= to\`).
${FOOTER}`,
    grade(text) {
      const okCases = [
        ['empty', '(() => { const c = new Calendar(); return [c.maxOverlap(), c.freeSlots(0, 10)]; })()', [0, [[0, 10]]]],
        ['triple-reject', '(() => { const c = new Calendar(); return [c.book(10, 20), c.book(15, 25), c.book(18, 22), c.maxOverlap(), c.freeSlots(0, 30)]; })()', [true, true, false, 2, [[0, 10], [25, 30]]]],
        ['adjacent', '(() => { const c = new Calendar(); return [c.book(0, 5), c.book(5, 10), c.book(0, 5), c.book(5, 10), c.book(0, 10), c.maxOverlap(), c.freeSlots(0, 10)]; })()', [true, true, true, true, false, 2, []]],
        ['span-two-gaps', '(() => { const c = new Calendar(); return [c.book(0, 10), c.book(20, 30), c.book(5, 25), c.maxOverlap(), c.freeSlots(0, 30)]; })()', [true, true, true, 2, []]],
        ['bridge-blocked', '(() => { const c = new Calendar(); c.book(0, 10); c.book(0, 5); c.book(20, 30); return [c.book(4, 25), c.book(5, 25), c.maxOverlap()]; })()', [false, true, 2]],
        ['exact-dup', '(() => { const c = new Calendar(); return [c.book(1, 5), c.book(1, 5), c.book(1, 5), c.maxOverlap()]; })()', [true, true, false, 2]],
        ['failed-no-mutate', '(() => { const c = new Calendar(); c.book(0, 10); c.book(0, 10); const f1 = c.book(5, 15); const f2 = c.book(10, 20); return [f1, f2, c.freeSlots(0, 25)]; })()', [false, true, [[20, 25]]]],
        ['nested-3rd-fail', '(() => { const c = new Calendar(); return [c.book(0, 100), c.book(20, 80), c.book(40, 60), c.book(0, 20), c.book(80, 100), c.maxOverlap()]; })()', [true, true, false, true, true, 2]],
        ['tiny-suboverlap', '(() => { const c = new Calendar(); c.book(10, 20); c.book(12, 13); return [c.book(11, 14), c.book(13, 19), c.freeSlots(9, 21)]; })()', [false, true, [[9, 10], [20, 21]]]],
        ['negative-float', '(() => { const c = new Calendar(); return [c.book(-10.5, -2.5), c.book(-5, 0.5), c.book(-4, -3), c.book(-2.5, 1), c.freeSlots(-12, 2)]; })()', [true, true, false, true, [[-12, -10.5], [1, 2]]]],
        ['large-coords', '(() => { const c = new Calendar(); return [c.book(1e9, 2e9), c.book(1.5e9, 2.5e9), c.freeSlots(0, 3e9)]; })()', [true, true, [[0, 1e9], [2.5e9, 3e9]]]],
        ['unsorted-gaps', '(() => { const c = new Calendar(); c.book(20, 25); c.book(5, 10); c.book(12, 15); return c.freeSlots(0, 30); })()', [[0, 5], [10, 12], [15, 20], [25, 30]]],
        ['clamped-free', '(() => { const c = new Calendar(); c.book(0, 100); c.book(20, 40); return [c.freeSlots(10, 50), c.freeSlots(100, 120)]; })()', [[], [[100, 120]]]],
        ['touch-outside', '(() => { const c = new Calendar(); c.book(0, 10); c.book(20, 30); return c.freeSlots(10, 20); })()', [[10, 20]]],
      ].map(([label, expr, want]) => ({ label, expr, want }));
      const errCases = [
        ['eq-book', '(() => { const c = new Calendar(); return c.book(10, 10); })()'],
        ['rev-book', '(() => { const c = new Calendar(); return c.book(20, 10); })()'],
        ['nan-book', '(() => { const c = new Calendar(); return c.book(NaN, 10); })()'],
        ['inf-book', '(() => { const c = new Calendar(); return c.book(0, Infinity); })()'],
        ['eq-free', '(() => { const c = new Calendar(); return c.freeSlots(10, 10); })()'],
        ['rev-free', '(() => { const c = new Calendar(); return c.freeSlots(10, 5); })()'],
        ['inf-free', '(() => { const c = new Calendar(); return c.freeSlots(-Infinity, 5); })()'],
      ].map(([label, expr]) => ({ label, expr, throws: true }));
      return gradeCases(text, [...okCases, ...errCases]);
    },
    reference: CALENDAR_REF,
  },
];
