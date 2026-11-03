// Starts DevArt on demand and manages its Windows shortcuts.
//   open (default)  start the server if it isn't running, then open the app window
//   start           start the server if it isn't running, with no window
//   stop            stop a server this launcher started
//   install         add Desktop and Start Menu shortcuts
//   uninstall       remove those shortcuts
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4000);
const URL_BASE = `http://127.0.0.1:${PORT}`;
const DATA = process.env.DEVART_DATA ?? path.join(ROOT, 'data');
const PID_FILE = path.join(DATA, 'server.pid');
const LOG_FILE = path.join(DATA, 'server.log');
const START_TIMEOUT_MS = 20_000;

function log(message: string) {
  mkdirSync(DATA, { recursive: true });
  appendFileSync(LOG_FILE, `[launcher ${new Date().toISOString()}] ${message}\n`);
}

function fail(message: string): never {
  log(message);
  console.error(message);
  process.exit(1);
}

type ServerState = 'devart' | 'other' | 'none';

async function serverState(): Promise<ServerState> {
  try {
    const res = await fetch(`${URL_BASE}/api/v1/me`, { signal: AbortSignal.timeout(2000) });
    const body = await res.json() as { id?: string };
    return body.id ? 'devart' : 'other';
  } catch (e) {
    // Refused means the port is free; anything that answered oddly is some other program.
    const code = (e as { cause?: { code?: string } }).cause?.code;
    return code === 'ECONNREFUSED' ? 'none' : 'other';
  }
}

function ensureBuilt() {
  if (existsSync(path.join(ROOT, 'dist', 'index.html'))) return;
  log('No build found. Building the app.');
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [vite, 'build'], { cwd: ROOT, windowsHide: true, stdio: 'ignore' });
  if (r.status !== 0) fail('The app could not be built. Run "npm install" and "npm run build" in the DevArt folder.');
}

async function startServer() {
  ensureBuilt();
  mkdirSync(DATA, { recursive: true });
  const logFd = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, ['server/index.ts'], {
    cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PORT: String(PORT), DEVART_DATA: DATA },
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await serverState() === 'devart') return;
    await new Promise((r) => setTimeout(r, 200));
  }
  fail(`The DevArt server didn't start within ${START_TIMEOUT_MS / 1000} seconds.`);
}

function findBrowser() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
  const candidates = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'];
  for (const c of candidates) for (const r of roots) {
    const p = path.join(r, c);
    if (existsSync(p)) return p;
  }
  return null;
}

function openApp() {
  if (process.env.DEVART_OPEN === '0') return;
  const browser = findBrowser();
  // App mode gives DevArt its own window and shares saved data with an installed copy.
  const child = browser
    ? spawn(browser, [`--app=${URL_BASE}/`], { detached: true, stdio: 'ignore' })
    : spawn('cmd', ['/c', 'start', '', `${URL_BASE}/`], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

async function start() {
  const state = await serverState();
  if (state === 'other') fail(`Port ${PORT} is being used by another program, so DevArt can't start.`);
  if (state === 'none') await startServer();
}

async function open() {
  await start();
  openApp();
}

const powershell = (script: string) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function stop() {
  const pid = existsSync(PID_FILE) ? Number(readFileSync(PID_FILE, 'utf8')) : NaN;
  const commandLine = Number.isInteger(pid) ? powershell(`(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`).stdout : '';
  // The PID file can be stale, so confirm the process really is DevArt's server before stopping it.
  if (!commandLine.includes('server/index.ts')) {
    rmSync(PID_FILE, { force: true });
    if (await serverState() === 'devart') fail('DevArt is running, but it was started some other way. Stop it from where you started it, such as with Ctrl+C in its terminal.');
    console.log('DevArt is not running.');
    return;
  }
  process.kill(pid);
  rmSync(PID_FILE, { force: true });
  console.log('DevArt stopped.');
}

/** Windows icons can wrap a PNG directly: a 6-byte header, one 16-byte entry, then the image. */
function writeIcon(target: string) {
  const png = readFileSync(path.join(ROOT, 'client', 'public', 'icon-192.png'));
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 192;
  header[7] = 192;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  writeFileSync(target, Buffer.concat([header, png]));
}

const SHORTCUT_FOLDERS = "@([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))";

function install() {
  const icon = path.join(ROOT, 'scripts', 'devart.ico');
  writeIcon(icon);
  const script = `
    $shell = New-Object -ComObject WScript.Shell
    foreach ($folder in ${SHORTCUT_FOLDERS}) {
      $link = $shell.CreateShortcut((Join-Path $folder 'DevArt.lnk'))
      $link.TargetPath = 'wscript.exe'
      $link.Arguments = '"' + ${psQuote(path.join(ROOT, 'scripts', 'DevArt.vbs'))} + '"'
      $link.WorkingDirectory = ${psQuote(ROOT)}
      $link.IconLocation = ${psQuote(icon)}
      $link.Description = 'Start DevArt and open it'
      $link.Save()
      $link.FullName
    }`;
  const r = powershell(script);
  if (r.status !== 0) fail(`Could not create the shortcuts: ${r.stderr}`);
  console.log(`Created:\n${r.stdout.trim()}`);
}

function uninstall() {
  const r = powershell(`foreach ($folder in ${SHORTCUT_FOLDERS}) { Remove-Item -LiteralPath (Join-Path $folder 'DevArt.lnk') -ErrorAction SilentlyContinue }`);
  if (r.status !== 0) fail(`Could not remove the shortcuts: ${r.stderr}`);
  rmSync(path.join(ROOT, 'scripts', 'devart.ico'), { force: true });
  console.log('Shortcuts removed. Your files were not changed.');
}

const command = process.argv[2] ?? 'open';
if (command === 'open') await open();
else if (command === 'start') await start();
else if (command === 'stop') await stop();
else if (process.platform !== 'win32') fail('Shortcuts are only supported on Windows.');
else if (command === 'install') install();
else if (command === 'uninstall') uninstall();
else fail(`Unknown command: ${command}`);
process.exit(0);
