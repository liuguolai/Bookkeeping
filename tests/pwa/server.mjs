// Test-only production-file server: injects releases/failures without changing dist.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
let release = 'a';
const root = path.resolve('dist');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/__test__/release') {
      release = url.searchParams.get('v') || 'a';
      res.end('ok');
      return;
    }
    let name =
      decodeURIComponent(url.pathname)
        .replace(/^\/ledger\//, '/')
        .replace(/^\//, '') || 'index.html';
    if (name === 'missing-file.js') {
      res.writeHead(503);
      res.end('simulated incomplete deployment');
      return;
    }
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep) || name.startsWith('_')) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      let body = await readFile(file);
      if (name === 'sw.js') {
        let source = body
          .toString()
          .replace(/const BUILD = (.*?);/, `const BUILD = $1 + '-${release}';`);
        if (release === 'broken')
          source = source.replace('const FILES = [', 'const FILES = ["missing-file.js",');
        body = Buffer.from(source);
      }
      if (name === 'index.html')
        body = Buffer.from(
          body.toString().replace('<html ', `<html data-test-release="${release}" `),
        );
      res.setHeader('Content-Type', mime[path.extname(name)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  })
  .listen(4175, '127.0.0.1');
