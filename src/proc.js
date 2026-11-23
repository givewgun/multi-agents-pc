import { spawn } from 'node:child_process';
import { statSync, accessSync, constants } from 'node:fs';
import path from 'node:path';

const WIN = process.platform === 'win32';

function isExecutable(p) {
  try {
    if (!statSync(p).isFile()) return false;
    if (!WIN) accessSync(p, constants.X_OK);
    return true;
  } catch { return false; }
}

/** Find an executable on PATH, then in fallback locations. Native binaries before shims on Windows. */
export function which(name, fallbacks = []) {
  const exts = WIN ? ['.exe', '.cmd', '.bat'] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (isExecutable(p)) return p;
    }
  }
  return fallbacks.find((p) => p && isExecutable(p)) || null;
}

export const isShim = (cmd) => WIN && /\.(cmd|bat)$/i.test(cmd);

/**
 * Run a command without a shell. Windows .cmd/.bat shims need a shell, so callers must keep
 * argv shell-safe for them (send free text via stdin instead).
 */
export function run(cmd, args, { cwd, input, timeoutMs = 0, env } = {}) {
  const shell = isShim(cmd);
  if (shell && args.some((a) => /[\s"&|<>^%!]/.test(a))) {
    return Promise.reject(new Error(`Refusing to pass shell-unsafe args to ${cmd}; send text via stdin`));
  }
  return new Promise((resolve) => {
    const child = spawn(shell ? `"${cmd}"` : cmd, args, {
      cwd, env: { ...process.env, ...env }, shell, windowsHide: true,
      // Own process group on POSIX so a timeout can kill grandchildren too.
      detached: !WIN,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    // A child that exits before reading all of stdin raises EPIPE here; its exit status reports the failure.
    child.stdin.on('error', () => {});
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; kill(child); }, timeoutMs) : null;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err.message), timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(input ?? undefined);
  });
}

function kill(child) {
  if (!child.pid) return;
  if (WIN) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    return;
  }
  const signal = (sig) => { try { process.kill(-child.pid, sig); } catch { /* ESRCH: already gone */ } };
  signal('SIGTERM');
  setTimeout(() => signal('SIGKILL'), 5000).unref();
}
