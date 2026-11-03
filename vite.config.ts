import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Writes dist/sw.js with the built files to precache, and a version that changes whenever any of them do. */
function serviceWorker(): Plugin {
  const out = path.resolve('dist');
  return {
    name: 'devart-service-worker',
    apply: 'build',
    closeBundle() {
      const files = readdirSync(out, { recursive: true, withFileTypes: true })
        .filter((f) => f.isFile() && f.name !== 'sw.js')
        .map((f) => path.relative(out, path.join(f.parentPath, f.name)).replaceAll('\\', '/'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(path.join(out, f)));
      const template = readFileSync(path.resolve('client/sw-template.js'), 'utf8');
      hash.update(template);
      const sw = template
        .replace('self.__PRECACHE__', JSON.stringify(files.map((f) => `/${f}`)))
        .replace('self.__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 16)));
      writeFileSync(path.join(out, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  root: 'client',
  plugins: [react(), serviceWorker()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    fs: { allow: ['..'] },
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/mcp': 'http://127.0.0.1:4000',
      '/embed': 'http://127.0.0.1:4000',
      '/collab': { target: 'ws://127.0.0.1:4000', ws: true },
    },
  },
});
