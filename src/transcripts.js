import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { transcriptPathFor } from './agents.js';

function resumeCommand(agent, sessionId) {
  if (!sessionId) return null;
  if (agent === 'claude') return `claude --resume ${sessionId}`;
  if (agent === 'gemini') return `agy --conversation ${sessionId}`;
  return null;
}

function toLines(lines) {
  if (typeof lines === 'string') return lines.split(/\r?\n/);
  return Array.isArray(lines) ? lines : [];
}

function parseObj(line) {
  if (line && typeof line === 'object' && !Array.isArray(line)) return line;
  if (typeof line !== 'string') return null;
  const s = line.trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function shortJson(val, max = 200) {
  if (val === undefined || val === null) return '';
  let s;
  try { s = typeof val === 'string' ? val : JSON.stringify(val); } catch { s = String(val); }
  if (!s || s === '{}') return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatToolCall(name, args) {
  return `${name || 'tool'}(${shortJson(args)})`;
}

function trunc(text, maxChars) {
  if (!maxChars || !Number.isFinite(maxChars) || text.length <= maxChars) return text;
  return maxChars === 1 ? '…' : `${text.slice(0, maxChars - 1)}…`;
}

function cleanText(text) {
  return text.replace(/^\r?\n+|\s+$/g, '');
}

function extractBlockText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => {
      if (typeof b === 'string') return b;
      if (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') return b.text;
      return '';
    }).filter(Boolean).join('\n');
  }
  if (content && typeof content === 'object') {
    try { return JSON.stringify(content); } catch { return ''; }
  }
  return '';
}

function stripUserRequestWrapper(text) {
  const m = /<USER_REQUEST>\s*([\s\S]*)<\/USER_REQUEST>/.exec(text);
  return m ? m[1].trimEnd() : text;
}

/** Parse Claude Code JSONL transcript lines into normalized messages. Never throws. */
export function parseClaudeTranscript(lines) {
  const entries = [];
  for (const raw of toLines(lines)) {
    const o = parseObj(raw);
    if (!o || (o.type !== 'user' && o.type !== 'assistant') || !o.message || typeof o.message !== 'object') continue;
    const content = o.message.content;
    const blocks = typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : Array.isArray(content) ? content : [];
    const id = o.type === 'assistant' && o.message.id ? String(o.message.id) : null;
    const prev = entries.at(-1);
    if (o.type === 'assistant' && id && prev?.type === 'assistant' && prev.id === id) {
      prev.blocks.push(...blocks);
      if (o.message.model) prev.model = o.message.model;
      if (!prev.at && o.timestamp) prev.at = o.timestamp;
    } else {
      entries.push({
        type: o.type,
        id,
        model: o.message.model || null,
        at: o.timestamp || null,
        blocks: [...blocks],
      });
    }
  }

  const out = [];
  const push = (role, text, model, at) => {
    if (typeof text !== 'string' || !text.trim()) return;
    const msg = { role, text: cleanText(text) };
    if (model) msg.model = model;
    if (at) msg.at = at;
    out.push(msg);
  };

  for (const e of entries) {
    let textBuf = [];
    const model = e.type === 'assistant' ? e.model : null;
    const flushText = () => {
      if (!textBuf.length) return;
      push(e.type, textBuf.join('\n'), model, e.at);
      textBuf = [];
    };
    for (const b of e.blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'thinking') continue;
      if (b.type === 'text') {
        if (typeof b.text === 'string' && b.text.trim()) textBuf.push(b.text);
      } else if (b.type === 'tool_use') {
        flushText();
        push('tool', formatToolCall(b.name, b.input), model, e.at);
      } else if (b.type === 'tool_result') {
        flushText();
        const body = extractBlockText(b.content);
        const prefix = b.is_error ? 'error: ' : '';
        push('tool', body ? `${prefix}${body}` : (b.is_error ? 'error' : ''), null, e.at);
      }
    }
    flushText();
  }
  return out;
}

