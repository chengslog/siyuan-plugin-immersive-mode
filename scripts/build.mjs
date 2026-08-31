import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { PNG } from 'pngjs';

await mkdir('dist', { recursive: true });
await mkdir('artifacts', { recursive: true });
await mkdir('dist/i18n', { recursive: true });
// Small code-native icon; generated reproducibly, no remote artwork dependency.
const icon = new PNG({ width: 160, height: 160 });
for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
  const offset = (y * 160 + x) * 4;
  const inside = Math.hypot(x - 79.5, y - 79.5) < 73;
  const nearX = x >= 44 && x < 53 || x >= 107 && x < 116;
  const nearY = y >= 44 && y < 53 || y >= 107 && y < 116;
  const spanX = x >= 44 && x < 71 || x >= 89 && x < 116;
  const spanY = y >= 44 && y < 71 || y >= 89 && y < 116;
  const white = nearX && spanY || nearY && spanX;
  icon.data.set(white ? [245, 255, 250, 255] : [48, 137, 106, inside ? 255 : 0], offset);
}
await writeFile('dist/icon.png', PNG.sync.write(icon));
await build({ entryPoints: ['src/index.js'], outfile: 'dist/index.js', bundle: true, platform: 'browser', format: 'cjs', target: 'chrome114', external: ['siyuan'], loader: { '.css': 'text' } });
const files = ['plugin.json', 'README.md', 'i18n/zh_CN.json', 'i18n/en_US.json', 'i18n/zh-CN.json', 'i18n/en-US.json'];
for (const file of files) await copyFile(file, `dist/${file}`);
const zip = {};
for (const file of ['index.js', 'icon.png', ...files]) zip[file] = new Uint8Array(await readFile(`dist/${file}`));
await writeFile('artifacts/siyuan-plugin-immersive-mode-0.1.0.zip', zipSync(zip));
console.log('Built dist/ and artifacts/siyuan-plugin-immersive-mode-0.1.0.zip');
