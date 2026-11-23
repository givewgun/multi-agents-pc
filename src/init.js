import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { which, isShim } from './proc.js';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tandem.js');

const FILES = [
  ['AGENTS.md', 'AGENTS.md'],
  ['CLAUDE.md', 'CLAUDE.md'],
  ['skill-gemini.md', '.claude/skills/gemini/SKILL.md'],
  ['rule-claude-bridge.md', '.agents/rules/claude-bridge.md'],
  ['handoff-TEMPLATE.md', 'handoffs/TEMPLATE.md'],
];

/** How MCP clients should launch tandem: global install if present, else this checkout. */
export function mcpCommand(expose) {
  // MCP hosts spawn without a shell, so a Windows npm .cmd shim would fail with ENOENT.
  const global = which('tandem');
  if (global && !isShim(global)) return { command: 'tandem', args: ['mcp', '--expose', expose] };
  return { command: process.execPath, args: [BIN, 'mcp', '--expose', expose] };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function mergeMcp(file, name, entry) {
  let json = {};
  if (existsSync(file)) {
    try { json = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error(`${file} is not valid JSON; fix it or remove it`); }
    if (!isPlainObject(json)) throw new Error(`${file} must contain a JSON object`);
  }
  json.mcpServers ??= {};
  if (!isPlainObject(json.mcpServers)) throw new Error(`${file}: "mcpServers" must be an object`);
  const existed = !!json.mcpServers[name];
  json.mcpServers[name] = entry;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  return existed ? 'updated' : 'added';
}

export function init(dir, flags = {}) {
  const root = path.resolve(dir);
  mkdirSync(root, { recursive: true });
  for (const [src, dest] of FILES) {
    const to = path.join(root, dest);
    if (existsSync(to) && !flags.force) { console.log(`skip    ${dest} (exists; --force to overwrite)`); continue; }
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(path.join(TEMPLATES, src)));
    console.log(`write   ${dest}`);
  }
  for (const d of ['handoffs/inbox', 'handoffs/done']) mkdirSync(path.join(root, d), { recursive: true });

  const gi = path.join(root, '.gitignore');
  const giText = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (!giText.includes('handoffs/done/')) {
    appendFileSync(gi, `${giText && !giText.endsWith('\n') ? '\n' : ''}# tandem\nhandoffs/done/\n`);
    console.log('update  .gitignore');
  }

  if (flags.mcp) {
    // Claude Code reads project MCP servers from .mcp.json; Antigravity from .agents/mcp_config.json.
    console.log(`${mergeMcp(path.join(root, '.mcp.json'), 'tandem', mcpCommand('gemini')).padEnd(7)} .mcp.json (Claude Code → ask_gemini)`);
    console.log(`${mergeMcp(path.join(root, '.agents', 'mcp_config.json'), 'tandem', mcpCommand('claude')).padEnd(7)} .agents/mcp_config.json (Antigravity → ask_claude)`);
  }
  console.log(`\nDone. Edit ${path.join(root, 'AGENTS.md')} with project-specific rules.${flags.mcp ? '' : '\nTip: re-run with --mcp so the agents can call each other as MCP tools.'}`);
}
