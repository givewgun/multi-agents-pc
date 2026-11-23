import http from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readRecords, summarize, planBudget } from '../ledger.js';
import { loadConfig } from '../config.js';
import { getUsage } from '../usage.js';
import { readTranscript } from '../transcripts.js';
import { sweep } from '../hooks.js';

let lastSweep = 0;

const INDEX_URL = new URL('./index.html', import.meta.url);
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4777;
const MAX_PORT_OFFSET = 10;
const UUID_RE = /^[0-9a-f-]{36}$/;
const LOCAL_HOST_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

/** Guard against DNS rebinding and cross-origin reads from other local/remote web pages. */
export function isLocalRequest(headers = {}) {
  const host = typeof headers.host === 'string' ? headers.host.trim() : '';
  if (!LOCAL_HOST_RE.test(host)) return false;
  const origin = typeof headers.origin === 'string' ? headers.origin.trim() : '';
  if (origin) {
    try {
      const u = new URL(origin);
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !LOCAL_HOST_RE.test(u.host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function openBrowser(url) {
  try {
    let child;
    if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    child.on('error', () => {});
    child.unref();
  } catch {
    // Ignore browser launch errors so the server stays running.
  }
}

function send(res, status, contentType, body) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
}

function parseExcludes(url) {
  return new Set(
    url.searchParams
      .getAll('exclude')
      .flatMap((v) => v.split(','))
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function trimRecord(r) {
  const { usage, ...rest } = r;
  return {
    ...rest,
    usage: { total: usage?.total ?? 0 },
  };
}

function summarizeThreads(records) {
  const map = new Map();
  for (const r of records) {
    if (typeof r.thread !== 'string' || !r.thread) continue;
    let t = map.get(r.thread);
    if (!t) {
      t = {
        thread: r.thread,
        records: 0,
        agents: new Set(),
        first: r.ts,
        last: r.ts,
        firstMs: Number.NaN,
        lastMs: Number.NaN,
        leads: new Set(),
      };
      map.set(r.thread, t);
    }
    t.records++;
    if (r.to) t.agents.add(r.to);
    if (typeof r.lead === 'string' && r.lead) t.leads.add(r.lead);
    const ms = Date.parse(r.ts);
    if (Number.isFinite(ms)) {
      if (!Number.isFinite(t.firstMs) || ms < t.firstMs) {
        t.firstMs = ms;
        t.first = r.ts;
      }
      if (!Number.isFinite(t.lastMs) || ms > t.lastMs) {
        t.lastMs = ms;
        t.last = r.ts;
      }
    } else {
      if (!t.first || r.ts < t.first) t.first = r.ts;
      if (!t.last || r.ts > t.last) t.last = r.ts;
    }
  }
  return [...map.values()]
    .sort((a, b) => {
      const diff = (Number.isFinite(b.lastMs) ? b.lastMs : 0) - (Number.isFinite(a.lastMs) ? a.lastMs : 0);
      return diff || String(b.last).localeCompare(String(a.last));
    })
    .map(({ thread, records: count, agents, first, last, leads }) => ({
      thread,
      records: count,
      agents: [...agents].sort(),
      first,
      last,
      leads: [...leads],
    }));
}

function createHandler(cfg) {
  return async (req, res) => {
    try {
      if (!isLocalRequest(req.headers)) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
      }
      const url = new URL(req.url || '/', `http://${HOST}`);
      if (req.method === 'GET' && url.pathname === '/') {
        const html = readFileSync(INDEX_URL, 'utf8');
        send(res, 200, 'text/html; charset=utf-8', html);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/summary') {
        const excludes = parseExcludes(url);
        // Reload config per request so `tandem budget set` shows up without a restart.
        const liveCfg = loadConfig();
        // Catch up token counts agents wrote after their Stop hook (at most once a minute).
        if (Date.now() - lastSweep > 60_000) { lastSweep = Date.now(); sweep(liveCfg); }
        const all = readRecords();
        const shown = excludes.size > 0 ? all.filter((r) => !excludes.has(r.tag)) : all;
        // Plan usage comes from the agents (Gemini refreshed at most every 5 min), not the ledger.
        const usage = await getUsage(liveCfg);
        const summary = summarize(shown, liveCfg, Date.now(), usage);
        summary.budget = planBudget(usage, liveCfg, all);
        sendJson(res, 200, summary);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/records') {
        const limitRaw = url.searchParams.get('limit');
        const parsedLimit = limitRaw != null && limitRaw !== '' ? Number.parseInt(limitRaw, 10) : 200;
        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 1000) : 200;
        const thread = url.searchParams.get('thread');
        const excludes = parseExcludes(url);
        let records = readRecords();
        if (thread) records = records.filter((r) => r.thread === thread);
        if (excludes.size > 0) records = records.filter((r) => !excludes.has(r.tag));
        const out = records.slice().reverse().slice(0, limit).map(trimRecord);
        sendJson(res, 200, out);
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/record/')) {
        const id = url.pathname.slice('/api/record/'.length);
        if (!UUID_RE.test(id)) {
          sendJson(res, 400, { error: 'Invalid record id' });
          return;
        }
        const records = readRecords();
        let record = null;
        for (let i = records.length - 1; i >= 0; i--) {
          if (records[i].id === id) {
            record = records[i];
            break;
          }
        }
        if (!record) {
          sendJson(res, 404, { error: 'Record not found' });
          return;
        }
        const transcript = readTranscript(record, { maxChars: 6000 });
        sendJson(res, 200, { record, transcript });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/threads') {
        const excludes = parseExcludes(url);
        let records = readRecords();
        if (excludes.size > 0) records = records.filter((r) => !excludes.has(r.tag));
        sendJson(res, 200, summarizeThreads(records));
        return;
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 500, { error: `Internal server error: ${err?.message || err}` });
    }
  };
}

function listenOnce(handler, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve({ server, port: server.address().port });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

async function listenWithFallback(handler, basePort) {
  if (basePort === 0) {
    return listenOnce(handler, 0);
  }
  const start =
    Number.isInteger(basePort) && basePort > 0 && basePort <= 65535
      ? basePort
      : DEFAULT_PORT;

  for (let offset = 0; offset <= MAX_PORT_OFFSET; offset++) {
    const candidate = start + offset;
    if (candidate > 65535) break;
    try {
      return await listenOnce(handler, candidate);
    } catch (err) {
      if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
        continue;
      }
      throw err;
    }
  }
  const maxTried = Math.min(start + MAX_PORT_OFFSET, 65535);
  throw new Error(`No free port found on ${HOST} in range ${start}-${maxTried}`);
}

export async function startDashboard(port = DEFAULT_PORT, cfg = {}, flags = {}) {
  const { server, port: boundPort } = await listenWithFallback(createHandler(cfg), port);
  const url = `http://${HOST}:${boundPort}`;
  console.log(`tandem dashboard: ${url} (Ctrl+C to stop)`);

  if (flags?.open) {
    openBrowser(url);
  }

  await new Promise((resolve) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      server.close(() => resolve());
      server.closeAllConnections?.();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    server.once('close', () => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      resolve();
    });
  });
}
