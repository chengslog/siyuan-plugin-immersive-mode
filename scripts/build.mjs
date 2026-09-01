import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { PNG } from 'pngjs';

await mkdir('dist', { recursive: true });
await mkdir('artifacts', { recursive: true });
await mkdir('dist/i18n', { recursive: true });
// Reproducible Immersive mark: a calm indigo tile, inward focus brackets and
// a small light point. Render at 4x and average down for clean small-size edges.
const scale = 4, sourceSize = 160 * scale;
const source = new PNG({ width: sourceSize, height: sourceSize });
const roundedRect = (x, y, left, top, right, bottom, radius) => {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return Math.hypot(x - cx, y - cy) <= radius;
};
for (let y = 0; y < sourceSize; y++) for (let x = 0; x < sourceSize; x++) {
  const px = (x + .5) / scale, py = (y + .5) / scale;
  const offset = (y * sourceSize + x) * 4;
  if (!roundedRect(px, py, 7, 7, 153, 153, 37)) { source.data.set([0, 0, 0, 0], offset); continue; }
  const mix = Math.max(0, Math.min(1, (px + py - 14) / 292));
  const glow = Math.max(0, 1 - Math.hypot(px - 68, py - 52) / 110);
  let color = [Math.round(113 - 34 * mix + 12 * glow), Math.round(104 - 16 * mix + 10 * glow), Math.round(238 - 18 * mix + 8 * glow), 255];
  const line = 8, outer = 42, end = 67;
  const corner = ((px >= outer && px <= end && py >= outer && py <= outer + line) || (px >= outer && px <= outer + line && py >= outer && py <= end) ||
    (px >= 160 - end && px <= 160 - outer && py >= outer && py <= outer + line) || (px >= 160 - outer - line && px <= 160 - outer && py >= outer && py <= end) ||
    (px >= outer && px <= end && py >= 160 - outer - line && py <= 160 - outer) || (px >= outer && px <= outer + line && py >= 160 - end && py <= 160 - outer) ||
    (px >= 160 - end && px <= 160 - outer && py >= 160 - outer - line && py <= 160 - outer) || (px >= 160 - outer - line && px <= 160 - outer && py >= 160 - end && py <= 160 - outer));
  const dot = Math.hypot(px - 80, py - 80) <= 8;
  const innerGlow = Math.hypot(px - 80, py - 80) <= 15;
  if (innerGlow) color = [Math.min(255, color[0] + 14), Math.min(255, color[1] + 18), 250, 255];
  if (corner || dot) color = [249, 249, 255, 255];
  source.data.set(color, offset);
}
const icon = new PNG({ width: 160, height: 160 });
for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
  const sum = [0, 0, 0, 0];
  for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
    const offset = (((y * scale + sy) * sourceSize) + x * scale + sx) * 4;
    for (let channel = 0; channel < 4; channel++) sum[channel] += source.data[offset + channel];
  }
  icon.data.set(sum.map(value => Math.round(value / (scale * scale))), (y * 160 + x) * 4);
}
await writeFile('dist/icon.png', PNG.sync.write(icon));
await build({ entryPoints: ['src/index.js'], outfile: 'dist/index.js', bundle: true, platform: 'browser', format: 'cjs', target: 'chrome114', external: ['siyuan'], loader: { '.css': 'text' } });
const files = ['plugin.json', 'README.md', 'i18n/zh_CN.json', 'i18n/en_US.json', 'i18n/zh-CN.json', 'i18n/en-US.json'];
for (const file of files) await copyFile(file, `dist/${file}`);
const zip = {};
for (const file of ['index.js', 'icon.png', ...files]) zip[file] = new Uint8Array(await readFile(`dist/${file}`));
await writeFile('artifacts/siyuan-plugin-immersive-mode-0.1.0.zip', zipSync(zip));
console.log('Built dist/ and artifacts/siyuan-plugin-immersive-mode-0.1.0.zip');
