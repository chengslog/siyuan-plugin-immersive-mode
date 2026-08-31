import http from 'node:http';
import { readFile } from 'node:fs/promises';
const routes = new Map([['/', ['tests/preview.html', 'text/html; charset=utf-8']], ['/plugin.js', ['dist/index.js', 'text/javascript; charset=utf-8']]]);
http.createServer(async (req, res) => {
  const route = routes.get(new URL(req.url, 'http://127.0.0.1:4179').pathname);
  if (!route) { res.writeHead(404); res.end(); return; }
  try { res.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' }); res.end(await readFile(route[0])); }
  catch { res.writeHead(500); res.end('Build plugin before previewing.'); }
}).listen(4179, '127.0.0.1', () => console.log('Fixture: http://127.0.0.1:4179'));
