#!/usr/bin/env node
// Build-time-only compression: the result contains its complete Node runtime and
// application. Running it never downloads code or needs a preinstalled runtime.
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { bundleApplication } from './bundle.mjs';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const asset = bytes => ({ size: bytes.length, sha256: sha256(bytes) });

export async function buildNative({ platform, arch = 'x64', runtimePath, outDir = path.join(root, 'dist'), bundlePath, prepare = true } = {}) {
  if (!['windows', 'macos'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Expected --platform windows|macos and --arch x64|arm64');
  if (!runtimePath || !path.isAbsolute(runtimePath)) throw new Error('--runtime must be the absolute path to an existing target-platform Node executable');
  if (prepare) {
    await execute(process.execPath, [path.join(root, 'configure-build.mjs')], { cwd: root });
    await execute(process.execPath, [path.join(root, 'workbuddy/lib/build-page.mjs')], { cwd: root });
  }
  const version = /VERSION = '([^']+)'/.exec(await readFile(path.join(root, 'workbuddy/lib/wb-core.mjs'), 'utf8'))?.[1];
  if (!version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Application version missing');
  await mkdir(outDir, { recursive: true });
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'workbuddy-native-build-'));
  try {
    const cjs = bundlePath || path.join(scratch, 'workbuddy.cjs');
    if (!bundlePath) await bundleApplication(cjs);
    const runtime = await readFile(runtimePath);
    const application = await readFile(cjs);
    if (platform === 'windows') {
      if (runtime.length < 64 || runtime.subarray(0, 2).toString() !== 'MZ') throw new Error('Windows runtime is not a PE executable');
      const pe = runtime.readUInt32LE(60);
      if (pe + 6 > runtime.length || runtime.subarray(pe, pe + 4).toString() !== 'PE\u0000\u0000' || runtime.readUInt16LE(pe + 4) !== (arch === 'x64' ? 0x8664 : 0xaa64)) throw new Error('Windows runtime architecture does not match target');
    }
    if (platform === 'macos') {
      if (runtime.length < 8 || runtime.subarray(0, 4).toString('hex') !== 'cffaedfe') throw new Error('macOS runtime must be a thin little-endian Mach-O executable');
      if (runtime.readUInt32LE(4) !== (arch === 'arm64' ? 0x100000c : 0x1000007)) throw new Error('macOS runtime architecture does not match target');
    }
    await copyFile(path.join(root, 'windows-exe/native-launcher/main.go'), path.join(scratch, 'main.go'));
    const compressedRuntime = gzipSync(runtime, { level: 9 });
    const compressedApplication = gzipSync(application, { level: 9 });
    await writeFile(path.join(scratch, 'runtime.gz'), compressedRuntime);
    await writeFile(path.join(scratch, 'application.gz'), compressedApplication);
    await writeFile(path.join(scratch, 'manifest.json'), JSON.stringify({ runtime: asset(runtime), application: asset(application) }));
    const file = `WorkBuddy-Relay-Import-${platform}-${arch}${platform === 'windows' ? '.exe' : ''}`;
    const output = path.join(outDir, file);
    await execute('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags', `-s -w -buildid= -X main.version=${version}`, '-o', output, path.join(scratch, 'main.go')], {
      cwd: scratch, env: { ...process.env, GOOS: platform === 'windows' ? 'windows' : 'darwin', GOARCH: arch === 'x64' ? 'amd64' : 'arm64', CGO_ENABLED: '0', GO111MODULE: 'off' }, maxBuffer: 1024 * 1024
    });
    await chmod(output, 0o755);
    if (platform === 'macos') {
      if (process.platform !== 'darwin') throw new Error('macOS signing requires a Mac');
      await execute('codesign', ['--force', '--sign', '-', output]);
      await execute('codesign', ['--verify', '--strict', output]);
    }
    const binary = await readFile(output);
    const result = { version, platform, arch, file: output, ...asset(binary), runtime: asset(runtime), application: asset(application), runtimeCompressedBytes: compressedRuntime.length, applicationCompressedBytes: compressedApplication.length, offlineRuntimeIncluded: true, signed: platform === 'macos' ? 'ad-hoc' : false };
    await writeFile(`${output}.json`, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { platform: { type: 'string', default: process.platform === 'win32' ? 'windows' : 'macos' }, arch: { type: 'string', default: process.arch === 'arm64' ? 'arm64' : 'x64' }, runtime: { type: 'string', default: process.execPath }, out: { type: 'string' }, bundle: { type: 'string' }, 'skip-prepare': { type: 'boolean' } } });
  console.log(JSON.stringify(await buildNative({ platform: values.platform, arch: values.arch, runtimePath: values.runtime, outDir: values.out && path.resolve(values.out), bundlePath: values.bundle && path.resolve(values.bundle), prepare: !values['skip-prepare'] }), null, 2));
}
