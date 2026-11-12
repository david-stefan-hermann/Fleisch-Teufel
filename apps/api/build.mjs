// Bundles the API into dist/server.js (+ migrations and BLS data next to it) and the password reset script into
// dist/reset-password.js (the image copies dist to /app: `docker exec -it fleisch-teufel node reset-password.js`).
// BUILD_OUT changes the output folder (the build test writes to a throwaway one).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const version = process.env.APP_VERSION || pkg.version;
const out = process.env.BUILD_OUT || 'dist';

const options = {
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
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({ ...options, entryPoints: ['src/server.ts'], outfile: `${out}/server.js` });
await build({ ...options, entryPoints: ['scripts/reset-password.ts'], outfile: `${out}/reset-password.js` });
cpSync('drizzle', `${out}/drizzle`, { recursive: true });
cpSync('data', `${out}/data`, { recursive: true });
console.log(`built @ft/api ${version}`);
