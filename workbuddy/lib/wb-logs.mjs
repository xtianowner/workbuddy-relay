import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipFiles } from './wb-zip.mjs';

const MiB = 1024 * 1024;
export const LOG_POLICY = { days: 30, maxFiles: 100, maxFileBytes: 2 * MiB, maxTotalBytes: 40 * MiB };
const logName = /^relay-\d{4}-\d{2}-\d{2}-\d{3}\.jsonl$/;
const privateField = /^(api[-_]?key|key|token|pat|password|authorization|cookie|secret|messages|prompt|content|body|preview|headers|raw|responseBody)$/i;

export function defaultLogDir() {
  if (process.env.WB_LOG_DIR) return path.resolve(process.env.WB_LOG_DIR);
  const root = process.platform === 'win32' ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Logs') : path.join(os.homedir(), '.local', 'state');
  return path.join(root, 'SmarAgents', 'WorkBuddyRelay', 'logs');
}

export function createLogger({ dir = defaultLogDir(), version = 'unknown', policy = {}, now = () => new Date() } = {}) {
  const limits = { ...LOG_POLICY, ...policy }, secrets = new Set();
  const sessionId = crypto.randomUUID();
  let lastError = null, current = null;
  const home = os.homedir();
  const scrubString = (value) => {
    let s = String(value);
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) s = s.split(secret).join('[REDACTED]');
    s = s.replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:sk-|nap_)[A-Za-z0-9_.*-]+/g, '[REDACTED]')
      .replace(/((?:api[-_]?key|token|password|authorization|secret)\s*[=:]\s*)[^\s&,;]+/gi, '$1[REDACTED]')
      .replace(/([?&](?:t|key|token|api_key)=)[^&#\s]+/gi, '$1[REDACTED]');
    for (const root of [home, home.replaceAll('\\', '/'), process.env.LOCALAPPDATA].filter(Boolean)) s = s.split(root).join('<USER>');
    return s.length > 4000 ? `${s.slice(0, 4000)}…[truncated]` : s;
  };
  const sanitize = (value, depth = 0) => {
    if (depth > 10) return '[truncated]';
    if (typeof value === 'string') return scrubString(value);
    if (value instanceof Error) return sanitize({ name: value.name, code: value.code, message: value.message, stack: value.stack, cause: value.cause }, depth + 1);
    if (Array.isArray(value)) return value.slice(0, 500).map((v) => sanitize(v, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [scrubString(k), privateField.test(k) ? '[REDACTED]' : sanitize(v, depth + 1)]));
    return value;
  };
  function files() {
    return fs.readdirSync(dir).filter((name) => logName.test(name)).map((name) => {
      const stat = fs.lstatSync(path.join(dir, name));
      return { name, size: stat.size, mtime: stat.mtimeMs, regular: stat.isFile() && !stat.isSymbolicLink() };
    }).filter((f) => f.regular).sort((a, b) => a.name.localeCompare(b.name));
  }
  function prune(reserve = 0) {
    let all = files(), total = all.reduce((n, f) => n + f.size, 0);
    for (const f of all) {
      if (f.mtime < now().getTime() - limits.days * 86400e3 || total + reserve > limits.maxTotalBytes || all.length > limits.maxFiles) {
        fs.unlinkSync(path.join(dir, f.name)); total -= f.size; all = all.filter((x) => x !== f);
        if (current === f.name) current = null;
      }
    }
  }
  function record(event, details = {}, level = 'info', operationId) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const line = `${JSON.stringify(sanitize({ time: now().toISOString(), level, event, sessionId, operationId, version, details }))}\n`;
      const size = Buffer.byteLength(line);
      prune(size);
      const day = now().toISOString().slice(0, 10), prefix = `relay-${day}-`;
      const today = files().filter((f) => f.name.startsWith(prefix));
      const last = today.at(-1);
      current = last && last.size + size <= limits.maxFileBytes ? last.name : `${prefix}${String(Number(last?.name.slice(-9, -6) ?? -1) + 1).padStart(3, '0')}.jsonl`;
      fs.appendFileSync(path.join(dir, current), line, { mode: 0o600 });
      prune(); lastError = null;
      return true;
    } catch (e) { lastError = scrubString(e.message); return false; }
  }
  function status() {
    let all = [];
    try { all = files(); } catch { /* state is reported below */ }
    return { dir, sessionId, version, available: !lastError, error: lastError, files: all.length, bytes: all.reduce((n, f) => n + f.size, 0), policy: limits };
  }
  function exportBundle(diagnostics = {}) {
    record('logs.export.started');
    if (lastError) throw new Error(`日志目录不可用：${lastError}`);
    let invalidLines = 0;
    const entries = files().map(({ name, size }) => {
      if (size > limits.maxFileBytes + 128 * 1024) { invalidLines++; return null; }
      const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(Boolean).flatMap((line) => {
        try { return [JSON.stringify(sanitize(JSON.parse(line)))]; } catch { invalidLines++; return []; }
      });
      return { name: `logs/${name}`, data: `${lines.join('\n')}\n` };
    }).filter(Boolean);
    entries.push({ name: 'diagnostics.json', data: JSON.stringify(sanitize({ exportedAt: now().toISOString(), version, sessionId, platform: process.platform, arch: process.arch, osRelease: os.release(), runtime: process.version, packaged: !!process.pkg, retention: limits, invalidLines, ...diagnostics }), null, 2) });
    entries.push({ name: 'README.txt', data: 'SmarAgents WorkBuddy Relay local diagnostic logs.\nIncludes retained runs only (up to 30 days / 40 MiB).\nNo API keys, request/response bodies, WorkBuddy config copies or conversations are collected.\nMatch sessionId and operationId with the failure shown in the tool.\n' });
    const data = zipFiles(entries);
    record('logs.export.completed', { files: entries.length, bytes: data.length, invalidLines });
    return { data, filename: `workbuddy-relay-logs-${now().toISOString().replace(/[:.]/g, '-')}.zip` };
  }
  const logger = { sessionId, record, status, sanitize, exportBundle, addSecret: (s) => { if (typeof s === 'string' && s.trim().length >= 4) secrets.add(s.trim()); } };
  record('session.started', { platform: process.platform, arch: process.arch, runtime: process.version, packaged: !!process.pkg });
  return logger;
}

let shared;
export function getLogger(version) { return shared ||= createLogger({ version }); }

export function loggedFetch(fetchImpl, logger, operationId) {
  return async (url, init = {}) => {
    const started = Date.now(), u = new URL(url);
    const meta = { method: init.method || 'GET', host: u.host, endpoint: u.pathname };
    // Deliberately omit headers, request payload and response payload.
    try {
      const response = await fetchImpl(url, { ...init, redirect: 'error' });
      logger.record('network.response', { ...meta, status: response.status, durationMs: Date.now() - started, requestId: response.headers.get('x-request-id') || undefined }, response.ok ? 'info' : 'warn', operationId);
      return response;
    } catch (error) {
      logger.record('network.failed', { ...meta, durationMs: Date.now() - started, error }, 'error', operationId);
      throw error;
    }
  };
}
