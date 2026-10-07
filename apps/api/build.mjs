// Bundles the API into dist/server.js (+ migrations and BLS data next to it).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const version = process.env.APP_VERSION || pkg.version;

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Native addon: installed in the runtime image instead of bundled.
  external: ['@node-rs/argon2'],
  define: { __APP_VERSION__: JSON.stringify(version) },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
cpSync('drizzle', 'dist/drizzle', { recursive: true });
cpSync('data', 'dist/data', { recursive: true });
console.log(`built @ft/api ${version}`);
