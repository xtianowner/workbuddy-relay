/**
 * 本地网页模式：只监听 127.0.0.1 的随机端口，一次性 token 防止其它网页/程序调用。
 * 凭证（平台令牌、Key）只放在本进程内存里，不写盘、不打日志、不回传完整值给页面。
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { VERSION, normalizeBase, discoverModels, pickChatModels, maskKey } from './wb-core.mjs';
import { detectRelay, acquireCredentials, isInsecure, siteOrigin } from './wb-relay.mjs';
import { suggestEffort, familyOf, EFFORTS, EFFORT_LABEL } from './wb-reasoning.mjs';
import { runImport } from './wb-flow.mjs';
import { PAGE } from './wb-page.mjs';

export function startWebServer({ app, configPath, fetchImpl = fetch, idleMs = 30 * 60e3, quitAfterDoneMs = 120e3, onExit = (code) => process.exit(code), log = () => {} } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const s = { site: null, det: null, pat: null, key: null, base: null, keyName: null, done: false };
  let port = 0; let idle; let quitTimer;
  const bump = () => { clearTimeout(idle); idle = setTimeout(() => { log('长时间无操作，自动退出'); shutdown(0); }, idleMs); };
  const shutdown = (code = 0) => { if (code === 0) process.env.WB_NO_HOLD = '1'; clearTimeout(idle); clearTimeout(quitTimer); server.close(); s.pat = s.key = null; setTimeout(() => onExit(code), 50); };

  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(obj)); };
  const readBody = (req) => new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('bad json')); } });
  });

  const routes = {
    'GET /api/status': async () => ({ version: VERSION, app: { installed: app?.installed !== false, version: app?.version || null, running: !!app?.running }, efforts: EFFORTS.map((v) => ({ v, label: EFFORT_LABEL[v] })) }),
    'POST /api/site': async ({ site }) => {
      if (!siteOrigin(site || '')) throw new Error('地址看起来不对，请填写浏览器里打开中转站的网址');
      Object.assign(s, { site, pat: null, key: null, base: null, keyName: null });
      s.det = await detectRelay(site, fetchImpl);
      return { type: s.det.type, origin: s.det.origin, insecure: isInsecure(s.det.origin) };
    },
    'POST /api/keys': async ({ token: pat }) => {
      if (!s.site) throw new Error('请先填写站点地址');
      if (!pat) throw new Error('请粘贴平台令牌');
      let keys = [];
      await acquireCredentials({ site: s.site, platformToken: pat, type: s.det?.type === 'unknown' ? 'auto' : s.det?.type, choose: async (k) => { keys = k; throw Object.assign(new Error('LIST_ONLY'), { listOnly: true }); } }, fetchImpl)
        .catch((e) => { if (!e.listOnly) throw e; });
      s.pat = pat;
      return { keys: keys.map((k) => ({ id: k.id, name: k.name, masked: k.masked || '' })) };
    },
    'POST /api/use-key': async ({ keyId, key }) => {
      if (!s.site) throw new Error('请先填写站点地址');
      if (key) { s.key = key.trim(); s.base = normalizeBase(s.site); s.keyName = '手动粘贴'; }
      else {
        if (!s.pat) throw new Error('请先用平台令牌读取 Key 列表');
        const got = await acquireCredentials({ site: s.site, platformToken: s.pat, type: s.det?.type === 'unknown' ? 'auto' : s.det?.type, choose: async () => (keyId === 'new' ? 'new' : keyId) }, fetchImpl);
        s.key = got.apiKey; s.base = got.baseUrl; s.keyName = got.keyName;
      }
      const found = await discoverModels(s.base, s.key);
      if (found.fatal) { s.key = null; throw new Error(`读取模型列表失败：${found.fatal}`); }
      s.base = found.base;
      const ids = pickChatModels(found.ids, 500);
      return { keyName: s.keyName, masked: maskKey(s.key), base: s.base, models: ids.map((id, i) => ({ id, family: familyOf(id), suggest: suggestEffort(id), checked: i < 12 })) };
    },
    'POST /api/import': async ({ models }) => {
      if (!s.key) throw new Error('请先选择 Key');
      const list = (Array.isArray(models) ? models : []).filter((m) => m && typeof m.id === 'string' && m.id.trim()).map((m) => ({ id: m.id.trim(), effort: EFFORTS.includes(m.effort) ? m.effort : 'off' }));
      if (!list.length) throw new Error('请至少勾选一个模型');
      const r = await runImport({ base: s.base, key: s.key, models: list, configPath, fetchImpl });
      if (r.ok) { s.done = true; quitTimer = setTimeout(() => { log('导入完成，自动退出'); shutdown(0); }, quitAfterDoneMs); }
      const { preview, ...rest } = r; // eslint-disable-line no-unused-vars
      return rest;
    },
    'POST /api/quit': async () => { setTimeout(() => shutdown(0), 100); return { bye: true }; },
  };

  const server = http.createServer(async (req, res) => {
    bump();
    const host = req.headers.host || '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, { error: 'bad host' }); // 防 DNS rebinding
    const u = new URL(req.url, `http://${host}`);
    if (req.method === 'GET' && u.pathname === '/') {
      if (u.searchParams.get('t') !== token) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('链接已失效：请重新双击程序打开'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:", 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
      return res.end(PAGE.replace('__WB_TOKEN__', token).replace(/__WB_VERSION__/g, VERSION));
    }
    const route = routes[`${req.method} ${u.pathname}`];
    if (!route) return send(res, 404, { error: 'not found' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(res, 403, { error: 'bad origin' });
    if (req.headers['x-wb-token'] !== token) return send(res, 403, { error: 'bad token' });
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'json only' });
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      send(res, 200, await route(body));
    } catch (e) { send(res, 400, { error: String(e.message || e) }); }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port; bump();
      resolve({ url: `http://127.0.0.1:${port}/?t=${token}`, port, token, close: () => shutdown(0), server });
    });
  });
}
