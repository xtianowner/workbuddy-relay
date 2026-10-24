// 双击运行的 exe：退出前停住窗口，让用户看到结果（仅无参数启动时）
import fs from 'node:fs';
if (process.pkg && process.platform === 'win32' && process.argv.length <= 2) {
  const realExit = process.exit.bind(process);
  let done = false;
  const hold = () => {
    if (done) return; done = true;
    process.stdout.write('\n  按回车键关闭窗口…');
    try { const b = Buffer.alloc(16); fs.readSync(0, b, 0, 16, null); } catch { /* ignore */ }
  };
  process.exit = (code) => { hold(); realExit(code ?? process.exitCode ?? 0); };
  process.on('beforeExit', () => { hold(); });
}
