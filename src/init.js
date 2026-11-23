import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { which, isShim, run } from './proc.js';
import { findClaude } from './agents.js';
import { loadConfig } from './config.js';
import { hookCommand, tandemCommand, installClaudeHook } from './hooks.js';

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

function copyTemplate(src, to, force, label, vars = null) {
  if (existsSync(to) && !force) return console.log(`skip    ${label} (exists; --force to overwrite)`);
  mkdirSync(path.dirname(to), { recursive: true });
  let body = readFileSync(path.join(TEMPLATES, src), vars ? 'utf8' : undefined);
  for (const [k, v] of Object.entries(vars || {})) body = body.split(k).join(v);
  writeFileSync(to, body);
  console.log(`write   ${label}`);
}

const PLUGIN_MARKER = { name: 'tandem', author: 'tandem-agents' };

function isTandemPlugin(dir) {
  const manifest = path.join(dir, 'plugin.json');
  if (!existsSync(manifest)) return false;
  try {
    const text = readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '');
    if (!text.trim()) return false;
    const j = JSON.parse(text);
    return isPlainObject(j) && j.name === PLUGIN_MARKER.name && j.author === PLUGIN_MARKER.author;
  } catch { return false; }
}

function copyTemplateDir(srcDir, dstDir, vars) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, entry.name);
    const to = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplateDir(from, to, vars);
    } else if (entry.isFile()) {
      let text = readFileSync(from, 'utf8');
      for (const [k, v] of Object.entries(vars)) text = text.split(k).join(v);
      writeFileSync(to, text);
    }
  }
}

function removeMcp(file, name) {
  if (!existsSync(file)) return 'absent';
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) return 'absent';
  let json;
  try { json = JSON.parse(text); } catch { return 'invalid'; }
  if (!isPlainObject(json) || !isPlainObject(json.mcpServers) || !Object.hasOwn(json.mcpServers, name)) return 'absent';
  delete json.mcpServers[name];
  if (Object.keys(json.mcpServers).length === 0) delete json.mcpServers;
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  return 'removed';
}

/** Per-machine setup: tandem available to Claude Code and Antigravity in every project. */
export async function initGlobal(flags = {}) {
  const home = os.homedir();

  // Antigravity plugin (MCP + Stop hook + rule + skills)
  const pluginDir = path.join(home, '.gemini', 'config', 'plugins', 'tandem');
  const pluginExisted = existsSync(pluginDir);
  let pluginInstalled = false;
  if (pluginExisted && !flags.force && !isTandemPlugin(pluginDir)) {
    console.log('skip    ~/.gemini/config/plugins/tandem/ (exists and not tandem-managed; --force to overwrite)');
  } else {
    const agyMcpCmd = mcpCommand('claude');
    copyTemplateDir(path.join(TEMPLATES, 'antigravity-plugin'), pluginDir, {
      '{{MCP_COMMAND}}': JSON.stringify(agyMcpCmd.command),
      '{{MCP_ARGS}}': JSON.stringify(agyMcpCmd.args),
      '{{HOOK_COMMAND}}': JSON.stringify(hookCommand('gemini')),
      '{{PROMPT_HOOK_COMMAND}}': JSON.stringify(hookCommand('gemini', 'prompt')),
      '{{TANDEM_CMD}}': tandemCommand(),
    });
    pluginInstalled = true;
    console.log(`${pluginExisted ? 'update ' : 'write  '} ~/.gemini/config/plugins/tandem/ (Antigravity plugin)`);
  }

  // Migrate v0.1 loose Antigravity files so nothing loads twice
  if (pluginInstalled) {
    const oldRule = path.join(home, '.gemini', 'config', 'rules', 'claude-bridge.md');
    if (existsSync(oldRule)) {
      const text = readFileSync(oldRule, 'utf8');
      if (/tandem/i.test(text)) {
        unlinkSync(oldRule);
        console.log('remove  ~/.gemini/config/rules/claude-bridge.md (migrated to plugin)');
      } else {
        console.log('skip    ~/.gemini/config/rules/claude-bridge.md (no tandem mention; kept)');
      }
    }
    const oldMcp = path.join(home, '.gemini', 'config', 'mcp_config.json');
    const mcpStatus = removeMcp(oldMcp, 'tandem');
    if (mcpStatus === 'removed') console.log('remove  ~/.gemini/config/mcp_config.json ("tandem" migrated to plugin)');
    else if (mcpStatus === 'invalid') console.log('skip    ~/.gemini/config/mcp_config.json (not valid JSON)');
  }

  // Claude Code skills, Stop hook and user-scope MCP server
  copyTemplate('skill-gemini.md', path.join(home, '.claude', 'skills', 'gemini', 'SKILL.md'), flags.force, '~/.claude/skills/gemini/SKILL.md (Claude /gemini skill)');
  copyTemplate('skill-pair.md', path.join(home, '.claude', 'skills', 'pair', 'SKILL.md'), flags.force, '~/.claude/skills/pair/SKILL.md (Claude /pair skill)');
  copyTemplate('skill-tandem.md', path.join(home, '.claude', 'skills', 'tandem', 'SKILL.md'), flags.force, '~/.claude/skills/tandem/SKILL.md (Claude /tandem mode skill)', { '{{TANDEM_CMD}}': tandemCommand() });
  try {
    const hookRes = installClaudeHook();
    console.log(hookRes === 'present'
      ? 'skip    ~/.claude/settings.json (Claude hooks already present)'
      : `update  ~/.claude/settings.json (Claude Stop + UserPromptSubmit hooks ${hookRes})`);
  } catch (err) {
    console.log(`skip    ~/.claude/settings.json (Claude Stop hook failed: ${err.message})`);
  }

  // Claude Code keeps user-scope MCP servers in its own config; let its CLI write it.
  const claude = findClaude(loadConfig());
  if (!claude) {
    console.log('skip    Claude Code MCP (claude CLI not found)');
  } else {
    const { command, args } = mcpCommand('gemini');
    await run(claude, ['mcp', 'remove', '--scope', 'user', 'tandem'], { timeoutMs: 30_000 }); // idempotent re-run
    const r = await run(claude, ['mcp', 'add', '--scope', 'user', 'tandem', '--', command, ...args], { timeoutMs: 30_000 });
    console.log(r.code === 0 ? 'added   Claude Code user MCP server "tandem" (→ ask_gemini)' : `fail    claude mcp add: ${(r.stderr || r.stdout).trim()}`);
  }
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
