import { chromium } from '/tmp/bridge-ui-qa-1103/node_modules/playwright/index.mjs';
import { startWebServer } from '../../../workbuddy/lib/wb-web.mjs';
import { createLogger } from '../../../workbuddy/lib/wb-logs.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wb-ui-declaration-'));
const logger=createLogger({dir:path.join(dir,'logs'),version:'ui-test'});
const fakeFetch=async(url,init={})=>{
  if(url.endsWith('/models')) return Response.json({data:[
    {id:'declared-model',reasoning:{supported_efforts:['low','high'],default_effort:'high',mandatory:false}},
    {id:'plain-model'},
    {id:'mandatory-model',reasoning:{supported_efforts:['medium'],default_effort:'medium',mandatory:true}}
  ]});
  if(url.endsWith('/chat/completions')) return Response.json({choices:[{message:{content:'OK'}}]});
  return Response.json({error:{message:'not found'}},{status:404});
};
const server=await startWebServer({app:{installed:true,version:'5.8.3',running:false},configPath:path.join(dir,'models.json'),fetchImpl:fakeFetch,logger,onExit:()=>{}});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const results=[];
for(const width of [390,1440]){const page=await browser.newPage({viewport:{width,height:900}});await page.goto(server.url);await page.fill('#key','synthetic-key');await page.click('#b2');await page.waitForFunction(()=>document.querySelectorAll('#mt tr').length===3);const models=await page.locator('#mt tr').count();const defaultProtocol=await page.locator('#protocolChoice').inputValue();await page.selectOption('#protocolChoice','openai-responses');const refused=await page.locator('#protocolChoiceStatus').innerText();await page.selectOption('#protocolChoice','anthropic-messages');const anthropicRefused=await page.locator('#protocolChoiceStatus').innerText();await page.selectOption('#protocolChoice','openai-chat');const chatFixed=await page.locator('#protocolChoiceStatus').innerText();await page.selectOption('#protocolChoice','auto');const declared=page.locator('#mt tr').nth(0).locator('select');const plain=page.locator('#mt tr').nth(1).locator('select');const mandatory=page.locator('#mt tr').nth(2).locator('select');const declaredOpts=await declared.locator('option').allTextContents();const plainOpts=await plain.locator('option').allTextContents();const mandatoryOpts=await mandatory.locator('option').allTextContents();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);const dims=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,body:document.body.scrollWidth,innerWidth,html:document.documentElement.getBoundingClientRect().toJSON(),bodyRect:document.body.getBoundingClientRect().toJSON()}));const offenders=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1||e.getBoundingClientRect().left<0||e.getBoundingClientRect().right>innerWidth+1).slice(0,15).map(e=>({tag:e.tagName,id:e.id,cls:String(e.className),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth})));await page.screenshot({path:`docs/1103-shared-reasoning/ui/declaration-${width}.png`,fullPage:true});results.push({width,models,defaultProtocol,refused,anthropicRefused,chatFixed,declaredOpts,plainOpts,mandatoryOpts,overflow,dims,offenders});await page.close();}
await browser.close();await new Promise(r=>server.server.close(r));await fs.rm(dir,{recursive:true,force:true});console.log(JSON.stringify({passed:results.every(r=>r.models===3&&r.defaultProtocol==='auto'&&r.refused.includes('未支持该原生协议')&&r.anthropicRefused.includes('不会转换')&&r.chatFixed.includes('仍会验证')&&!r.overflow&&r.declaredOpts.includes('低')&&r.declaredOpts.includes('高')&&!r.plainOpts.includes('中')&&!r.mandatoryOpts.includes('关闭')),results},null,2));
