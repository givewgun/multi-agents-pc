// Benchmark tasks with deterministic graders. Each maps to a router category so results can
// confirm (or correct) the routing table.
import vm from 'node:vm';
import { RULES } from '../router.js';

export function extractJson(text) {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    for (const [open, close] of [['{', '}'], ['[', ']']]) {
      const i = c.indexOf(open);
      const j = c.lastIndexOf(close);
      if (i !== -1 && j > i) {
        try { return JSON.parse(c.slice(i, j + 1)); } catch { /* try next */ }
      }
    }
  }
  return undefined;
}

function extractCode(text) {
  const m = /```(?:js|javascript)?\s*([\s\S]*?)```/i.exec(text);
  return (m ? m[1] : text).trim();
}

function runInSandbox(code, expr) {
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx, { timeout: 1000 });
  return vm.runInContext(expr, ctx, { timeout: 1000 });
}

// Deterministic PRNG so the log task is identical across runs.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLog(n) {
  const rand = mulberry32(42);
  const services = ['auth', 'billing', 'search', 'gateway'];
  const levels = ['INFO', 'INFO', 'INFO', 'WARN', 'ERROR'];
  const counts = Object.fromEntries(services.map((s) => [s, 0]));
  let slowest = { ms: -1, req: null };
  const lines = [];
  for (let i = 0; i < n; i++) {
    const svc = services[Math.floor(rand() * services.length)];
    const lvl = levels[Math.floor(rand() * levels.length)];
    const ms = Math.floor(rand() * 9000) + 10;
    const req = 1000 + i;
    if (lvl === 'ERROR') {
      counts[svc]++;
      if (ms > slowest.ms) slowest = { ms, req };
    }
    lines.push(`2026-11-20T${String(10 + Math.floor(i / 360)).padStart(2, '0')}:${String(Math.floor(i / 6) % 60).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}Z ${lvl.padEnd(5)} [${svc}] req=${req} took ${ms}ms${lvl === 'ERROR' ? ' upstream failure' : ''}`);
  }
  return { text: lines.join('\n'), counts, slowest };
}

// Non-agentic tasks give the model everything it needs; tool use would only hit headless denials.
const DIRECT = 'Answer directly from the information below. Do not use any tools, files, or shell commands.\n\n';

const LRU_BUGGY = `class LRU {
  constructor(capacity) { this.cap = capacity; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return -1;
    return this.map.get(key);
  }
  put(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.cap) this.map.delete(this.map.keys().next().value);
    this.map.set(key, value);
  }
}`;

const BUGGY = `function sumLastN(arr, n) {
  // returns the sum of the last n elements of arr
  let total = 0;
  const start = arr.length - n;
  for (let i = start; i <= arr.length; i++) {
    total += arr[i];
  }
  return total;
}`;

const LOG = makeLog(600);

