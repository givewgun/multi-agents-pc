// Cross-platform verification that the packed npm tarball installs cleanly and runs.
// Used by both .github/workflows/ci.yml and .github/workflows/release.yml.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WIN = process.platform === 'win32';
const keepTarball = process.argv.includes('--keep-tarball');

if (fs.readFileSync('bin/tandem.js').includes(13)) {
  throw new Error('bin/tandem.js contains CRLF line endings (breaks POSIX shebang)');
}

function runCmd(bin, args, opts = {}) {
  if (WIN && /\.(cmd|bat)$/i.test(bin)) {
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', bin, ...args], opts);
  }
  return execFileSync(bin, args, opts);
}

const npm = WIN ? 'npm.cmd' : 'npm';
const tgz = runCmd(npm, ['pack', '--silent'], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .pop();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-pack-'));
try {
  runCmd(npm, ['install', '--no-audit', '--no-fund', '--prefix', tmp, path.resolve(tgz)], { stdio: 'inherit' });
  const bin = path.join(tmp, 'node_modules', '.bin', WIN ? 'tandem.cmd' : 'tandem');
  const expected = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const actual = runCmd(bin, ['--version'], { encoding: 'utf8' }).trim();
  if (actual !== expected) throw new Error(`Expected version ${expected}, got ${actual}`);
  runCmd(bin, ['route', 'write unit tests'], { stdio: 'inherit' });
  if (keepTarball) {
    process.stdout.write(`TARBALL=${tgz}\n`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!keepTarball) fs.rmSync(tgz, { force: true });
}
