const http = require('node:http');

const { routes } = require('./routes');

const MAX_REQUEST_BYTES = 5 * 1024 * 1024;

function addResponseHelpers(res) {
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (body) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  return res;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        tooLarge = true;
        const error = new Error('Request body is too large.');
        error.code = 'REQUEST_TOO_LARGE';
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function createRequestListener(routeMap = routes) {
  return async (req, rawRes) => {
    const res = addResponseHelpers(rawRes);
    const pathname = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/health') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET.' } });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ status: 'ok' });
    }

    const handler = routeMap.get(pathname);
    if (!handler) return res.status(404).json({ error: { reason: 'not-found', message: 'Endpoint not found.' } });

    try {
      req.body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : '';
      await handler(req, res);
    } catch (error) {
      if (res.writableEnded) return;
      const tooLarge = error?.code === 'REQUEST_TOO_LARGE';
      res.status(tooLarge ? 413 : 500).json({
        error: {
          reason: tooLarge ? 'request-too-large' : 'service-unavailable',
          message: tooLarge ? 'Request body is too large.' : 'The BlueTap API is temporarily unavailable.',
        },
      });
    }
  };
}

function createAppServer(routeMap = routes) {
  const server = http.createServer(createRequestListener(routeMap));
  server.requestTimeout = 70_000;
  server.headersTimeout = 75_000;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`BlueTap backend listening on port ${port}`);
  });
}

module.exports = { MAX_REQUEST_BYTES, addResponseHelpers, createAppServer, createRequestListener, readBody };
