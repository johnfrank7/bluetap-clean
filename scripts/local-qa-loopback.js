// Expo's --localhost controls advertised URLs, but Metro may otherwise bind
// every interface. Restrict only the explicitly configured local-QA web port.
const http = require('node:http');
const net = require('node:net');

const port = Number(process.env.BLUETAP_QA_WEB_PORT);
if (process.env.EXPO_PUBLIC_LOCAL_QA !== '1' || process.env.EXPO_PUBLIC_APP_ENV !== 'local-qa' ||
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== 'demo-bluetap-local-qa' ||
    process.env.EXPO_PUBLIC_API_BASE_URL !== 'http://127.0.0.1:3000' ||
    process.env.EXPO_PUBLIC_AUTH_EMULATOR_URL !== 'http://127.0.0.1:9099' ||
    process.env.EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST !== '127.0.0.1' ||
    process.env.EXPO_PUBLIC_FIRESTORE_EMULATOR_PORT !== '8080' || ![8081, 8082].includes(port)) {
  throw new Error('The QA web listener requires the isolated local emulator configuration.');
}

const listen = http.Server.prototype.listen;
const writeHead = http.ServerResponse.prototype.writeHead;
const localQaPolicy = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' http://127.0.0.1:3000 http://127.0.0.1:8080 http://127.0.0.1:9099 ws://localhost:8081 ws://127.0.0.1:8081 ws://localhost:8082 ws://127.0.0.1:8082",
  "object-src 'none'",
].join('; ');
http.ServerResponse.prototype.writeHead = function writeQaHeaders(...args) {
  if (this.req?.socket?.localPort === port) {
    this.setHeader('Content-Security-Policy', localQaPolicy);
  }
  return writeHead.apply(this, args);
};
http.Server.prototype.listen = function listenOnQaLoopback(...args) {
  let isQaListener = false;
  if (typeof args[0] === 'object' && args[0] !== null && Number(args[0].port) === port) {
    args[0] = { ...args[0], host: '127.0.0.1' };
    isQaListener = true;
  } else if (Number(args[0]) === port) {
    if (typeof args[1] === 'function') args.splice(1, 0, '127.0.0.1');
    else args[1] = '127.0.0.1';
    isQaListener = true;
  }
  if (isQaListener) {
    const metro = this;
    metro.once('listening', () => {
      // Windows can resolve localhost to ::1 while a different process owns
      // that address. Reserve it and forward only to this IPv4 QA listener.
      const proxy = net.createServer((client) => {
        const upstream = net.connect({ host: '127.0.0.1', port });
        client.on('error', () => upstream.destroy());
        upstream.on('error', () => client.destroy());
        client.pipe(upstream).pipe(client);
      });
      proxy.on('error', () => {
        console.error('Local QA cannot reserve the IPv6 localhost port; stop the conflicting server.');
        metro.close();
        process.exit(1);
      });
      metro.once('close', () => proxy.close());
      proxy.listen({ host: '::1', port, ipv6Only: true });
    });
  }
  return listen.apply(this, args);
};
