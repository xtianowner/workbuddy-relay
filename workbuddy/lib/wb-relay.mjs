/**
 * wb-relay —— 用 new-api / sub2api 现有的用户侧接口拿 base url + API Key（平台零改造）
 *
 * 两平台本来就让用户在网页上复制「端点 + Key」，这里只是把这一步自动化：
 *   用户给 站点地址 + 一个现有凭证 → 列出已有 Key 让用户选，或新建一个 → 交给 wb-core 导入 WorkBuddy
 *   new-api : Authorization: Bearer nap_xxx（个人访问令牌，权限 api_key:read / api_key:reveal / api_key:write）
 *   sub2api : Authorization: Bearer <登录 access_token>
 * 不想给凭证的用户：直接 --url + --key 手动粘贴（v1 流程）。
 */
const UA = 'wb-relay/2.0';
export const DEFAULT_KEY_NAME = 'WorkBuddy';

const json = async (res) => { try { return await res.json(); } catch { return null; } };
export const siteOrigin = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).origin; } catch { return null; } };
export const isInsecure = (u) => /^http:\/\//i.test(u || '') && !/^http:\/\/(localhost|127\.|\[::1\])/i.test(u);
const authErr = (msg) => Object.assign(new Error(msg), { code: 'AUTH' });

async function req(f, url, { method = 'GET', token, body, headers = {}, timeoutMs = 10000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await f(url, {
      method, signal: ctl.signal, body: body ? JSON.stringify(body) : undefined,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    });
    return { status: res.status, data: await json(res) };
  } catch (e) { return { status: 0, data: null, error: e.message }; } finally { clearTimeout(t); }
}

/** base url 统一为 <origin>/v1（wb-core 再拼 /chat/completions） */
export const baseOf = (origin) => `${origin}/v1`;

/** 平台识别：只用公开免登录接口；识别不出时按凭证前缀猜（nap_ → new-api） */
export async function detectRelay(site, f = fetch, platformToken = '') {
  const origin = siteOrigin(site);
  if (!origin) return { type: 'unknown', origin: null };
  const [na, s2] = await Promise.all([
    req(f, `${origin}/api/status`, { timeoutMs: 6000 }),
    req(f, `${origin}/api/v1/settings/public`, { timeoutMs: 6000 }),
  ]);
  if (s2.status === 200 && s2.data?.code === 0 && s2.data.data) return { type: 'sub2api', origin };
  if (na.status === 200 && na.data?.success === true && na.data.data) return { type: 'newapi', origin };
  if (platformToken.startsWith('nap_')) return { type: 'newapi', origin };
  return { type: 'unknown', origin };
}

/* ---------------- new-api ---------------- */
export const uniqueName = (base, now = new Date(), rnd = Math.random) => {
  const sfx = `-${now.toISOString().slice(2, 10).replace(/-/g, '')}${rnd().toString(36).slice(2, 6)}`;
  return base.slice(0, 50 - sfx.length) + sfx;
};
/** 是否属于本工具建的 Key：WorkBuddy 或 WorkBuddy-xxxx */
export const isOurName = (n, base = DEFAULT_KEY_NAME) => n === base || (n || '').startsWith(`${base}-`);
const isAuthFail = (r) => r.status === 401 || r.status === 403 || (r.data?.success === false && /auth|token|login|user|scope|权限|未登录|无权/i.test(r.data.message || ''));
const withSk = (k) => (k && !k.startsWith('sk-') ? `sk-${k}` : k); // new-api 存的 key 不带 sk-

