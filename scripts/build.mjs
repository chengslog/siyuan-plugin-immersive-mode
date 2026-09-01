import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { PNG } from 'pngjs';

await mkdir('dist', { recursive: true });
await mkdir('artifacts', { recursive: true });
await mkdir('dist/i18n', { recursive: true });
// Preserve the user-approved source artwork and only normalize its exported
// dimensions/weight for the SiYuan marketplace.
const sourceIcon = PNG.sync.read(await readFile('assets/icon.png'));
const icon = new PNG({ width: 160, height: 160 });
for (let y = 0; y < icon.height; y++) {
  for (let x = 0; x < icon.width; x++) {
    const sx = Math.min(sourceIcon.width - 1, Math.floor((x + 0.5) * sourceIcon.width / icon.width));
    const sy = Math.min(sourceIcon.height - 1, Math.floor((y + 0.5) * sourceIcon.height / icon.height));
    const from = (sy * sourceIcon.width + sx) * 4;
    const to = (y * icon.width + x) * 4;
    // A restrained 5-bit RGB export keeps the liquid-glass artwork visually
    // intact while meeting the marketplace's 20KB icon recommendation.
    for (let channel = 0; channel < 3; channel++) icon.data[to + channel] = sourceIcon.data[from + channel] & 0xf8;
    icon.data[to + 3] = sourceIcon.data[from + 3];
  }
}
const iconData = PNG.sync.write(icon, { colorType: 6, deflateLevel: 9, deflateStrategy: 3 });
await writeFile('icon.png', iconData);
await writeFile('dist/icon.png', iconData);
await copyFile('assets/preview-source.png', 'preview.png');
await copyFile('assets/preview-source.png', 'dist/preview.png');
await writeFile('index.css', '/* Styles are bundled into index.js. */\n');
await copyFile('index.css', 'dist/index.css');
await build({ entryPoints: ['src/index.js'], outfile: 'dist/index.js', bundle: true, platform: 'browser', format: 'cjs', target: 'chrome114', external: ['siyuan'], loader: { '.css': 'text' } });
const files = ['plugin.json', 'README.md', 'i18n/zh_CN.json', 'i18n/en_US.json', 'i18n/zh-CN.json', 'i18n/en-US.json'];
for (const file of files) await copyFile(file, `dist/${file}`);
const zip = {};
for (const file of ['index.js', 'index.css', 'icon.png', 'preview.png', ...files]) zip[file] = new Uint8Array(await readFile(`dist/${file}`));
const packageData = zipSync(zip, { level: 9 });
await writeFile('package.zip', packageData);
await writeFile('artifacts/siyuan-plugin-immersive-mode-1.0.0.zip', packageData);
console.log('Built dist/, package.zip and artifacts/siyuan-plugin-immersive-mode-1.0.0.zip');
