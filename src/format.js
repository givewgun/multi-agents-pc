export const usd = (n) => (n == null ? '—' : n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
export const tok = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
export const ms = (n) => (n == null ? '—' : n >= 60_000 ? `${(n / 60_000).toFixed(1)}m` : `${(n / 1000).toFixed(1)}s`);
export const pct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = { dim: wrap(2), bold: wrap(1), green: wrap(32), yellow: wrap(33), red: wrap(31), cyan: wrap(36), magenta: wrap(35) };

export function bar(ratio, width = 20, showPct = true) {
  if (ratio == null) return c.dim('no budget set');
  const filled = Math.max(0, Math.min(width, Math.round(Math.min(ratio, 1) * width)));
  const color = ratio >= 1 ? c.red : ratio >= 0.8 ? c.yellow : c.green;
  return color('█'.repeat(filled)) + c.dim('░'.repeat(width - filled)) + (showPct ? ` ${pct(ratio)}` : '');
}

export function table(rows, headers) {
  const all = [headers, ...rows].map((r) => r.map(String));
  const w = headers.map((_, i) => Math.max(...all.map((r) => stripAnsi(r[i]).length)));
  return all.map((r, ri) => r.map((cell, i) => cell + ' '.repeat(w[i] - stripAnsi(cell).length)).join('  ') + (ri === 0 ? '\n' + w.map((n) => '─'.repeat(n)).join('  ') : '')).join('\n');
}

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
