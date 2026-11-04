/** Local-only UI. One fixed platform, one API key, authenticated diagnostic downloads. */
import http from 'node:http';
import crypto from 'node:crypto';
import { VERSION, PROTOCOLS, assertClientProtocol, discoverModels, pickChatModels } from './wb-core.mjs';
import { PLATFORM_NAME, PLATFORM_SITE, PLATFORM_BASE } from './wb-brand.mjs';
import { familyOf, EFFORTS, EFFORT_LABEL } from './wb-reasoning.mjs';
import { getLogger } from './wb-logs.mjs';
import { runImport } from './wb-flow.mjs';
import { PAGE } from './wb-page.mjs';

export function startWebServer({ app, configPath, fetchImpl = fetch, idleMs = 30 * 60e3, onExit = (code) => process.exit(code), log = () => {}, logger = getLogger(VERSION), importOptions = {} } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const state = { key: null, models: [], importing: false, changingKey: false, importJob: null };
  let port = 0, idle, closing = false;
  const bump = () => { clearTimeout(idle); idle = setTimeout(() => { if (state.importing || state.changingKey) return bump(); logger.record('session.idle'); shutdown(); }, idleMs); };
  const shutdown = (code = 0) => {
    if (closing) return; closing = true;
    process.env.WB_NO_HOLD = '1'; clearTimeout(idle); state.key = null;
    logger.record('session.closed', { code }); server.close();
    setTimeout(() => onExit(code), 50).unref();
  };
  const fail = (message, code, status = 400) => Object.assign(new Error(message), { code, status });
  const send = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const clean = (value) => typeof value === 'string'
      ? value.replace(/https?:\/\/[^\s<>"'）]+/gi, '[服务地址]').replace(/中转站/g, '服务')
      : Array.isArray(value) ? value.map(clean)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)])) : value;
    res.end(JSON.stringify(clean(logger.sanitize(obj))));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let body = '', bytes = 0;
    req.on('error', reject);
    req.on('data', (chunk) => { bytes += chunk.length; if (bytes > 128 * 1024) { reject(fail('请求过大', 'BODY_TOO_LARGE', 413)); } else body += chunk; });
    req.on('end', () => {
      try { const parsed = body ? JSON.parse(body) : {}; if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); resolve(parsed); }
      catch { reject(fail('请求格式不正确', 'BAD_JSON')); }
    });
  });
  const uiEvents = new Set(['key.changed', 'selection.all', 'selection.none', 'model.toggle', 'model.effort', 'model.bulk', 'page.error']);
  const routes = {
    'GET /api/status': async () => ({ version: VERSION, app: { installed: app?.installed !== false, version: app?.version || null, running: !!app?.running }, efforts: EFFORTS.map((v) => ({ v, label: EFFORT_LABEL[v] })), logs: logger.status() }),
    'GET /api/logs': async () => logger.status(),
    'GET /api/import-status': async ({ jobId }) => {
      const job = state.importJob;
      if (!job || (jobId && job.id !== jobId)) throw fail('导入任务不存在或已过期', 'IMPORT_JOB_NOT_FOUND', 404);
      return { jobId: job.id, operationId: job.operationId, status: job.status, phase: job.phase, rows: [...job.rows.values()], result: job.result, error: job.error };
    },
    'POST /api/events': async ({ event, model, effort, checked, count }) => {
      if (!uiEvents.has(event)) throw fail('不支持的操作', 'INVALID_EVENT');
      logger.record(`ui.${event}`, { model: state.models.includes(model) ? model : undefined, effort: EFFORTS.includes(effort) ? effort : undefined, checked: typeof checked === 'boolean' ? checked : undefined, count: Number.isInteger(count) && count >= 0 && count <= 500 ? count : undefined });
      return { ok: true };
    },
    'POST /api/use-key': async ({ key }, operationId) => {
      if (state.importing || state.changingKey) throw fail('正在处理上一个操作，请稍候', 'BUSY', 409);
      state.key = null; state.models = [];
      if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /\s/.test(key.trim())) throw fail('请粘贴完整的 API Key', 'INVALID_KEY');
      const value = key.trim(); logger.addSecret(value);
      state.changingKey = true;
      logger.record('key.submitted', { present: true }, 'info', operationId);
      try {
        const found = await discoverModels(PLATFORM_BASE, value, 15000, { fetchImpl, logger, operationId });
        if (found.fatal) throw fail(`读取模型列表失败：${found.fatal}`, 'MODEL_DISCOVERY_FAILED');
        const ids = [...new Set(pickChatModels(found.ids, 500))];
        if (!ids.length) throw fail('此 Key 下没有可导入的模型，请确认平台模型权限', 'NO_MODELS');
        state.key = value; state.models = ids;
        logger.record('models.discovered', { count: ids.length, models: ids }, 'info', operationId);
        return { models: ids.map((id, i) => ({ id, family: familyOf(id), suggest: 'auto', checked: i < 12, capability: found.capabilities?.[id] || null })), operationId };
      } finally { state.changingKey = false; }
    },
    'POST /api/import': async ({ models, protocol = 'auto' }, operationId) => {
      if (state.importing || state.changingKey) throw fail('正在处理上一个操作，请稍候', 'BUSY', 409);
      if (!state.key) throw fail('请先填写 Key 并读取模型', 'KEY_REQUIRED');
      if (app?.installed === false && !app?.configExists) throw fail('请先安装 WorkBuddy，然后重新打开本工具', 'WORKBUDDY_NOT_INSTALLED');
      if (!PROTOCOLS.includes(protocol)) throw fail('协议选择无效', 'INVALID_PROTOCOL');
      if (!Array.isArray(models) || !models.length || models.length > 500 || models.some((m) => !state.models.includes(m?.id) || !EFFORTS.includes(m?.effort) || (m?.protocol && !PROTOCOLS.includes(m.protocol)))) throw fail('请从列表中选择模型、协议和思考强度', 'INVALID_MODELS');
      const list = [...new Map(models.map((m) => [m.id, { id: m.id, effort: m.effort, protocol: m.protocol || protocol }])).values()];
      assertClientProtocol(protocol);
      list.forEach(model => assertClientProtocol(model.protocol));
      const job = { id: crypto.randomUUID(), operationId, status: 'running', phase: 'availability', rows: new Map(list.map((m) => [m.id, { id: m.id, effortWanted: m.effort, effort: 'unknown', usable: true, phase: 'queued', status: 'queued', note: '' }])), result: null, error: null };
      state.importing = true; state.importJob = job;
      // Start immediately but return the job id so the browser can render each model as it finishes.
      void runImport({ ...importOptions, base: PLATFORM_BASE, key: state.key, protocol, models: list, configPath, fetchImpl, logger, operationId,
        onProgress: (row) => { const previous = job.rows.get(row.id) || {}; job.rows.set(row.id, { ...previous, ...row }); job.phase = row.phase || (row.status === 'testing' ? 'testing' : job.phase); },
      }).then(({ preview, ...result }) => { job.status = 'completed'; job.phase = 'complete'; job.result = result; state.importing = false; })
        .catch((error) => { job.status = 'failed'; job.phase = error.stage || 'failed'; job.error = { message: error.message, code: error.code || 'IMPORT_FAILED' }; state.importing = false; });
      return { jobId: job.id, operationId, status: job.status, phase: job.phase, rows: [...job.rows.values()] };
    },
    'POST /api/quit': async () => {
      if (state.importing || state.changingKey) throw fail('操作尚未完成，请稍候', 'BUSY', 409);
      setTimeout(() => shutdown(), 100); return { bye: true };
    },
  };
  const server = http.createServer(async (req, res) => {
    bump();
    const host = req.headers.host || '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, { error: 'bad host' });
    const u = new URL(req.url, `http://${host}`);
    if (req.method === 'GET' && u.pathname === '/') {
      if (u.searchParams.get('t') !== token) return send(res, 403, { error: '链接已失效，请重新双击程序打开' });
      logger.record('ui.opened');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
      return res.end(PAGE.replace('__WB_TOKEN__', token).replace(/__WB_VERSION__/g, VERSION));
    }
    const origin = req.headers.origin;
    if ((origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) || req.headers['x-wb-token'] !== token) {
      logger.record('http.rejected', { method: req.method, endpoint: u.pathname }, 'warn');
      return send(res, 403, { error: '请求未授权' });
    }
    const route = routes[`${req.method} ${u.pathname}`];
    const exporting = req.method === 'POST' && u.pathname === '/api/logs/export';
    if (!route && !exporting) return send(res, 404, { error: 'not found' });
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'json only' });
    const operationId = crypto.randomUUID(), started = Date.now();
    logger.record('operation.started', { method: req.method, endpoint: u.pathname }, 'info', operationId);
    try {
      const body = req.method === 'POST' ? await readBody(req) : Object.fromEntries(u.searchParams.entries());
      if (exporting) {
        const bundle = logger.exportBundle({ workbuddy: { installed: app?.installed, version: app?.version, running: app?.running }, importInProgress: state.importing });
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${bundle.filename}"`, 'Content-Length': bundle.data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(bundle.data);
      } else send(res, 200, await route(body, operationId));
      logger.record('operation.completed', { endpoint: u.pathname, durationMs: Date.now() - started }, 'info', operationId);
    } catch (error) {
      logger.record('operation.failed', { endpoint: u.pathname, error, stage: error.stage, durationMs: Date.now() - started }, 'error', operationId);
      send(res, error.status || 400, { error: error.message, code: error.code || 'OPERATION_FAILED', operationId });
    }
  });
  server.headersTimeout = 10000; server.requestTimeout = 30000;
  server.on('close', () => { clearTimeout(idle); state.key = null; });
  return new Promise((resolve, reject) => {
    server.once('error', (error) => { logger.record('server.failed', { error }, 'error'); reject(error); });
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port; bump(); logger.record('server.started', { port }); log('本地日志已启用，可在页面一键导出');
      resolve({ url: `http://127.0.0.1:${port}/?t=${token}`, port, token, close: () => shutdown(), server });
    });
  });
}
