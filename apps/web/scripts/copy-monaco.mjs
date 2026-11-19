// Copy Monaco's prebuilt AMD files into public/ so the editor is served by this app (no CDN).
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkg = path.dirname(require.resolve('monaco-editor/package.json'));
const { version } = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8'));
const out = path.join(import.meta.dirname, '..', 'public', 'monaco');
const stamp = path.join(out, '.version');
if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version) process.exit(0);
cpSync(path.join(pkg, 'min', 'vs'), path.join(out, 'vs'), { recursive: true });
writeFileSync(stamp, version);
console.log(`monaco-editor ${version} copied to public/monaco`);
