import http from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readRecords, summarize, planBudget } from '../ledger.js';
import { loadConfig } from '../config.js';
import { getUsage } from '../usage.js';

const INDEX_URL = new URL('./index.html', import.meta.url);
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4777;
const MAX_PORT_OFFSET = 10;

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

function createHandler(cfg) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${HOST}`);
      if (req.method === 'GET' && url.pathname === '/') {
        const html = readFileSync(INDEX_URL, 'utf8');
        send(res, 200, 'text/html; charset=utf-8', html);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/summary') {
        const excludes = new Set(
          url.searchParams
            .getAll('exclude')
            .flatMap((v) => v.split(','))
            .map((s) => s.trim())
            .filter(Boolean)
        );
        // Reload config per request so `tandem budget set` shows up without a restart.
        const liveCfg = loadConfig();
        const all = readRecords();
        const shown = excludes.size > 0 ? all.filter((r) => !excludes.has(r.tag)) : all;
        // Plan usage comes from the agents (Gemini refreshed at most every 5 min), not the ledger.
        const usage = await getUsage(liveCfg);
        const summary = summarize(shown, liveCfg, Date.now(), usage);
        summary.budget = planBudget(usage, liveCfg, all);
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify(summary));
        return;
      }
      send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');
    } catch (err) {
      send(res, 500, 'text/plain; charset=utf-8', `Internal server error: ${err?.message || err}\n`);
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
