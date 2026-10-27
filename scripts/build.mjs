import {readFile, writeFile, mkdir, cp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// Follow the Sites Worker ESM artifact contract: one self-contained Worker and
// its hosting manifest. No framework, CDN, secrets, or private uploads in source.
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'outputs/site');
const assets = {};
for (const [file, mime] of [
  ['index.html','text/html; charset=utf-8'], ['app.js','text/javascript; charset=utf-8'],
  ['styles.css','text/css; charset=utf-8'], ['favicon.svg','image/svg+xml'],
  ['assets/hero.png','image/png'], ['assets/coast.png','image/png'],
  ['assets/cafe.png','image/png'], ['assets/memory-film.mp4','video/mp4'],
]) {
  const bytes = await readFile(resolve(root,'dist',file));
  assets[file === 'index.html' ? '/' : '/'+file] = file.endsWith('.png') || file.endsWith('.mp4')
    ? {mime,base64:bytes.toString('base64')} : {mime,text:bytes.toString('utf8')};
}
assets['/index.html'] = assets['/'];
const api = (await readFile(resolve(root,'worker/api.js'),'utf8')).replace('export async function api(', 'async function api(');
const entry = (await readFile(resolve(root,'worker/index.js'),'utf8')).replace("import { api } from './api.js';",'').replace('__TAFFY_ASSETS__',() => JSON.stringify(assets));
const bundled = api + '\n' + entry;
const manifest = JSON.parse(await readFile(resolve(root,'.openai/hosting.json'),'utf8'));
assert.equal(manifest.project_id, 'appgprj_6ae0bdb36abc81918694ab8e52e6be81');
assert.ok(!manifest.static, 'Cloud deployment must use the Worker');
await rm(out,{recursive:true,force:true});
await mkdir(resolve(out,'server'),{recursive:true});
await mkdir(resolve(out,'.openai'),{recursive:true});
await writeFile(resolve(out,'server/index.js'),bundled);
await writeFile(resolve(out,'.openai/hosting.json'),JSON.stringify(manifest,null,2)+'\n');
await cp(resolve(root,'drizzle'),resolve(out,'drizzle'),{recursive:true});
// Dynamic import uses ESM regardless of the output directory's package state.
const module = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
assert.equal(typeof module.default.fetch,'function');
const servedScript = await module.default.fetch(new Request('https://build.test/app.js'),{});
assert.equal(await servedScript.text(),assets['/app.js'].text,'Bundling must preserve the browser script byte for byte');
console.log('Built and validated Sites Worker ESM artifact:',out);
