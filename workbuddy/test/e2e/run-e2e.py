#!/usr/bin/env python3
"""Current CLI contract against two local relay fixtures; no real model/key/config writes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

def inspect(config):
    models = {m['id']: m for m in config}
    g = models['gpt-5.5']
    assert g['supportsReasoning'] is True
    assert g['reasoning'] == {'supportedEfforts': ['low', 'medium', 'high', 'xhigh', 'max'], 'defaultEffort': 'high', 'canDisableThinking': False}
    assert models['claude-sonnet-4']['supportsReasoning'] is False
    assert 'reasoning' not in models['claude-sonnet-4']
    assert 'reasoning' not in models['deepseek-v3.1']
    assert 'supportsReasoning' not in models['deepseek-v3.1']
    assert models['acme-mind-7']['reasoning'] == {'supportedEfforts': ['low', 'high']}

def main():
    mock = subprocess.Popen(['node', str(HERE / 'mock-relays.mjs')], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    assert 'mock relays up' in mock.stdout.readline()
    results = []
    cases = [('new-api', 'http://127.0.0.1:18081', 'sk-AAAAdefault0001', 'auto', True),
             ('sub2api', 'http://127.0.0.1:18082/v1', 'sk-s2existing11', 'auto', True),
             ('bad key', 'http://127.0.0.1:18082', 'fixture-invalid', 'auto', False),
             ('mandatory off', 'http://127.0.0.1:18082', 'sk-s2existing11', 'off', False)]
    try:
        for label, base, key, effort, success in cases:
            with tempfile.TemporaryDirectory(prefix='wb-cli-e2e-') as home:
                config = Path(home) / '.workbuddy' / 'models.json'
                env = dict(os.environ, HOME=home, WB_SKIP_DETECT='1', WB_RELAY_KEY=key, WB_LOG_DIR=str(Path(home) / 'logs'))
                selected = 'gpt-5.5,claude-sonnet-4,deepseek-v3.1,acme-mind-7' if effort == 'auto' else 'gpt-5.5'
                proc = subprocess.run(['node', str(ROOT / 'wb-setup.mjs'), '--url', base, '--models', selected, '--effort', effort, '--config', str(config), '--no-launch', '--json'], env=env, capture_output=True, text=True, timeout=20)
                assert (proc.returncode == 0) == success, label + ': ' + proc.stderr
                if success:
                    inspect(json.loads(config.read_text()))
                    assert (config.stat().st_mode & 0o777) == 0o600
                else:
                    assert not config.exists(), label
                results.append({'case': label, 'passed': True, 'exit': proc.returncode})
    finally:
        mock.terminate()
        mock.wait(timeout=5)
    print(json.dumps({'passed': len(results), 'results': results, 'externalModelCalled': False}, ensure_ascii=False))

if __name__ == '__main__':
    main()
