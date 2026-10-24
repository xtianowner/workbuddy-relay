// 本地模拟 new-api（:18081）和 sub2api（:18082），只实现 wb-relay / wb-core 用到的接口，返回结构按 MaaS 确认的 rc.46 行为
import http from 'node:http';
const MODELS = ['gpt-5.5', 'claude-sonnet-4', 'text-embedding-3-small', 'broken-model', 'deepseek-v3.1', 'claude-*', 'gpt-*', 'codex-*'];
const HTML = (res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><body>SPA</body></html>'); };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); });
function relay(req, res, keys, b) {
  // 模拟 sub2api 真机行为：根路径 /models 也返回 JSON 列表，但 /chat/completions 等非 /v1 路径落到前端页面（HTML 200）
  if (req.url === '/models') return relay(Object.assign(req, { url: '/v1/models' }), res, keys, b);
  if (req.method === 'POST' && !req.url.startsWith('/v1/') && !req.url.startsWith('/api/')) return HTML(res), true;
  if (!req.url.startsWith('/v1/')) return false;
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!keys().includes(auth)) return send(res, 401, { error: { message: 'invalid key' } }), true;
  if (req.url === '/v1/models') return send(res, 200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) }), true;
  if (req.url === '/v1/chat/completions') {
    if (b.model === 'broken-model') return send(res, 503, { error: { message: 'no channel' } }), true;
    // 思考强度行为：gpt-5.5 支持 reasoning_effort；claude-sonnet-4 拒绝（测降级）；deepseek-v3.1 只认 thinking:{type:'enabled'}
    const wantsThink = b.reasoning_effort !== undefined || b.thinking !== undefined;
    if (wantsThink && b.model === 'claude-sonnet-4') return send(res, 400, { error: { message: 'Unrecognized request argument supplied: reasoning_effort' } }), true;
    if (b.reasoning_effort !== undefined && b.model === 'deepseek-v3.1') return send(res, 400, { error: { message: 'reasoning_effort not supported' } }), true;
    const think = (b.model === 'gpt-5.5' && b.reasoning_effort) || (b.model === 'deepseek-v3.1' && b.thinking?.type === 'enabled');
    return send(res, 200, { id: 'x', choices: [{ message: { role: 'assistant', content: 'p', ...(think ? { reasoning_content: '…' } : {}) } }], usage: { completion_tokens: 3, completion_tokens_details: { reasoning_tokens: think ? 12 : 0 } } }), true;
  }
  return false;
}
// ---- new-api ----
const na = { tokens: [{ id: 1, name: 'default', status: 1, key: 'AAAAdefault0001' }, { id: 2, name: 'old', status: 3, key: 'BBBBexpired0002' }], next: 3 };
const PAT = 'nap_testpat';
http.createServer(async (req, res) => {
  const b = await body(req); const u = new URL(req.url, 'http://x');
  process.stderr.write(`[new-api] ${req.method} ${req.url}\n`);
  if (u.pathname === '/api/status') return send(res, 200, { success: true, data: { system_name: 'New API', version: 'v1.0.0-rc.46' } });
  if (relay(req, res, () => na.tokens.filter((t) => t.status === 1).map((t) => `sk-${t.key}`), b)) return;
  if (u.pathname.startsWith('/api/')) {
    if (req.headers.authorization !== `Bearer ${PAT}`) return send(res, 401, { success: false, message: '无权进行此操作，令牌无效' });
    if (req.method === 'GET' && u.pathname === '/api/token/') return send(res, 200, { success: true, message: '', data: { page: 1, page_size: Number(u.searchParams.get('page_size')), total: na.tokens.length, items: na.tokens.map((t) => ({ ...t, key: `${t.key.slice(0, 4)}**********${t.key.slice(-4)}` })) } });
    if (req.method === 'POST' && u.pathname === '/api/token/') { na.tokens.push({ id: na.next, name: b.name, status: 1, key: `NEWK${na.next}${Math.random().toString(36).slice(2, 12)}` }); na.next++; return send(res, 200, { success: true, message: '' }); }
    const m = u.pathname.match(/^\/api\/token\/(\d+)\/key$/);
    if (req.method === 'POST' && m) { const t = na.tokens.find((x) => x.id === +m[1]); return t ? send(res, 200, { success: true, data: { key: t.key } }) : send(res, 200, { success: false, message: 'not found' }); }
  }
  HTML(res);
}).listen(18081);
// ---- sub2api ----
const s2 = { keys: [{ id: 11, name: 'my-claude', key: 'sk-s2existing11', status: 'active', group_id: 1 }], next: 12 };
const JWT = 'eyJ.test.jwt';
http.createServer(async (req, res) => {
  const b = await body(req); const u = new URL(req.url, 'http://x');
  process.stderr.write(`[sub2api] ${req.method} ${req.url}\n`);
  if (u.pathname === '/api/v1/settings/public') return send(res, 200, { code: 0, message: 'success', data: { site_name: 'Sub2API' } });
  if (relay(req, res, () => s2.keys.map((k) => k.key), b)) return;
  if (u.pathname.startsWith('/api/v1/')) {
    if (req.headers.authorization !== `Bearer ${JWT}`) return send(res, 401, { code: 401, message: 'unauthorized' });
    if (req.method === 'GET' && u.pathname === '/api/v1/keys') return send(res, 200, { code: 0, message: 'success', data: { items: s2.keys, total: s2.keys.length, page: 1, page_size: 100 } });
    if (req.method === 'POST' && u.pathname === '/api/v1/keys') { const k = { id: s2.next++, name: b.name, key: `sk-s2new${Date.now()}`, status: 'active', group_id: 1 }; s2.keys.push(k); return send(res, 200, { code: 0, message: 'success', data: k }); }
  }
  HTML(res);
}).listen(18082);
console.log('mock relays up: new-api :18081  sub2api :18082');
