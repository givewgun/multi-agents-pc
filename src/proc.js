import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const WIN = process.platform === 'win32';

/** Find an executable on PATH, then in fallback locations. Native binaries before shims on Windows. */
export function which(name, fallbacks = []) {
  const exts = WIN ? ['.exe', '.cmd', '.bat'] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (existsSync(p)) return p;
    }
  }
  return fallbacks.find((p) => p && existsSync(p)) || null;
}

const isShim = (cmd) => WIN && /\.(cmd|bat)$/i.test(cmd);

/**
 * Run a command without a shell. Windows .cmd/.bat shims need a shell, so callers must keep
 * argv shell-safe for them (send free text via stdin instead).
 */
export function run(cmd, args, { cwd, input, timeoutMs = 0, env } = {}) {
  return new Promise((resolve) => {
    const shell = isShim(cmd);
    if (shell && args.some((a) => /[\s"&|<>^%!]/.test(a))) {
      throw new Error(`Refusing to pass shell-unsafe args to ${cmd}; send text via stdin`);
    }
    const child = spawn(shell ? `"${cmd}"` : cmd, args, {
      cwd, env: { ...process.env, ...env }, shell, windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; kill(child); }, timeoutMs) : null;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err.message), timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

function kill(child) {
  // Agents spawn their own children; kill the whole tree.
  if (WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
}
