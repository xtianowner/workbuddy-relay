/**
 * wb-platform —— 跨平台：检测 WorkBuddy 安装情况 / 版本 / 运行状态，启动它，以及可选的静默安装
 *
 * macOS：/Applications、~/Applications、Spotlight(mdfind)
 * Windows：常见安装目录、注册表 App Paths / Uninstall、tasklist
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const HOME = os.homedir();
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/* ---------------- 检测 ---------------- */

export function detect() {
  const result = {
    platform: process.platform,
    supported: isMac || isWin,
    installed: false,
    appPath: null,      // macOS: /Applications/WorkBuddy.app
    exePath: null,      // 可执行文件
    version: null,
    running: false,
    installerKind: isMac ? 'dmg' : 'exe',
  };
  if (isMac) detectMac(result);
  else if (isWin) detectWin(result);
  result.running = isRunning(result);
  return result;
}

function detectMac(r) {
  const guesses = [
    '/Applications/WorkBuddy.app',
    path.join(HOME, 'Applications/WorkBuddy.app'),
    '/Applications/WorkBuddy (Beta).app',
  ];
  for (const g of guesses) if (fs.existsSync(g)) { r.appPath = g; break; }

  if (!r.appPath) {
    // Spotlight：能覆盖用户挪到别处的安装
    const hit = run('mdfind', ['kMDItemCFBundleIdentifier == "com.tencent.workbuddy.mac"']);
    const first = (hit || '').split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.app'))[0];
    if (first) r.appPath = first;
  }

  if (r.appPath) {
    r.installed = true;
    r.version = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(r.appPath, 'Contents/Info.plist')]);
    const bin = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(r.appPath, 'Contents/Info.plist')]) || 'WorkBuddy';
    const exe = path.join(r.appPath, 'Contents/MacOS', bin);
    r.exePath = fs.existsSync(exe) ? exe : path.join(r.appPath, 'Contents/MacOS/Electron');
  }
}

function detectWin(r) {
  const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const guesses = [
    path.join(local, 'Programs', 'WorkBuddy', 'WorkBuddy.exe'),
    path.join(local, 'Programs', 'workbuddy', 'WorkBuddy.exe'),
    path.join(local, 'WorkBuddy', 'WorkBuddy.exe'),
    path.join(pf, 'WorkBuddy', 'WorkBuddy.exe'),
    path.join(pf86, 'WorkBuddy', 'WorkBuddy.exe'),
  ];

  // 注册表：App Paths 最权威
  for (const hive of ['HKLM', 'HKCU']) {
    const out = run('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\WorkBuddy.exe`, '/ve']);
    const m = out && out.match(/REG_SZ\s+(.+\.exe)/i);
    if (m) { guesses.unshift(m[1].trim().replace(/^"|"$/g, '')); break; }
  }

  for (const g of guesses) if (fs.existsSync(g)) { r.exePath = g; break; }

  if (r.exePath) {
    r.installed = true;
    r.appPath = path.dirname(r.exePath);
    const ps = run('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${r.exePath.replace(/'/g, "''")}').VersionInfo.ProductVersion`]);
    r.version = ps || regVersion();
  }
}

function regVersion() {
  for (const hive of ['HKCU', 'HKLM']) {
    const out = run('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall`, '/s', '/f', 'WorkBuddy']);
    const m = out && out.match(/DisplayVersion\s+REG_SZ\s+([^\r\n]+)/i);
    if (m) return m[1].trim();
  }
  return null;
}

function isRunning(r) {
  if (!r.installed) return false;
  if (isMac) {
    const out = run('pgrep', ['-f', 'WorkBuddy.app/Contents/MacOS']);
    return !!out;
  }
  if (isWin) {
    const out = run('tasklist', ['/FI', 'IMAGENAME eq WorkBuddy.exe', '/NH']);
    return !!out && /WorkBuddy\.exe/i.test(out);
  }
  return false;
}

/* ---------------- 配置目录 ---------------- */

export function configDir() {
  return process.env.WORKBUDDY_CONFIG_DIR || path.join(HOME, isWin ? '.workbuddy' : '.workbuddy');
}

/* ---------------- 启动 / 打开 ---------------- */

export function launch(d) {
  if (isMac && d.appPath) {
    const out = spawnSync('open', ['-a', d.appPath], { stdio: 'ignore' });
    return out.status === 0;
  }
  if (isWin && d.exePath) {
    spawnSync('cmd', ['/c', 'start', '', d.exePath], { stdio: 'ignore', windowsHide: true });
    return true;
  }
  return false;
}

/** 唤到前台：已运行就走深链，未运行则先启动再走深链 */
export function focus() {
  const url = 'workbuddy://home';
  if (isMac) return spawnSync('open', [url], { stdio: 'ignore' }).status === 0;
  if (isWin) return spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true }).status === 0;
  return false;
}

export function openBrowser(url) {
  if (isMac) return spawnSync('open', [url], { stdio: 'ignore' }).status === 0;
  if (isWin) return spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true }).status === 0;
  return spawnSync('xdg-open', [url], { stdio: 'ignore' }).status === 0;
}

/* ---------------- 安装（可选） ---------------- */

/** macOS：挂载 dmg → 拷到 /Applications → 去隔离属性 */
export function installMacDmg(dmgPath) {
  const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mnt-'));
  const detach = () => { try { execFileSync('hdiutil', ['detach', mnt, '-quiet'], { stdio: 'ignore' }); } catch { /* ignore */ } };
  try {
    execFileSync('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mnt, '-quiet'], { stdio: 'ignore' });
    const app = fs.readdirSync(mnt).find((n) => n.endsWith('.app'));
    if (!app) throw new Error('dmg 里没找到 .app');
    const src = path.join(mnt, app);
    let dest = '/Applications';
    try { fs.accessSync(dest, fs.constants.W_OK); } catch { dest = path.join(HOME, 'Applications'); fs.mkdirSync(dest, { recursive: true }); }
    const target = path.join(dest, app);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    execFileSync('ditto', [src, target], { stdio: 'ignore' });
    try { execFileSync('xattr', ['-dr', 'com.apple.quarantine', target], { stdio: 'ignore' }); } catch { /* 非必须 */ }
    return target;
  } finally { detach(); try { fs.rmSync(mnt, { recursive: true, force: true }); } catch { /* ignore */ } }
}

/** Windows：优先静默 (/S)，失败则交给用户点下一步 */
export function installWinExe(exePath) {
  const silent = spawnSync(exePath, ['/S'], { stdio: 'ignore', windowsHide: true, timeout: 5 * 60 * 1000 });
  if (silent.status === 0) return true;
  spawnSync('cmd', ['/c', 'start', '', exePath], { stdio: 'ignore', windowsHide: true });
  return false;
}
