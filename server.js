// Zero-dependency static file server.
// Usage: node server.js [--port <n>]   (or `npm start`)
//        node server.js 3000
//        PORT=3000 npm start
// If the requested port is in use, the next free port is used and reported.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const MAX_PORT_SEARCH = 100;

function parseArgs(argv) {
  let port = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      const value = argv[i + 1];
      i++;
      if (value === undefined) return { error: '--port needs a value' };
      port = value;
    } else if (arg.startsWith('--port=') || arg.startsWith('-p=')) {
      port = arg.slice(arg.indexOf('=') + 1);
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (arg.startsWith('-')) {
      return { error: `unknown option: ${arg}` };
    } else if (/^\d+$/.test(arg)) {
      if (port !== null) return { error: 'multiple ports given' };
      port = arg;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  return { port };
}

const parsed = parseArgs(process.argv.slice(2));

if (parsed.help) {
  console.log('Usage: node server.js [--port <n>] [port]');
  console.log('  --port <n>, -p <n>, --port=<n>   Port to serve on (default 8080, or $PORT)');
  console.log('  <n>                               Same as --port <n>');
  console.log('  --help, -h                        Show this help');
  console.log('If the requested port is unavailable, the next free port is used.');
  process.exit(0);
}
if (parsed.error) {
  console.error(`Error: ${parsed.error}`);
  console.error('Run "node server.js --help" for usage.');
  process.exit(1);
}

let requestedPort;
if (parsed.port !== null) {
  requestedPort = Number(parsed.port);
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
    console.error(`Error: invalid port "${parsed.port}" — must be an integer 1-65535.`);
    process.exit(1);
  }
} else if (process.env.PORT) {
  requestedPort = Number(process.env.PORT);
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
    console.error(`Error: invalid PORT "${process.env.PORT}" — must be an integer 1-65535.`);
    process.exit(1);
  }
} else {
  requestedPort = 8080;
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function createServer() {
  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
      res.writeHead(400); res.end('bad request'); return;
    }
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.normalize(path.join(root, pathname));
    if (!filePath.startsWith(root)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
}

function listenOn(port, attemptsLeft) {
  const server = createServer();
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`Port ${port} in use — trying ${port + 1}…`);
      listenOn(port + 1, attemptsLeft - 1);
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: no free port found within ${MAX_PORT_SEARCH} of ${requestedPort}.`);
      process.exit(1);
    }
    console.error(`Error: failed to start server: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`Sunnydale Grid → http://localhost:${port}/`);
  });
}

listenOn(requestedPort, MAX_PORT_SEARCH);
