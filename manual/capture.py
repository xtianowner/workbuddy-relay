import sys, os, subprocess, tempfile, threading, json
sys.path.insert(0, os.getcwd()); import importlib.util
import types; e=types.ModuleType('e'); e.__file__=os.path.abspath('run-e2e.py'); src=open('run-e2e.py').read(); src=src[:src.rfind('main()')] if not "__name__" in src else src; exec(compile(src,'e','exec'),e.__dict__)
mock=subprocess.Popen(['node','mock-relays.mjs'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True); mock.stdout.readline()
try:
  for i in [1,2,3,5]:
    name,script,_,_=e.CASES[i]; home=tempfile.mkdtemp(); stop=threading.Event()
    threading.Thread(target=e.fake_workbuddy,args=(home,stop),daemon=True).start()
    code,out=e.session(home,script); stop.set()
    open(os.environ['OUT']+'/case'+str(i)+'.txt','w').write(out); print(i,code)
finally: mock.kill()
