import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { PAGE } from '../lib/wb-page.mjs';

const html = await fs.readFile(new URL('../lib/wb-page.html', import.meta.url), 'utf8');
test('generated page matches source and defaults protocol to auto', () => {
  assert.equal(PAGE, html);
  assert.match(html, /<select id="protocolChoice"[^>]*><option value="auto">自动检测<\/option>/);
  assert.match(html, /api\('\/api\/import',\{protocol:\$\('protocolChoice'\)\.value\|\|'auto',models:pick\}\)/);
});
test('fixed Chat still verifies while unverified native protocols explain refusal', () => {
  const start = html.indexOf('function protocolStatus()');
  const end = html.indexOf('\n', start);
  const select = { value: 'auto' }, status = {};
  const context = { $: id => id === 'protocolChoice' ? select : status };
  vm.runInNewContext(html.slice(start, end) + '\nprotocolStatus();', context);
  assert.match(status.textContent, /自动验证当前服务的 Chat Completions/);
  select.value = 'openai-chat';
  vm.runInNewContext(html.slice(start, end) + '\nprotocolStatus();', context);
  assert.match(status.textContent, /导入前仍会验证/);
  for (const protocol of ['openai-responses', 'anthropic-messages']) {
    select.value = protocol;
    vm.runInNewContext(html.slice(start, end) + '\nprotocolStatus();', context);
    assert.match(status.textContent, /当前 WorkBuddy 自定义配置未支持该原生协议，不会转换/);
    assert.match(status.textContent, /拒绝/);
  }
});
