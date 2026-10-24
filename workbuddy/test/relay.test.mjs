import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRelay, acquireCredentials, siteOrigin, isInsecure } from '../lib/wb-relay.mjs';

const mk = (routes) => async (url, opt = {}) => {
  const k = `${opt.method || 'GET'} ${new URL(url).pathname}`;
  const h = routes[k];
  if (!h) return new Response('{}', { status: 404 });
  const [status, body] = typeof h === 'function' ? h(opt) : h;
  return new Response(JSON.stringify(body), { status });
};
const NA = { 'GET /api/status': [200, { success: true, data: { system_name: 'New API' } }] };
const S2 = { 'GET /api/v1/settings/public': [200, { code: 0, message: 'success', data: {} }] };

test('siteOrigin / isInsecure', () => {
  assert.equal(siteOrigin('a.com/v1/chat/completions'), 'https://a.com');
  assert.equal(isInsecure('http://a.com'), true);
  assert.equal(isInsecure('http://localhost:3000'), false);
});

test('平台识别', async () => {
  assert.equal((await detectRelay('n.com', mk(NA))).type, 'newapi');
  assert.equal((await detectRelay('s.com', mk(S2))).type, 'sub2api');
  assert.equal((await detectRelay('x.com', mk({}))).type, 'unknown');
  assert.equal((await detectRelay('x.com', mk({}), 'nap_1')).type, 'newapi');
});

test('new-api：默认复用同名 Key，完整 key 走 reveal 并补 sk-', async () => {
  const f = mk({ ...NA,
    'GET /api/token/': [200, { success: true, data: { page: 1, page_size: 100, total: 3, items: [{ id: 3, name: 'other', status: 1, key: 'ab**cd' }, { id: 5, name: 'WorkBuddy-old', status: 3, key: 'ab**cd' }, { id: 7, name: 'WorkBuddy-2610ab', status: 1, key: 'ab**cd' }] } }],
    'POST /api/token/7/key': [200, { success: true, data: { key: 'REAL7' } }],
  });
  const r = await acquireCredentials({ site: 'http://n.com', platformToken: 'nap_x' }, f);
  assert.deepEqual([r.baseUrl, r.apiKey, r.keyName], ['http://n.com/v1', 'sk-REAL7', 'WorkBuddy-2610ab']);
});

test('new-api：用户选择指定 Key / 新建', async () => {
  let made = null;
  const f = mk({ ...NA,
    'GET /api/token/': (o) => [200, { success: true, data: { page: 1, page_size: 100, total: 2, items: [{ id: 3, name: 'other', status: 1 }, { id: 8, name: 'WorkBuddy', status: 2 }, ...(made ? [{ id: 9, name: made, status: 1 }] : [])] } }],
    'POST /api/token/': (o) => { const b = JSON.parse(o.body); assert.match(b.name, /^WorkBuddy-\w+$/); assert.ok(b.name.length <= 50); assert.equal(b.unlimited_quota, true); assert.equal(b.expired_time, -1); assert.equal(b.group, undefined); made = b.name; return [200, { success: true, message: '' }]; },
    'POST /api/token/3/key': [200, { success: true, data: { key: 'K3' } }],
    'POST /api/token/9/key': [200, { success: true, data: { key: 'K9' } }],
  });
  assert.equal((await acquireCredentials({ site: 'n.com', platformToken: 'nap_x', choose: async (ks) => { assert.equal(ks.length, 1); return 3; } }, f)).apiKey, 'sk-K3');
  assert.equal((await acquireCredentials({ site: 'n.com', platformToken: 'nap_x', choose: async () => 'new' }, f)).apiKey, 'sk-K9');
});

test('new-api：被拒→取 /api/user/self id→带 New-Api-User 重试', async () => {
  const seen = [];
  const ok = (o) => o.headers['New-Api-User'] === '42';
  const f = mk({ ...NA,
    'GET /api/token/': (o) => { seen.push(o.headers['New-Api-User'] || '-'); return ok(o) ? [200, { success: true, data: [{ id: 1, name: 'WorkBuddy', status: 1 }] }] : [200, { success: false, message: '无权进行此操作，未提供 New-Api-User' }]; },
    'GET /api/user/self': [200, { success: true, data: { id: 42 } }],
    'POST /api/token/1/key': (o) => (ok(o) ? [200, { success: true, data: { key: 'sk-K1' } }] : [401, {}]),
  });
  assert.equal((await acquireCredentials({ site: 'n.com', platformToken: 'nap_x' }, f)).apiKey, 'sk-K1');
  assert.deepEqual(seen, ['-', '42']);
});

test('new-api：缺 reveal 权限报 AUTH', async () => {
  const f = mk({ ...NA,
    'GET /api/token/': [200, { success: true, data: [{ id: 1, name: 'WorkBuddy', status: 1 }] }],
    'GET /api/user/self': [200, { success: true, data: { id: 1 } }],
    'POST /api/token/1/key': [403, { success: false, message: 'scope api_key:reveal required' }],
  });
  await assert.rejects(acquireCredentials({ site: 'n.com', platformToken: 'nap_x' }, f), (e) => e.code === 'AUTH');
});

test('sub2api：列表选 Key / 无 Key 时新建 / 401', async () => {
  const f = mk({ ...S2, 'GET /api/v1/keys': [200, { code: 0, data: { items: [{ id: 1, name: 'mine', key: 'sk-s2', status: 'active' }] } }] });
  assert.equal((await acquireCredentials({ site: 's.com', platformToken: 'jwt' }, f)).apiKey, 'sk-s2');
  let made = false;
  const g = mk({ ...S2,
    'GET /api/v1/keys': () => [200, { code: 0, data: { items: made ? [{ id: 5, name: 'WorkBuddy', key: 'sk-new', status: 'active' }] : [] } }],
    'POST /api/v1/keys': () => { made = true; return [200, { code: 0, data: { id: 5, name: 'WorkBuddy', key: 'sk-new', status: 'active' } }]; },
  });
  assert.equal((await acquireCredentials({ site: 's.com', platformToken: 'jwt' }, g)).apiKey, 'sk-new');
  await assert.rejects(acquireCredentials({ site: 's.com', platformToken: 'jwt' }, mk({ ...S2, 'GET /api/v1/keys': [401, {}] })), (e) => e.code === 'AUTH');
});

test('缺凭证报 NEED_TOKEN（界面引导用户去复制或粘贴）', async () => {
  await assert.rejects(acquireCredentials({ site: 's.com' }, mk(S2)), (e) => e.code === 'NEED_TOKEN' && e.relayType === 'sub2api');
});

import { uniqueName } from '../lib/wb-relay.mjs';
test('uniqueName ≤50 字符且带后缀', () => {
  const n = uniqueName('x'.repeat(80), new Date('2026-10-24T00:00:00Z'), () => 0.123456);
  assert.equal(n.length, 50); assert.match(n, /-261024\w{4}$/);
});
test('new-api 列表请求使用 p + page_size', async () => {
  let q;
  const f = async (url, o) => { const u = new URL(url); if (u.pathname === '/api/token/') { q = u.search; return new Response(JSON.stringify({ success: true, data: { items: [{ id: 1, name: 'WorkBuddy', status: 1 }] } })); }
    if (u.pathname === '/api/token/1/key') return new Response(JSON.stringify({ success: true, data: { key: 'z' } }));
    if (u.pathname === '/api/status') return new Response(JSON.stringify({ success: true, data: {} })); return new Response('{}', { status: 404 }); };
  await acquireCredentials({ site: 'n.com', platformToken: 'nap_x' }, f);
  assert.equal(q, '?p=1&page_size=100');
});