/** Parse Antigravity JSONL transcript lines into normalized messages. Never throws. */
export function parseGeminiTranscript(lines) {
  const out = [];
  const push = (role, text, model, at) => {
    if (typeof text !== 'string' || !text.trim()) return;
    const msg = { role, text: cleanText(text) };
    if (model) msg.model = model;
    if (at) msg.at = at;
    out.push(msg);
  };

  for (const raw of toLines(lines)) {
    const o = parseObj(raw);
    if (!o) continue;
    const type = typeof o.type === 'string' ? o.type : '';
    const source = typeof o.source === 'string' ? o.source : '';
    const at = o.created_at || o.timestamp || null;
    const model = o.model || null;

    if (type === 'USER_INPUT' || source === 'USER_EXPLICIT' || source === 'USER') {
      const text = typeof o.content === 'string' ? stripUserRequestWrapper(o.content) : '';
      push('user', text, null, at);
      continue;
    }

    if (type === 'PLANNER_RESPONSE') {
      if (typeof o.content === 'string' && o.content.trim()) {
        push('assistant', o.content, model, at);
      }
      if (Array.isArray(o.tool_calls) && o.tool_calls.length) {
        const calls = o.tool_calls
          .filter((tc) => tc && typeof tc === 'object')
          .map((tc) => formatToolCall(tc.name, tc.args ?? tc.input ?? tc.arguments));
        if (calls.length) push('tool', calls.join('\n'), model, at);
      }
      continue;
    }

    if (source === 'MODEL' || source === 'TOOL' || /tool/i.test(type)) {
      if (Array.isArray(o.tool_calls) && o.tool_calls.length) {
        const calls = o.tool_calls
          .filter((tc) => tc && typeof tc === 'object')
          .map((tc) => formatToolCall(tc.name, tc.args ?? tc.input ?? tc.arguments));
        if (calls.length) push('tool', calls.join('\n'), model, at);
      }
      if (typeof o.content === 'string' && o.content.trim()) {
        push('tool', o.content, model, at);
      }
    }
  }
  return out;
}

function hasTruncatedContent(lines) {
  for (const l of lines) {
    if (typeof l !== 'string' || !l.includes('truncated_fields')) continue;
    const o = parseObj(l);
    if (Array.isArray(o?.truncated_fields) && o.truncated_fields.some((f) => f === 'content' || f === 'tool_calls')) {
      return true;
    }
  }
  return false;
}

/** Read a ledger record's native agent transcript without copying it. */
export function readTranscript(record, { maxChars = 4000 } = {}) {
  const agent = record?.to || record?.agent || null;
  const sessionId = record?.sessionId || null;
  const resume = resumeCommand(agent, sessionId);
  let filePath = record?.transcriptPath || (agent && sessionId ? transcriptPathFor(agent, sessionId) : null);

  const fullSibling = (agent === 'gemini' && filePath && path.basename(filePath) === 'transcript.jsonl')
    ? path.join(path.dirname(filePath), 'transcript_full.jsonl')
    : null;

  if (filePath && !existsSync(filePath) && fullSibling && existsSync(fullSibling)) {
    filePath = fullSibling;
  }

  if (!filePath || !existsSync(filePath)) {
    return { agent, sessionId, path: filePath, found: false, messages: [], resume };
  }

  let raw;
  try { raw = readFileSync(filePath, 'utf8'); } catch {
    return { agent, sessionId, path: filePath, found: false, messages: [], resume };
  }

  const lines = raw.split(/\r?\n/);
  let messages = agent === 'claude' ? parseClaudeTranscript(lines) : parseGeminiTranscript(lines);

  if (agent === 'gemini' && fullSibling && filePath !== fullSibling && existsSync(fullSibling)) {
    const lacksContent = !messages.some((m) => m.role === 'assistant' && m.text) || hasTruncatedContent(lines);
    if (lacksContent) {
      try {
        const fullRaw = readFileSync(fullSibling, 'utf8');
        const fullMsgs = parseGeminiTranscript(fullRaw.split(/\r?\n/));
        if (fullMsgs.length) {
          filePath = fullSibling;
          messages = fullMsgs;
        }
      } catch { /* keep compact transcript */ }
    }
  }

  if (maxChars > 0 && Number.isFinite(maxChars)) {
    messages = messages.map((m) => ({ ...m, text: trunc(m.text, maxChars) }));
  }
  return { agent, sessionId, path: filePath, found: true, messages, resume };
}
