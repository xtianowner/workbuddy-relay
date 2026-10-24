import re, html, subprocess, os
def sl(f,a,b,incl_b=False):
    t=open(f).read().split('\n'); s=next(i for i,l in enumerate(t) if a in l)
    e=next((i for i in range(s+1,len(t)) if b and b in t[i]),len(t)); return t[s:e+1 if incl_b else e]
def mask(l):
    l=re.sub(r'/tmp/tmp\w+','~',l)
    l=re.sub(r'(平台令牌: )(nap_|eyJ)\S+',lambda m:m.group(1)+m.group(2)+'••••••••',l)
    l=re.sub(r'(API Key: )(sk-..)\S+',lambda m:m.group(1)+m.group(2)+'••••••••',l)
    return l
shots={
 '01-site-token-newapi': sl('case1.txt','第 1 步','第 3 步'),
 '02-select-key-sub2api': sl('case2.txt','第 3 步','[2/5]'),
 '03-paste-key': sl('case3.txt','第 2 步','[2/5]'),
 '04-token-fallback': sl('case5.txt','第 2 步','[2/5]'),
 '05-import-done': sl('case1.txt','[2/5]','ZZZ'),
}
os.makedirs('img',exist_ok=True)
for n,lines in shots.items():
    while lines and not lines[-1].strip(): lines.pop()
    body=[]
    for l in map(mask,lines):
        h=html.escape(l)
        h=re.sub(r'(✓.*)',r'<span class=g>\1</span>',h); h=re.sub(r'^(\s*)(!.*)',r'\1<span class=y>\2</span>',h); h=re.sub(r'(✗.*)',r'<span class=r>\1</span>',h)
        h=re.sub(r'^(\[\d/5\].*|第 \d 步.*|完成 ·.*)',r'<b class=c>\1</b>',h)
        body.append(h)
    H=len(body)*22+70
    doc=f"""<html><head><meta charset=utf8><style>body{{margin:0;background:#1e1e1e}}.w{{margin:0;border-radius:8px;overflow:hidden}}.t{{background:#333;height:26px;padding-left:10px}}.t i{{display:inline-block;width:12px;height:12px;border-radius:6px;margin:7px 4px}}pre{{margin:0;padding:12px 16px;color:#ddd;font:14px/22px 'Noto Sans Mono CJK SC','DejaVu Sans Mono',monospace}}.g{{color:#6c6}}.y{{color:#dc5}}.r{{color:#e66}}.c{{color:#6cf}}</style></head><body><div class=w><div class=t><i style=background:#f55></i><i style=background:#fb3></i><i style=background:#5c5></i></div><pre>{chr(10).join(body)}</pre></div></body></html>"""
    open(f'img/{n}.html','w').write(doc)
    subprocess.run(['google-chrome','--headless','--no-sandbox','--hide-scrollbars','--force-device-scale-factor=2',f'--window-size=1020,{H}',f'--screenshot={os.path.abspath("img/"+n+".png")}',os.path.abspath(f'img/{n}.html')],capture_output=True)
    print(n,H)
