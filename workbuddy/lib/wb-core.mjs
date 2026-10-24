/**
 * wb-core —— 与平台无关的核心逻辑
 *   · URL 归一化 / 模型发现 / 连通性探测
 *   · models.json 读取、合并、写入
 *
 * 关于 WorkBuddy 侧的事实（均已在应用代码与实机中核对）：
 *   1. 配置真源 ~/.workbuddy/models.json，允许裸数组或 { models, availableModels }
 *   2. 应用 fs.watch 监听该文件，1s 防抖后 ProductManager.sync() —— 写完即生效，不必重启
 *   3. 模型 url 必须是完整端点 .../chat/completions（除非 useCustomProtocol = true）
 *   4. 运行时模型 id 会被改写成 custom-local:<id>，并打上 custom 标签
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const VERSION = '2.2.0';
export const DEFAULT_INPUT_TOKENS = 200000;
export const DEFAULT_OUTPUT_TOKENS = 8192;
const UA = `wb-setup/${VERSION}`;

/* ---------------- URL ---------------- */

export function normalizeBase(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  s = s.split('#')[0].split('?')[0];
  s = s.replace(/\/+$/, '');
  // 去掉误带的端点
  for (;;) {
    const t = s.replace(/\/(chat\/completions|completions|models|responses|messages)$/i, '').replace(/\/+$/, '');
    if (t === s) break; s = t;
  }
  // 始终规范为 <站点>/v1：sub2api 等在根路径也挂了 /models（JSON），但 /chat/completions 落到前端页面（HTML 200），
  // 不能靠「先试根路径」来猜，必须固定带 /v1（v2.0.1 修复）
  if (!/\/v\d+[a-z]*$/i.test(s)) s = `${s}/v1`;
  return s;
}

/** v2.0.1 起 base 已规范化，只有一个候选；保留函数以兼容旧调用 */
export function candidates(base) {
  return [base];
}

export const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };
export const maskKey = (s) => (!s ? '' : s.length <= 10 ? '***' : `${s.slice(0, 5)}…${s.slice(-4)}`);

