import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 5500);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relativePath = normalize(pathname === '/' ? 'index.html' : pathname.slice(1));
  if (relativePath.startsWith('..')) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(join(ROOT, relativePath));
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(relativePath)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Курсы рядом: http://localhost:${PORT}`);
});
