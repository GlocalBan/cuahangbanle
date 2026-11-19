'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./src/server/dal/database.js');
const { createApiRouter } = require('./src/server/routes/api.js');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function createServer(options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  const handleApi = createApiRouter(db);

  const server = http.createServer((req, res) => {
    let urlObj;
    try {
      urlObj = new URL(req.url, 'http://localhost');
      urlObj.pathname = decodeURIComponent(urlObj.pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    if (urlObj.pathname.startsWith('/api/')) {
      handleApi(req, res, urlObj);
      return;
    }

    const pathname = urlObj.pathname;
    const target = path.resolve(__dirname, '.' + (pathname === '/' ? '/index.html' : pathname));
    // Protect backend source, database files, tests, and config from static exposure
    const relativeTarget = path.relative(__dirname, target);
    const blockedPrefixes = ['src' + path.sep + 'server', 'data', 'scripts', 'tests', '.env'];
    if (
      !target.startsWith(__dirname + path.sep) ||
      blockedPrefixes.some((p) => relativeTarget === p || relativeTarget.startsWith(p + path.sep)) ||
      !MIME_TYPES[path.extname(target)]
    ) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(target)],
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(data);
    });
  });

  server.db = db;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();
  server.listen(port, host, () =>
    console.log(`RetailFlow 3-Tier Server running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`),
  );
  server.on('error', (err) => {
    console.error(
      err.code === 'EADDRINUSE'
        ? `Cong ${port} dang duoc su dung. Hay dong server cu hoac doi PORT.`
        : err.message,
    );
    process.exit(1);
  });
}

module.exports = { createServer };
