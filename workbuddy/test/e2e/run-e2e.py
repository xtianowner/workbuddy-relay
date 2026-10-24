#!/usr/bin/env python3
"""端到端：本地 mock new-api / sub2api + 真 TTY 交互（pty）+ 临时 HOME + 模拟 WorkBuddy 热加载缓存"""
import os, pty, re, sys, time, json, subprocess, tempfile, threading, glob, select
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ANSI = re.compile(r'\x1b\[[0-9;]*m')

def reasoning_ok(data):
    # gpt-5.5 支持 reasoning_effort；claude-sonnet-4 被中转站拒绝 → 降级；deepseek-v3.1 只认 thinking → compat.thinkingFormat=deepseek
    m = {x['id']: x for x in data}
    g, c, d = m.get('gpt-5.5', {}), m.get('claude-sonnet-4', {}), m.get('deepseek-v3.1', {})
    return g.get('supportsReasoning') is True and g.get('reasoning', {}).get('defaultEffort') == 'medium' and 'compat' not in g \
        and c.get('supportsReasoning') is False and 'reasoning' not in c \
        and d.get('supportsReasoning') is True and d.get('compat') == {'thinkingFormat': 'deepseek'}

def fake_workbuddy(home, stop):
    """模拟 WorkBuddy：监视 models.json，变化后写 cache/acc-product-config-v3.json（id 加 custom-local: 前缀）"""
    cfg = os.path.join(home, '.workbuddy', 'models.json'); last = None
    while not stop.is_set():
        try:
            m = os.path.getmtime(cfg)
            if m != last:
                last = m; time.sleep(0.3)
                data = json.load(open(cfg)); arr = data if isinstance(data, list) else data.get('models', [])
                os.makedirs(os.path.join(home, '.workbuddy', 'cache'), exist_ok=True)
                json.dump({'models': [{'id': 'custom-local:' + x['id']} for x in arr]}, open(os.path.join(home, '.workbuddy', 'cache', 'acc-product-config-v3.json'), 'w'))
        except FileNotFoundError: pass
        time.sleep(0.2)

def session(home, script):
    env = dict(os.environ, HOME=home, WB_SKIP_DETECT='1', NO_COLOR='1')
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT); cmd = os.environ.get('WB_E2E_CMD'); os.execvpe(cmd or 'node', ([cmd] if cmd else ['node', 'wb-setup.mjs']) + ['--no-launch', '--interactive'], env)
    buf = ''; out = []
    def read_until(pat, timeout=30):
        nonlocal buf
        end = time.time() + timeout
        while time.time() < end:
            if re.search(pat, ANSI.sub('', buf)): return
            r, _, _ = select.select([fd], [], [], 0.2)
            if r:
                try: chunk = os.read(fd, 4096).decode('utf8', 'replace')
                except OSError: break
                buf += chunk; out.append(chunk)
        raise TimeoutError(f'等不到 {pat!r}\n---\n' + ANSI.sub('', buf))
    for pat, ans in script:
        read_until(pat); buf = ''
        os.write(fd, (ans + '\n').encode())
    try: read_until(r'完成 ·|✗', 40)
    except TimeoutError: pass
    time.sleep(0.3)
    try:
        while True:
            r, _, _ = select.select([fd], [], [], 0.3)
            if not r: break
            c = os.read(fd, 4096).decode('utf8', 'replace'); out.append(c)
    except OSError: pass
    _, st = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(st), ANSI.sub('', ''.join(out)).replace('\r', '')

CASES = [
  ('new-api · 平台令牌 · 新建 Key', [(r'站点地址:', 'http://127.0.0.1:18081'), (r'选择 \[1\]:', '1'), (r'平台令牌:', 'nap_testpat'), (r'选择 \[1\]:', 'n')], 'http://127.0.0.1:18081/v1', r'sk-NEWK'),
  ('new-api · 平台令牌 · 选已有 Key', [(r'站点地址:', 'http://127.0.0.1:18081'), (r'选择 \[1\]:', '1'), (r'平台令牌:', 'nap_testpat'), (r'选择 \[1\]:', '1')], None, None),
  ('sub2api · 平台令牌 · 选已有 Key', [(r'站点地址:', 'http://127.0.0.1:18082'), (r'选择 \[1\]:', '1'), (r'平台令牌:', 'eyJ.test.jwt'), (r'选择 \[1\]:', '1')], 'http://127.0.0.1:18082/v1', r'sk-s2existing11'),
  ('sub2api · 直接粘贴 Key', [(r'站点地址:', 'http://127.0.0.1:18082'), (r'选择 \[1\]:', '2'), (r'API Key:', 'sk-s2existing11')], None, None),
  ('回归2.0.1 · sub2api 站点根地址粘贴 + 修复旧版坏条目', [(r'站点地址:', 'http://127.0.0.1:18082'), (r'选择 \[1\]:', '2'), (r'API Key:', 'sk-s2existing11')], 'http://127.0.0.1:18082/v1', r'sk-s2existing11'),
  ('new-api · 令牌错误 → 自动降级为粘贴', [(r'站点地址:', 'http://127.0.0.1:18081'), (r'选择 \[1\]:', '1'), (r'平台令牌:', 'nap_wrong'), (r'API Key:', 'sk-AAAAdefault0001')], None, None),
]

def main():
    mock = subprocess.Popen(['node', os.path.join(HERE, 'mock-relays.mjs')], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    mock.stdout.readline()
    fails = 0; show = os.environ.get('SHOW')
    try:
        for i, (name, script, want_url, want_key) in enumerate(CASES):
            home = tempfile.mkdtemp(prefix='wbhome-'); stop = threading.Event()
            if name.startswith('回归'):
                os.makedirs(os.path.join(home, '.workbuddy'))
                json.dump([{'id': i, 'url': 'http://127.0.0.1:18082/chat/completions', 'apiKey': 'sk-s2existing11', 'wbImportOwner': 'wb-setup-v1'} for i in ['claude-*', 'gpt-*', 'gpt-5.5']], open(os.path.join(home, '.workbuddy', 'models.json'), 'w'))
            t = threading.Thread(target=fake_workbuddy, args=(home, stop), daemon=True); t.start()
            code, out = session(home, script); stop.set()
            cfg = os.path.join(home, '.workbuddy', 'models.json')
            data = json.load(open(cfg)) if os.path.exists(cfg) else []
            ids = sorted(m['id'] for m in data)
            ok = code == 0 and ids == ['claude-sonnet-4', 'deepseek-v3.1', 'gpt-5.5'] and '已接收配置' in out \
                 and reasoning_ok(data) \
                 and all(m['url'].endswith('/v1/chat/completions') for m in data) \
                 and (not want_url or all(m['url'] == want_url + '/chat/completions' for m in data)) \
                 and (not want_key or all(re.match(want_key, m['apiKey']) for m in data)) \
                 and oct(os.stat(cfg).st_mode & 0o777) == '0o600'
            fails += not ok
            print(f"{'PASS' if ok else 'FAIL'}  {name}  exit={code}  models={ids}  key={data[0]['apiKey'][:9] + '…' if data else '-'}")
            if show == str(i) or not ok: print(out)
    finally: mock.terminate()
    print(f'\n{len(CASES) - fails}/{len(CASES)} 通过'); sys.exit(1 if fails else 0)
main()
