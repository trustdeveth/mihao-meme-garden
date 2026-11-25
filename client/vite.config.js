import { defineConfig } from 'vite';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

/** After a build, write .br and .gz copies of everything that shrinks (code, models, icons). */
function precompress() {
  const kinds = new Set(['.js', '.css', '.html', '.json', '.svg', '.glb']);
  let out;
  return {
    name: 'precompress',
    apply: 'build',
    configResolved(c) { out = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const file = join(dir, name);
          if (statSync(file).isDirectory()) { walk(file); continue; }
          if (!kinds.has(extname(name))) continue;
          const data = readFileSync(file);
          if (data.length < 1024) continue;
          writeFileSync(`${file}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }));
          writeFileSync(`${file}.gz`, gzipSync(data, { level: 9 }));
        }
      };
      walk(out);
    },
  };
}

export default defineConfig({
  plugins: [precompress()],
  server: {
    host: '127.0.0.1',
    port: 5190,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8850',
      '/ws': { target: 'ws://127.0.0.1:8850', ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined) },
    },
  },
});
