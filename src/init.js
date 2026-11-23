import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { which, isShim, run } from './proc.js';
import { findClaude } from './agents.js';
import { loadConfig } from './config.js';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tandem.js');

const FILES = [
  ['AGENTS.md', 'AGENTS.md'],
  ['CLAUDE.md', 'CLAUDE.md'],
  ['skill-gemini.md', '.claude/skills/gemini/SKILL.md'],
  ['skill-pair.md', '.claude/skills/pair/SKILL.md'],
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
  const text = existsSync(file) ? readFileSync(file, 'utf8').replace(/^﻿/, '') : '';
  if (text.trim()) { // Antigravity creates an empty mcp_config.json
    try { json = JSON.parse(text); } catch { throw new Error(`${file} is not valid JSON; fix it or remove it`); }
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

function copyTemplate(src, to, force, label) {
  if (existsSync(to) && !force) return console.log(`skip    ${label} (exists; --force to overwrite)`);
  mkdirSync(path.dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(path.join(TEMPLATES, src)));
  console.log(`write   ${label}`);
}

/** Per-machine setup: tandem available to Claude Code and Antigravity in every project. */
export async function initGlobal(flags = {}) {
  const home = os.homedir();
  copyTemplate('skill-gemini.md', path.join(home, '.claude', 'skills', 'gemini', 'SKILL.md'), flags.force, '~/.claude/skills/gemini/SKILL.md (Claude /gemini skill)');
  copyTemplate('rule-claude-bridge.md', path.join(home, '.gemini', 'config', 'rules', 'claude-bridge.md'), flags.force, '~/.gemini/config/rules/claude-bridge.md (Antigravity rule)');

  const agyMcp = path.join(home, '.gemini', 'config', 'mcp_config.json');
  console.log(`${mergeMcp(agyMcp, 'tandem', mcpCommand('claude')).padEnd(7)} ~/.gemini/config/mcp_config.json (Antigravity → ask_claude)`);

  // Claude Code keeps user-scope MCP servers in its own config; let its CLI write it.
  const claude = findClaude(loadConfig());
  if (!claude) return console.log('skip    Claude Code MCP (claude CLI not found)');
  const { command, args } = mcpCommand('gemini');
  await run(claude, ['mcp', 'remove', '--scope', 'user', 'tandem'], { timeoutMs: 30_000 }); // idempotent re-run
  const r = await run(claude, ['mcp', 'add', '--scope', 'user', 'tandem', '--', command, ...args], { timeoutMs: 30_000 });
  console.log(r.code === 0 ? 'added   Claude Code user MCP server "tandem" (→ ask_gemini)' : `fail    claude mcp add: ${(r.stderr || r.stdout).trim()}`);
  console.log('\nRestart Claude Code and Antigravity sessions to load the new tools.');
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