/* ---------------- 网络 ---------------- */

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} 超时 ${ms}ms`)), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

const authHeaders = (key) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  'User-Agent': UA,
});

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/** 拉模型列表，兼容 {data:[{id}]} / {models:[{id}]} / {models:["id"]} / ["id"]（New API / One API 均为第一种） */
export async function discoverModels(base, key, timeoutMs = 15000) {
  const tried = [];
  for (const b of candidates(base)) {
    const url = `${b}/models`;
    tried.push(url);
    try {
      const res = await withTimeout(fetch(url, { headers: authHeaders(key) }), timeoutMs, 'GET /models');
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { fatal: `鉴权失败 (HTTP ${res.status})：Key 无效或无权限`, body: text.slice(0, 200), tried };
        }
        continue;
      }
      let json;
      try { json = JSON.parse(text); } catch { continue; }
      const ids = extractIds(json);
      if (ids.length) return { base: b, ids, tried };
    } catch { /* 换下一个候选 */ }
  }
  return { fatal: '无法从 /models 获取模型列表（该站点可能未实现此接口）', tried };
}

export function extractIds(json) {
  const arr = Array.isArray(json) ? json
    : Array.isArray(json?.data) ? json.data
      : Array.isArray(json?.models) ? json.models : [];
  return arr.map((x) => (typeof x === 'string' ? x : x?.id)).filter((x) => typeof x === 'string' && x.trim());
}

/** 一次极小请求：同时验证 Key、端点路径、模型可用性 */
export async function probe(base, key, model, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(key),
      signal: ctrl.signal,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
    });
    const text = await res.text();
    if (res.ok) return validateChatResponse(res.headers.get('content-type'), text);
    if (res.status === 401 || res.status === 403) return { ok: false, fatal: `鉴权失败 (HTTP ${res.status})`, body: text.slice(0, 160) };
    return { ok: false, reason: `HTTP ${res.status}`, body: text.slice(0, 160) };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? '超时' : String(e.message).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

/** 严格校验：2xx 还不够，必须是 JSON 且含 choices 数组（HTML 200 = 打到了前端页面） */
export function validateChatResponse(contentType, text) {
  const ct = String(contentType || '').toLowerCase();
  if (!ct.includes('json')) return { ok: false, reason: `非 JSON 响应（${ct || '无 content-type'}，地址可能指向网页）`, body: text.slice(0, 80) };
  let j; try { j = JSON.parse(text); } catch { return { ok: false, reason: '响应不是合法 JSON', body: text.slice(0, 80) }; }
  if (!Array.isArray(j?.choices)) return { ok: false, reason: '响应缺少 choices', body: text.slice(0, 120) };
  return { ok: true };
}

/** 只知道模型名、还不知道要不要 /v1 时用它定 base */
export async function resolveBaseByProbe(base0, key, model) {
  const errs = [];
  for (const c of candidates(base0)) {
    const r = await probe(c, key, model);
    if (r.ok) return { base: c };
    if (r.fatal) return { fatal: r.fatal };
    errs.push(`${c}/chat/completions → ${r.reason}${r.body ? ` ${r.body}` : ''}`);
  }
  return { error: errs.join('\n  ') };
}

/* ---------------- 配置 ---------------- */

export function defaultConfigPath(explicit) {
  if (explicit) return path.resolve(explicit.replace(/^~(?=$|\/)/, os.homedir()));
  const dir = process.env.WORKBUDDY_CONFIG_DIR || path.join(os.homedir(), '.workbuddy');
  return path.join(dir, 'models.json');
}

export function readConfig(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return { shape: 'array', models: [], availableModels: undefined };
    const json = JSON.parse(raw);
    if (Array.isArray(json)) return { shape: 'array', models: json, availableModels: undefined };
    return {
      shape: 'object',
      models: Array.isArray(json.models) ? json.models : [],
      availableModels: Array.isArray(json.availableModels) ? json.availableModels : undefined,
      other: json,
    };
  } catch (e) {
    if (e.code === 'ENOENT') return { shape: 'array', models: [], availableModels: undefined };
    throw new Error(`现有 ${file} 不是合法 JSON，先修好再导入：${e.message}`);
  }
}

export function buildEntry(id, base, key, { vendor = 'Custom', prefix = '', owner = '', inputTokens, outputTokens, supportsImages = false, supportsReasoning = false, extra = {} } = {}) {
  return {
    id,
    name: prefix ? `${prefix}${id}` : id,
    vendor,
    url: `${base}/chat/completions`,
    apiKey: key,
    maxInputTokens: inputTokens || DEFAULT_INPUT_TOKENS,
    maxOutputTokens: outputTokens || DEFAULT_OUTPUT_TOKENS,
    supportsToolCall: true,
    supportsImages,
    supportsReasoning,
    useCustomProtocol: false,
    ...(owner ? { wbImportOwner: owner } : {}),
    ...extra,
  };
}

export function mergeModels(existing, incoming, base, owner, prune) {
  let result = [...existing];
  const added = [], updated = [], skipped = [], pruned = [];
  const host = hostOf(base);
  // 自动修复 v2.0.0 及更早写入的坏条目（仅限本工具写入的、同站点的）：通配符 id、url 缺 /vN（指向网页）
  const broken = (x) => x && owner && String(x.wbImportOwner || '').startsWith('wb-setup') && hostOf(x.url || '') === host
    && (/[*?]/.test(x.id) || !/\/v\d+[a-z]*\/chat\/completions$/i.test(x.url || ''));
  const fresh = new Set(incoming.map((m) => m.id));
  result = result.filter((x) => { if (broken(x) && !fresh.has(x.id)) { pruned.push(x.id); return false; } return true; });
  if (prune && owner) {
    const keep = new Set(incoming.map((m) => m.id));
    result = result.filter((x) => {
      const mine = x && x.wbImportOwner === owner && !keep.has(x.id);
      if (mine) pruned.push(x.id);
      return !mine;
    });
  }
  for (const m of incoming) {
    const hit = result.findIndex((x) => x && x.id === m.id && hostOf(x.url || '') === host);
    if (hit >= 0) { result[hit] = { ...result[hit], ...m }; updated.push(m.id); }
    else if (result.some((x) => x && x.id === m.id)) skipped.push(`${m.id}(同名但属于其它站点，已跳过)`);
    else { result.push(m); added.push(m.id); }
  }
  return { models: result, added, updated, skipped, pruned };
}

/**
 * 写盘。
 * Windows：rename 可能被占用/杀软挡住，改为原地覆盖 + 重试；
 * 其它平台：tmp + rename 原子替换（实测同样能触发 WorkBuddy 的 1s 热重载）。
 */
export function writeConfig(file, cfg, models, availableModels) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    backup = `${file}.bak.${stamp}`;
    fs.copyFileSync(file, backup);
  }
  const payload = cfg.shape === 'array'
    ? models
    : { ...(cfg.other || {}), models, ...(availableModels ? { availableModels } : {}) };
  const body = `${JSON.stringify(payload, null, 2)}\n`;

  if (process.platform === 'win32') {
    writeWithRetry(file, body);
  } else {
    const tmp = `${file}.writing`;
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  try { fs.chmodSync(file, 0o600); } catch { /* Windows 无此语义 */ }
  return { backup };
}

function writeWithRetry(file, body, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.writeFileSync(file, body);
      return;
    } catch (e) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code) || i === attempts - 1) throw e;
      const until = Date.now() + 150;
      while (Date.now() < until) { /* 短暂等待，避开杀软/索引占用 */ }
    }
  }
}

/** 过滤掉明显不是聊天模型的 id */
export function pickChatModels(ids, max = 12) {
  const nonChat = /embed|rerank|tts|whisper|dall|stable-diffusion|moderation|image|audio|video|davinci|babbage|ocr|vl-ocr/i;
  const real = ids.filter((id) => !/[*?]/.test(id)); // 通配符条目（claude-*、gpt-*）是分组规则，不是可调用的模型
  const chatty = real.filter((id) => !nonChat.test(id));
  return (chatty.length ? chatty : real).slice(0, max);
}

/** 读应用合并后的配置缓存，确认模型真的被 WorkBuddy 接受 */
export function findMergedModel(homeDir, modelId) {
  const cacheDir = path.join(homeDir, '.workbuddy', 'cache');
  let names = [];
  try { names = fs.readdirSync(cacheDir).filter((n) => /^acc-product-config-v\d+\.json$/.test(n)); } catch { return { checked: false }; }
  for (const name of names) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(cacheDir, name), 'utf8'));
      const models = Array.isArray(data.models) ? data.models : [];
      const hit = models.find((m) => typeof m?.id === 'string' && (m.id === modelId || m.id === `custom-local:${modelId}`));
      if (hit) return { checked: true, found: true, entry: hit, file: path.join(cacheDir, name), total: models.length };
    } catch { /* 缓存写到一半，忽略 */ }
  }
  return { checked: names.length > 0, found: false };
}