export function newapi(origin, pat, { userId, fetchImpl = fetch } = {}) {
  let uid = userId != null ? String(userId) : null;
  let retried = false;
  // MaaS rc.46 已确认 PAT 不需要 New-Api-User；保留「失败后带用户 ID 重试一次」仅作为旧版/第三方实例的兜底
  const call = async (path, opt = {}) => {
    const go = () => req(fetchImpl, origin + path, { ...opt, token: pat, headers: uid ? { 'New-Api-User': uid } : {} });
    let r = await go();
    if (isAuthFail(r) && !retried) {
      retried = true;
      if (!uid) { const me = await req(fetchImpl, `${origin}/api/user/self`, { token: pat }); if (me.data?.data?.id != null) uid = String(me.data.data.id); }
      if (uid) r = await go();
    }
    if (isAuthFail(r)) throw authErr(`个人访问令牌无效或缺少权限（需 api_key:read / api_key:reveal / api_key:write）：${r.data?.message || r.status}`);
    if (r.data?.success !== true) throw new Error(`${path} 失败：${r.data?.message || r.status || r.error}`);
    return r.data.data;
  };
  return {
    async list() {
      const d = await call('/api/token/?p=1&page_size=100');
      return (Array.isArray(d) ? d : d?.items || []).map((t) => ({ id: t.id, name: t.name, enabled: t.status === 1 /* 1启用 2禁用 3过期 4额度用尽 */, masked: t.key || '' }));
    },
    async reveal(id) { return withSk((await call(`/api/token/${id}/key`, { method: 'POST' }))?.key); },
    async create(base = DEFAULT_KEY_NAME) {
      // name 不唯一、创建接口不返回 id → 加唯一后缀，建完按 name 精确回查；name ≤ 50 字符
      const name = uniqueName(base);
      await call('/api/token/', { method: 'POST', body: { name, unlimited_quota: true, expired_time: -1 } });
      const t = (await this.list()).find((x) => x.name === name);
      if (!t) throw new Error('令牌已创建但未查到');
      return t;
    },
  };
}

/* ---------------- sub2api ---------------- */
export function sub2api(origin, jwt, { fetchImpl = fetch } = {}) {
  const call = async (path, opt = {}) => {
    const r = await req(fetchImpl, origin + path, { ...opt, token: jwt });
    if (r.status === 401 || r.status === 403) throw authErr('登录 token 无效或已过期，请重新登录后再复制');
    if (r.data?.code !== 0) throw new Error(`${path} 失败：${r.data?.message || r.status || r.error}`);
    return r.data.data;
  };
  const norm = (k) => ({ id: k.id, name: k.name, enabled: !k.status || k.status === 'active', masked: k.key ? `${k.key.slice(0, 5)}…${k.key.slice(-4)}` : '', key: k.key, group: k.group?.name ?? k.group_id ?? null });
  return {
    async list() { const d = await call('/api/v1/keys?page=1&page_size=100'); return (Array.isArray(d) ? d : d?.items || []).map(norm); },
    async reveal(id) { return (await this.list()).find((k) => k.id === id)?.key; },
    async create(name = DEFAULT_KEY_NAME) { return norm(await call('/api/v1/keys', { method: 'POST', body: { name } })); },
  };
}

/**
 * 总入口
 *   choose(keys) → 返回 key id 或 'new'；不传则：有同名 WorkBuddy 用它，否则有可用的用第一个，否则新建
 */
export async function acquireCredentials({ site, platformToken, type = 'auto', userId, keyName = DEFAULT_KEY_NAME, choose }, f = fetch) {
  const det = type !== 'auto' ? { type, origin: siteOrigin(site) } : await detectRelay(site, f, platformToken || '');
  if (!det.origin) throw new Error('站点地址无效');
  if (!platformToken) throw Object.assign(new Error('缺少平台凭证'), { code: 'NEED_TOKEN', relayType: det.type });
  const kind = det.type === 'unknown' ? (platformToken.startsWith('nap_') ? 'newapi' : 'sub2api') : det.type;
  const api = kind === 'newapi' ? newapi(det.origin, platformToken, { userId, fetchImpl: f }) : sub2api(det.origin, platformToken, { fetchImpl: f });
  const keys = (await api.list()).filter((k) => k.enabled);
  let pick = choose ? await choose(keys) : (keys.find((k) => isOurName(k.name, keyName)) || keys[0])?.id ?? 'new';
  const tok = pick === 'new' ? await api.create(keyName) : keys.find((k) => k.id === pick);
  if (!tok) throw new Error(`没有 id=${pick} 的可用 Key`);
  const apiKey = await api.reveal(tok.id);
  if (!apiKey) throw new Error('未能取到完整 Key');
  return { baseUrl: baseOf(det.origin), apiKey, keyName: tok.name, relayType: kind };
}
