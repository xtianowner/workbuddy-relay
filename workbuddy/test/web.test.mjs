import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startWebServer } from '../lib/wb-web.mjs';
import { createLogger } from '../lib/wb-logs.mjs';
import { PLATFORM_BASE } from '../lib/wb-brand.mjs';

test('网页异步导入：鉴权、进度、跨站保留、备份和日志脱敏', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-web-test-'));
  const configPath = path.join(dir, 'models.json');
  const key = 'fixture-private-key-for-web-test';
  const original = [{ id: 'other', url: 'https://other.invalid/v1/chat/completions', apiKey: 'fixture-other' }];
  fs.writeFileSync(configPath, JSON.stringify(original));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const logger = createLogger({ dir: path.join(dir, 'logs'), version: 'test' });
  const srv = await startWebServer({ configPath, logger, app: { installed: true }, onExit() {},
    importOptions: { mergeTimeoutMs: 0 },
    fetchImpl: async (url, init) => {
      assert.ok(url.startsWith(PLATFORM_BASE));
      assert.equal(init.headers.Authorization, `Bearer ${key}`);
      if (url.endsWith('/models')) return Response.json({ data: [{ id: 'working' }, { id: 'other' }] });
      await gate;
      return Response.json({ choices: [{ message: { content: 'ok' } }] });
    },
  });
  const base = `http://127.0.0.1:${srv.port}`;
  const headers = { 'x-wb-token': srv.token, 'Content-Type': 'application/json' };
  const post = (route, body = {}) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/')).status, 403);
    assert.equal((await fetch(srv.url)).status, 200);
    assert.equal((await fetch(base + '/api/status')).status, 403);
    assert.equal((await post('/api/use-key', { key })).status, 200);
    const job = await (await post('/api/import', { models: [{ id: 'working', effort: 'off' }, { id: 'other', effort: 'off' }] })).json();
    assert.ok(job.jobId);
    assert.equal(job.status, 'running');
    assert.equal((await post('/api/use-key', { key })).status, 409);
    release();
    let result;
    for (let i = 0; i < 100; i++) {
      result = await (await fetch(base + '/api/import-status?jobId=' + job.jobId, { headers })).json();
      if (result.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(result.status, 'completed');
    assert.equal(result.result.ok, true);
    assert.deepEqual(result.result.written, ['working']);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(saved.find(m => m.id === 'other'), original[0]);
    assert.equal(saved.find(m => m.id === 'working').apiKey, key);
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
    assert.ok(fs.readdirSync(dir).some(name => name.includes('.bak')));
    const archive = await post('/api/logs/export');
    assert.equal(archive.status, 200);
    assert.equal(archive.headers.get('content-type'), 'application/zip');
    assert.ok((await archive.arrayBuffer()).byteLength > 100);
    const logs = fs.readdirSync(path.join(dir, 'logs')).map(name => fs.readFileSync(path.join(dir, 'logs', name), 'utf8')).join('');
    assert.ok(!logs.includes(key));
    assert.match(logs, /config.verify.completed/);
  } finally {
    release();
    await new Promise(resolve => { srv.server.close(resolve); srv.server.closeAllConnections(); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
