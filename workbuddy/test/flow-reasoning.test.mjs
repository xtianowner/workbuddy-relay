import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runImport } from '../lib/wb-flow.mjs';

test('临时服务错误不会关闭已有思考配置或删除未确认的中档', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-reasoning-'));
  const configPath = path.join(dir, 'models.json');
  const logger = { addSecret() {}, record() {} };
  try {
    const fetchImpl = async (url, init) => {
      const b = JSON.parse(init.body);
      const v = b.reasoning_effort;
      const status = v === 'wb_probe_invalid' ? 400 : v === 'medium' ? 500 : 200;
      return new Response(JSON.stringify(status === 200 ? { choices: [{message: {content:'ok'}}] } : {error:{message:status === 400 ? 'Invalid reasoning_effort' : 'upstream failed'}}), {status,headers:{'content-type':'application/json'}});
    };
    const result = await runImport({base:'http://x/v1',key:'test',models:[{id:'m',effort:'auto'}],configPath,logger,fetchImpl,dryRun:true});
    assert.equal(result.rows[0].effort,'medium');
    assert.ok(result.rows[0].levels.includes('medium'));
    assert.equal(result.preview[0].supportsReasoning,true);
    assert.match(result.rows[0].note,/未判定为不支持/);
    fs.writeFileSync(configPath,JSON.stringify([{id:'m',url:'http://x/v1/chat/completions',reasoning:{defaultEffort:'high',supportedEfforts:['high','max'],canDisableThinking:false}}]));
    const again = await runImport({base:'http://x/v1',key:'test',models:[{id:'m',effort:'auto'}],configPath,logger,fetchImpl,dryRun:true});
    assert.equal(again.rows[0].effort,'high');
    assert.deepEqual(again.rows[0].levels,['high','max']);
    assert.equal(again.preview[0].reasoning.canDisableThinking,false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
