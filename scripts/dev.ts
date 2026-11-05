// Runs the API/websocket server and the Vite client together.
// Usage: npm run dev   (Ctrl+C stops both)
import { spawn, type ChildProcess } from 'node:child_process';

const tasks = [
  { name: 'server', color: '\x1b[36m', script: 'dev:server' },
  { name: 'client', color: '\x1b[35m', script: 'dev:client' },
];

const children: ChildProcess[] = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}

for (const { name, color, script } of tasks) {
  const child = spawn('npm', ['run', '--silent', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  children.push(child);
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) out.write(prefix + l + '\n');
    });
  };
  pipe(child.stdout!, process.stdout);
  pipe(child.stderr!, process.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown) console.error(`${prefix}exited with code ${code}`);
    shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
