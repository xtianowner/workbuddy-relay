#!/usr/bin/env python3
"""网页模式端到端：mock new-api / sub2api + 真浏览器（Playwright headless Chromium）走完整填写流程。
   SHOTS=<目录> 时顺带截图（给使用手册用）；WB_E2E_CMD=<exe 路径> 可换成打包后的程序。"""
import os, sys, json, time, tempfile, threading, subprocess, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
src = open(os.path.join(HERE, 'run-e2e.py'), encoding='utf-8').read().split('\ndef session')[0]
ns = {'__file__': os.path.join(HERE, 'run-e2e.py')}; exec(src, ns)
fake_workbuddy = ns['fake_workbuddy']
SHOTS = os.environ.get('SHOTS')

def start_tool(home):
    url_file = os.path.join(home, 'url.txt')
    env = dict(os.environ, HOME=home, USERPROFILE=home, WB_SKIP_DETECT='1', WB_NO_BROWSER='1', WB_WEB_URL_FILE=url_file, NO_COLOR='1')
    cmd = os.environ.get('WB_E2E_CMD')
    p = subprocess.Popen(([cmd] if cmd else ['node', 'wb-setup.mjs']), cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for _ in range(int(os.environ.get('WB_START_WAIT', '100'))):
        if os.path.exists(url_file) and open(url_file).read(): return p, open(url_file).read()
        time.sleep(0.1)
    p.kill(); raise RuntimeError('网页服务没有启动：' + (p.stdout.read() or ''))

def req(url, headers=None, data=None):
    r = urllib.request.Request(url, headers=headers or {}, data=data, method='POST' if data else 'GET')
    try: return urllib.request.urlopen(r, timeout=5).status
    except urllib.error.HTTPError as e: return e.code

def shot(page, name, *sels):
    """截图；给了选择器就只截这些区块（上下合并），手册里更紧凑"""
    if not SHOTS: return
    os.makedirs(SHOTS, exist_ok=True); out = os.path.join(SHOTS, name)
    if not sels: return page.screenshot(path=out)
    sy = page.evaluate('window.scrollY'); sx = page.evaluate('window.scrollX')
    bs = [dict(b, x=b['x'] + sx, y=b['y'] + sy) for b in (page.locator(x).bounding_box() for x in sels)]
    y0 = min(b['y'] for b in bs) - 8; y1 = max(b['y'] + b['height'] for b in bs) + 8
    x0 = min(b['x'] for b in bs) - 8; x1 = max(b['x'] + b['width'] for b in bs) + 8
    page.screenshot(path=out, full_page=True, clip={'x': x0, 'y': y0, 'width': x1 - x0, 'height': y1 - y0})

def scenario_newapi(b, home):
    p, url = start_tool(home); results = []
    pg = b.new_page(viewport={'width': 900, 'height': 900}, device_scale_factor=2)
    pg.goto(url); pg.wait_for_selector('#st:not(:text("检测中…"))')
    shot(pg, 'web-01-open.png')
    pg.fill('#site', 'http://127.0.0.1:18081'); pg.click('#b1'); pg.wait_for_selector('#m1.ok')
    pg.fill('#pat', 'nap_testpat'); shot(pg, 'web-02-site-token.png', '#c1', '#c2')
    pg.click('#bKeys'); pg.wait_for_selector('#keys label'); shot(pg, 'web-03-keys.png', '#c2')
    pg.click('#b2'); pg.wait_for_selector('#mt tr')
    rows = {pg.locator('#mt tr').nth(i).locator('td.id').inner_text(): pg.locator('#mt tr').nth(i) for i in range(pg.locator('#mt tr').count())}
    results.append(('模型列表', set(rows) == {'gpt-5.5', 'claude-sonnet-4', 'broken-model', 'deepseek-v3.1', 'acme-mind-7'}, sorted(rows)))
    results.append(('默认建议', all(r.locator('select').input_value() == 'auto' for r in rows.values()), ''))
    rows['gpt-5.5'].locator('select').select_option('xhigh')
    rows['claude-sonnet-4'].locator('select').select_option('medium')
    rows['deepseek-v3.1'].locator('select').select_option('low')
    shot(pg, 'web-04-models.png', '#c3')
    pg.click('#b4'); pg.wait_for_selector('.final, #res .msg.err', timeout=60000); shot(pg, 'web-05-result.png', '#c4')
    txt = pg.inner_text('#res')
    results.append(('结果页', '已导入 4 个模型' in txt and '已降级' in txt and '未导入' in txt, txt.replace('\n', ' | ')[:300]))
    data = {m['id']: m for m in json.load(open(os.path.join(home, '.workbuddy', 'models.json')))}
    results.append(('models.json 思考字段', set(data) == {'gpt-5.5', 'claude-sonnet-4', 'deepseek-v3.1', 'acme-mind-7'}
        and data['acme-mind-7']['reasoning']['defaultEffort'] == 'medium' and data['acme-mind-7']['supportsReasoning'] is True
        and data['gpt-5.5']['reasoning'] == {'defaultEffort': 'xhigh', 'supportedEfforts': ['low', 'medium', 'high', 'xhigh', 'max'], 'canDisableThinking': False}
        and data['claude-sonnet-4']['supportsReasoning'] is False and 'reasoning' not in data['claude-sonnet-4']
        and data['deepseek-v3.1']['compat'] == {'thinkingFormat': 'deepseek'} and data['deepseek-v3.1']['reasoning']['defaultEffort'] == 'low'
        and data['gpt-5.5']['apiKey'].startswith('sk-AAAAdefault'), ''))
    results.append(('页面不含完整 Key', 'AAAAdefault0001' not in pg.content(), ''))
    pg.click('#bq'); pg.wait_for_selector('text=已关闭'); 
    code = p.wait(timeout=10); results.append(('点关闭后程序退出', code == 0, f'exit={code}'))
    return results

def scenario_sub2api_paste(b, home):
    p, url = start_tool(home); results = []
    pg = b.new_page()
    pg.goto(url); pg.fill('#site', 'http://127.0.0.1:18082'); pg.click('#b1'); pg.wait_for_selector('#m1.ok')
    results.append(('sub2api 自动切到粘贴', pg.is_visible('#key'), ''))
    pg.fill('#key', 'sk-s2existing11'); pg.click('#b2'); pg.wait_for_selector('#mt tr')
    pg.click('#b4'); pg.wait_for_selector('.final', timeout=60000)
    data = {m['id']: m for m in json.load(open(os.path.join(home, '.workbuddy', 'models.json')))}
    results.append(('sub2api 导入', data.get('gpt-5.5', {}).get('supportsReasoning') is True and all(m['url'].startswith('http://127.0.0.1:18082/v1') for m in data.values()), sorted(data)))
    pg.click('#bq'); results.append(('退出', p.wait(timeout=10) == 0, ''))
    return results

def scenario_security(home):
    p, url = start_tool(home); results = []
    base = url.split('/?')[0]; tok = url.split('t=')[1]
    results.append(('无 token 打不开页面', req(base + '/') == 403, ''))
    results.append(('API 无 token 拒绝', req(base + '/api/status') == 403, ''))
    results.append(('API 带 token 可用', req(base + '/api/status', {'X-WB-Token': tok}) == 200, ''))
    results.append(('外站 Origin 拒绝', req(base + '/api/status', {'X-WB-Token': tok, 'Origin': 'https://evil.example'}) == 403, ''))
    results.append(('DNS rebinding Host 拒绝', req(base + '/api/status', {'X-WB-Token': tok, 'Host': 'evil.example:' + base.rsplit(':', 1)[1]}) == 421, ''))
    results.append(('非 JSON POST 拒绝', req(base + '/api/site', {'X-WB-Token': tok, 'Content-Type': 'text/plain'}, b'{}') == 415, ''))
    p.kill(); return results

def main():
    mock = subprocess.Popen(['node', os.path.join(HERE, 'mock-relays.mjs')], stderr=subprocess.DEVNULL); time.sleep(0.8)
    allr = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            for fn in (scenario_newapi, scenario_sub2api_paste):
                home = tempfile.mkdtemp(prefix='wbweb-'); stop = threading.Event()
                threading.Thread(target=fake_workbuddy, args=(home, stop), daemon=True).start()
                try: allr += [(fn.__name__,) + r for r in fn(b, home)]
                except Exception as e: allr.append((fn.__name__, '异常', False, str(e)[:300]))
                stop.set()
            b.close()
        allr += [('security',) + r for r in scenario_security(tempfile.mkdtemp(prefix='wbweb-'))]
    finally: mock.terminate()
    for s, n, ok, d in allr: print(f"{'PASS' if ok else 'FAIL'}  {s} · {n}  {d if not ok else ''}")
    good = sum(1 for r in allr if r[2]); print(f'\n{good}/{len(allr)} 通过'); sys.exit(0 if good == len(allr) else 1)

main()
