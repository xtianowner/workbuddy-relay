// CommonJS entry bundle, including ESM dependencies that anchor createRequire
// through import.meta.url. The URL must refer to the extracted bundle at run time.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = path.dirname(fileURLToPath(import.meta.url));

export async function bundleApplication(output = path.join(directory, 'out/wb.cjs')) {
  return build({
    entryPoints: [path.join(directory, 'entry.mjs')], outfile: output,
    bundle: true, platform: 'node', target: 'node20', format: 'cjs',
    minify: true, legalComments: 'none',
    define: { 'import.meta.url': '__wbBundleURL' },
    banner: { js: 'const __wbBundleURL = require("node:url").pathToFileURL(__filename).href;' }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await bundleApplication(process.argv[2] && path.resolve(process.argv[2]));
}
