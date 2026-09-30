import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEMO_DIST = join(WEB_ROOT, 'dist-demo');
const OUTPUT_DIR = join(WEB_ROOT, '..', 'docs', 'screenshots');
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER_PORT = 5288;
const DEBUG_PORT = 9333;
const SETTLE_MS = 7000;
const IMAGE_QUALITY = 88;
const DESKTOP = { width: 1440, height: 1000, scale: 1.5 };
const PHONE = { width: 390, height: 844, scale: 2, mobile: true };
const VALENTIN = 'contact=33639980020%40s.whatsapp.net';

const SHOTS = [
  { name: 'overview-dark', query: VALENTIN, scheme: 'dark', ...DESKTOP },
  { name: 'overview-light', query: VALENTIN, scheme: 'light', ...DESKTOP },
  { name: 'activity-dark', query: 'openPanel=activity', scheme: 'dark', ...DESKTOP },
  { name: 'settings-light', query: 'openPanel=settings', scheme: 'light', ...DESKTOP },
  { name: 'policy-dark', query: 'openPanel=policy', scheme: 'dark', ...DESKTOP },
  { name: 'mobile-dark', query: '', scheme: 'dark', ...PHONE },
];

const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function serveDemo() {
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const file = join(DEMO_DIST, normalize(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(DEMO_DIST) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(SERVER_PORT, () => resolve(server)));
}

async function openTab() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const target = await (await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
      return target.webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('Chrome did not start');
}

async function capture(shot) {
  const socket = new WebSocket(await openTab());
  await new Promise((resolve) => (socket.onopen = resolve));
  let lastId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++lastId;
      pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
      socket.send(JSON.stringify({ id, method, params }));
    });

  const banner = 'hideBanner';
  await send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height, deviceScaleFactor: shot.scale, mobile: Boolean(shot.mobile) });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: shot.scheme }] });
  await send('Emulation.setLocaleOverride', { locale: 'en-US' });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Paris' });
  await send('Page.navigate', { url: `http://localhost:${SERVER_PORT}/?${[banner, shot.query].filter(Boolean).join('&')}` });
  await sleep(SETTLE_MS);
  const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: IMAGE_QUALITY });
  writeFileSync(join(OUTPUT_DIR, `${shot.name}.webp`), Buffer.from(data, 'base64'));
  socket.close();
  console.log(`captured ${shot.name}`);
}

if (!existsSync(join(DEMO_DIST, 'index.html'))) throw new Error('Run `npm run build:demo` first');
mkdirSync(OUTPUT_DIR, { recursive: true });

const server = await serveDemo();
const chrome = spawn(CHROME_PATH, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--lang=en-US', `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });
try {
  for (const shot of SHOTS) await capture(shot);
} finally {
  chrome.kill();
  server.close();
}