export const TASKS = [
  {
    id: 'trivial-regex',
    category: 'trivial',
    prompt: DIRECT + 'Give a single JavaScript regular expression literal that matches a full string in ISO date form YYYY-MM-DD where month is 01-12 and day is 01-31 (no need to validate days per month). Reply with only the regex literal, e.g. /^...$/, nothing else.',
    grade(text) {
      const m = /\/(\^[^\n]*\$)\/[gimsuy]*/.exec(text);
      if (!m) return { pass: false, why: 'no regex literal found' };
      let re;
      try { re = new RegExp(m[1]); } catch { return { pass: false, why: 'invalid regex' }; }
      const good = ['2026-01-01', '1999-12-31', '2026-11-23', '2000-02-29'];
      const bad = ['2026-13-01', '2026-00-10', '2026-01-32', '2026-1-01', '26-01-01', '2026-01-01x', ' 2026-01-01'];
      const fails = [...good.filter((s) => !re.test(s)), ...bad.filter((s) => re.test(s))];
      return { pass: fails.length === 0, why: fails.length ? `wrong on ${fails.join(', ')}` : '' };
    },
  },
  {
    id: 'boilerplate-slugify',
    category: 'boilerplate',
    prompt: `${DIRECT}Write a JavaScript function \`slugify(str)\` (plain function declaration, no imports, no exports) that:
- lowercases the string
- removes diacritics (é → e, ñ → n) using String.prototype.normalize
- replaces every run of characters that are not a-z or 0-9 with a single hyphen
- trims leading and trailing hyphens
Reply with only the code in one \`\`\`js block.`,
    grade(text) {
      const cases = [['Hello World', 'hello-world'], ['  Crème Brûlée!! ', 'creme-brulee'], ['a--b__c', 'a-b-c'], ['Año 2026: ¿Qué?', 'ano-2026-que'], ['---', ''], ['ABC123def', 'abc123def']];
      try {
        const code = extractCode(text);
        const fails = cases.filter(([i, o]) => runInSandbox(code, `slugify(${JSON.stringify(i)})`) !== o);
        return { pass: fails.length === 0, why: fails.length ? `wrong for ${fails.map((f) => JSON.stringify(f[0])).join(', ')}` : '' };
      } catch (e) { return { pass: false, why: `code error: ${e.message}` }; }
    },
  },
  {
    id: 'review-offbyone',
    category: 'review',
    prompt: `${DIRECT}Find the bug in this function. Lines are numbered.
${BUGGY.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}

Reply with only JSON: {"line": <line number of the bug>, "fix": "<corrected line>"}`,
    grade(text) {
      const j = extractJson(text);
      if (!j || typeof j.line !== 'number') return { pass: false, why: 'no {"line": n} JSON' };
      const fixOk = typeof j.fix === 'string' && /i\s*<\s*arr\.length/.test(j.fix);
      return { pass: j.line === 5 && fixOk, why: j.line !== 5 ? `said line ${j.line}` : fixOk ? '' : 'fix wrong' };
    },
  },
  {
    id: 'bulkread-logs',
    category: 'bulk-read',
    prompt: `${DIRECT}This log has 600 lines. Count the ERROR lines per service, and find the req id of the slowest ERROR line (largest "took" value). Reply with only JSON: {"counts": {"auth": n, "billing": n, "search": n, "gateway": n}, "slowestErrorReq": n}.

${LOG.text}`,
    grade(text) {
      const j = extractJson(text);
      if (!j?.counts) return { pass: false, why: 'no {"counts":...} JSON' };
      const wrong = Object.entries(LOG.counts).filter(([s, n]) => j.counts[s] !== n);
      const slowOk = j.slowestErrorReq === LOG.slowest.req;
      const why = [wrong.length && `counts ${wrong.map(([s, n]) => `${s} ${j.counts[s]}≠${n}`).join(', ')}`, !slowOk && `slowest ${j.slowestErrorReq}≠${LOG.slowest.req}`].filter(Boolean).join('; ');
      return { pass: !wrong.length && slowOk, why };
    },
  },
  {
    id: 'hard-concurrency',
    category: 'hard-debug',
    prompt: `${DIRECT}Two threads share an integer x = 0. Each thread runs \`for (i = 0; i < 10; i++) { tmp = x; x = tmp + 1; }\` where the load and the store are separate, individually atomic steps, and the scheduler may interleave the steps in any order. What is the minimum possible final value of x, and the maximum? Reply with only JSON: {"min": <n>, "max": <n>}.`,
    grade(text) {
      const j = extractJson(text);
      if (!j) return { pass: false, why: 'no JSON' };
      return { pass: j.min === 2 && j.max === 20, why: j.min === 2 && j.max === 20 ? '' : `said min ${j.min}, max ${j.max}` };
    },
  },
  {
    id: 'hard-lru-fix',
    category: 'hard-debug',
    prompt: `${DIRECT}This LRU cache passes simple tests but evicts the wrong entry in some sequences.
\`\`\`js
${LRU_BUGGY}
\`\`\`
Return the corrected class (same name and API, still using a Map) in one \`\`\`js block, code only.`,
    grade(text) {
      try {
        const code = extractCode(text) + '\n;globalThis.LRU = LRU;';
        const script = `(() => { const c = new LRU(2); c.put('a',1); c.put('b',2); c.get('a'); c.put('c',3);
          const r1 = c.get('b') === -1 && c.get('a') === 1 && c.get('c') === 3;
          const d = new LRU(2); d.put('x',1); d.put('y',2); d.put('x',9); d.put('z',3);
          const r2 = d.get('y') === -1 && d.get('x') === 9 && d.get('z') === 3;
          const e = new LRU(1); e.put('k',1); e.put('k',2); const r3 = e.get('k') === 2;
          return [r1, r2, r3]; })()`;
        const [r1, r2, r3] = runInSandbox(code, script);
        const why = [!r1 && 'get() does not refresh recency', !r2 && 'update order wrong', !r3 && 'cap-1 overwrite wrong'].filter(Boolean).join('; ');
        return { pass: r1 && r2 && r3, why };
      } catch (e) { return { pass: false, why: `code error: ${e.message}` }; }
    },
  },
  {
    id: 'feature-expr-eval',
    category: 'feature',
    prompt: `${DIRECT}Write a JavaScript function \`evaluate(expr)\` (plain function declaration; helpers allowed; no eval, no Function constructor, no imports) that evaluates arithmetic strings with numbers (integers and decimals), + - * /, parentheses, unary minus (including repeated, like "--2"), and arbitrary whitespace, with standard precedence and left associativity. Throw an Error on malformed input. Reply with only the code in one \`\`\`js block.`,
    grade(text) {
      const code = extractCode(text);
      if (/\beval\s*\(|\bFunction\s*\(/.test(code)) return { pass: false, why: 'used eval/Function' };
      const cases = [['1 + 2 * 3', 7], ['(1 + 2) * 3', 9], ['8 / 4 / 2', 1], ['10 - 4 - 3', 3], ['-3 * -2', 6], ['--2', 2], ['2 * (3 + -(4 - 1))', 0], [' 1.5*2 ', 3], ['-(2+3)*2', -10]];
      const errs = ['1 +', '(1 + 2', '2 * * 3', ''];
      try {
        const wrong = cases.filter(([e, v]) => Math.abs(runInSandbox(code, `evaluate(${JSON.stringify(e)})`) - v) > 1e-9);
        const noThrow = errs.filter((e) => { try { runInSandbox(code, `evaluate(${JSON.stringify(e)})`); return true; } catch { return false; } });
        const why = [wrong.length && `wrong: ${wrong.map((w) => w[0]).join(' | ')}`, noThrow.length && `no error for: ${noThrow.map((e) => JSON.stringify(e)).join(', ')}`].filter(Boolean).join('; ');
        return { pass: !wrong.length && !noThrow.length, why };
      } catch (e) { return { pass: false, why: `code error: ${e.message}` }; }
    },
  },
  {
    id: 'agentic-repo-read',
    category: 'bulk-read',
    agentic: true,
    prompt: 'Read the file src/router.js in the current working directory (use your file-reading tool; do not run shell commands). Return only a JSON array of the `category` values in the RULES array, in order.',
    grade(text) {
      const j = extractJson(text);
      const want = RULES.map((r) => r.category);
      if (!Array.isArray(j)) return { pass: false, why: 'no JSON array' };
      return { pass: JSON.stringify(j) === JSON.stringify(want), why: JSON.stringify(j) === JSON.stringify(want) ? '' : `got ${JSON.stringify(j)}` };
    },
  },
];
