#!/usr/bin/env python3
"""重新生成手册截图：用 headless 浏览器跑一遍网页模式端到端（本地 mock 中转站），截图写到 manual/img/（或环境变量 OUT）"""
import os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
env = dict(os.environ, SHOTS=os.environ.get('OUT', os.path.join(HERE, 'img')))
sys.exit(subprocess.call([sys.executable, os.path.join(HERE, '..', 'workbuddy', 'test', 'e2e', 'web-e2e.py')], env=env))
