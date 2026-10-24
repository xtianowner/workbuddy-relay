// 把 wb-page.html 内联成 wb-page.mjs（esbuild / pkg 打包时不用额外资源文件）
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const d = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(d, 'wb-page.html'), 'utf8');
fs.writeFileSync(path.join(d, 'wb-page.mjs'), `// 由 lib/wb-page.html 生成；改 html 后运行 \`node lib/build-page.mjs\`\nexport const PAGE = ${JSON.stringify(html)};\n`);
