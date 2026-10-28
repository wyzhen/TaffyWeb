import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';

const root = resolve(import.meta.dirname, '..');
const origin = 'https://memories.test';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const note = (id, extra = {}) => ({id, type:'note', title:'测试：一起看日落', date:'2026-10-20', text:'这是隔离测试中的一条回忆。', ...extra});
function formFor(item, blob, filename) {
  const form = new FormData();
  for (const [key, value] of Object.entries(item)) form.set(key, value);
  if (blob) form.set('file', blob, filename || 'memory');
  return form;
}

test('cloud album survives fresh clients and runtime restarts with real D1 and R2', {timeout:180000}, async t => {
  const state = await mkdtemp(join(tmpdir(), 'taffy-cloud-test-'));
  const options = {modules:true, scriptPath:join(root, 'test/qa-worker.mjs'), modulesRoot:root, modulesRules:[{type:'ESModule',include:['**/*.js'],fallthrough:true}],
    bindings:{OWNER_EMAIL:'owner@taffy.local'}, compatibilityDate:'2026-05-01', d1Databases:{DB:'taffy-test-db'}, r2Buckets:['BUCKET'],
    d1Persist:join(state,'d1'), r2Persist:join(state,'r2')};
  let mf = new Miniflare(options);
  const request = async (path, options = {}) => {
    if (options.body instanceof FormData) {
      const encoded = new Request(origin + path, options);
      options = {...options, headers:Object.fromEntries(encoded.headers), body:Buffer.from(await encoded.arrayBuffer())};
    }
    return mf.dispatchFetch(origin + path, {...options,headers:{'oai-authenticated-user-id':'test-owner','oai-authenticated-user-email':'owner@taffy.local',...options.headers}});
  };
  const json = async (path, options) => { const response = await request(path, options); const body = await response.json(); return {response,body}; };
  const post = (item, blob, filename) => json('/api/memories',{method:'POST',body:formFor(item,blob,filename)});
  const put = (path, body, headers = {}) => json(path,{method:'PUT',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const png = await readFile(join(root,'dist/assets/hero.png'));
  const mp4 = await readFile(join(root,'dist/assets/memory-film.mp4'));
  try {
    const db = await mf.getD1Database('DB');
    const files = (await readdir(join(root,'drizzle'))).filter(name=>name.endsWith('.sql')).sort();
    assert.ok(files.length, 'generated schema migrations must exist');
    for (const name of files) {
      const sql = await readFile(join(root,'drizzle',name),'utf8');
      for (const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    await t.test('initial capacity reports actual usage and distinguishes unknown account quota', async()=>{
      const {response,body} = await json('/api/storage');
      assert.equal(response.status,200); assert.equal(body.connected,true);
      assert.equal(body.mediaUsedBytes,0); assert.equal(body.mediaCount,0); assert.equal(body.memoryCount,0);
      assert.equal(body.databaseLimitBytes,10_000_000_000);
      assert.equal(body.mediaLimitBytes,null); assert.equal(body.accountRemainingBytes,null);
      assert.equal(response.headers.get('cache-control'),'private, no-store');
    });
    await t.test('note, PNG and MP4 save in cloud with exact readable media bytes', async()=>{
      assert.equal((await post(note('m-test-note'))).response.status,201);
      const image = await post(note('m-test-photo',{type:'photo'}),new Blob([png],{type:'image/png'}),'记忆.png');
      assert.equal(image.response.status,201); assert.equal(image.body.memory.byteSize,png.length);
      const video = await post(note('m-test-video',{type:'video'}),new Blob([mp4],{type:'video/mp4'}),'夏天.mp4');
      assert.equal(video.response.status,201); assert.equal(video.body.memory.byteSize,mp4.length);
      for (const [id,bytes,mime] of [['m-test-photo',png,'image/png'],['m-test-video',mp4,'video/mp4']]) {
        const res = await request(`/api/media/${id}`);
        assert.equal(res.status,200); assert.equal(res.headers.get('content-type'),mime);
        assert.equal(res.headers.get('x-content-type-options'),'nosniff');
        assert.match(res.headers.get('cache-control'),/private/);
        assert.equal(sha(Buffer.from(await res.arrayBuffer())),sha(bytes));
      }
    });
    await t.test('private video byte ranges support playback and seeking', async()=>{
      const res = await request('/api/media/m-test-video',{headers:{range:'bytes=17-72'}});
      assert.equal(res.status,206); assert.equal(res.headers.get('content-range'),`bytes 17-72/${mp4.length}`);
      assert.equal(res.headers.get('content-length'),'56');
      assert.deepEqual(Buffer.from(await res.arrayBuffer()),mp4.subarray(17,73));
      const suffix = await request('/api/media/m-test-video',{headers:{range:'bytes=-20'}});
      assert.equal(suffix.status,206); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),mp4.subarray(-20));
      const head = await request('/api/media/m-test-video',{method:'HEAD'});
      assert.equal(head.status,200); assert.equal(head.headers.get('content-length'),String(mp4.length)); assert.equal((await head.arrayBuffer()).byteLength,0);
      for (const range of ['bytes=999999999-','bytes=25-10','bytes=0-1,4-5','bytes=-0']) {
        const invalid = await request('/api/media/m-test-video',{headers:{range}});
        assert.equal(invalid.status,416,range);
      }
    });
    await t.test('retrying a migrated id never duplicates media or overwrites the cloud original', async()=>{
      const before = (await json('/api/storage')).body;
      const again = await post(note('m-test-photo',{type:'photo',title:'不得覆盖原内容'}),new Blob([png],{type:'image/png'}),'different.png');
      assert.equal(again.response.status,200); assert.equal(again.body.alreadyExists,true);
      assert.equal(again.body.memory.title,'测试：一起看日落');
      const after = (await json('/api/storage')).body;
      assert.equal(after.mediaUsedBytes,before.mediaUsedBytes); assert.equal(after.memoryCount,before.memoryCount);
      const race = await Promise.all([post(note('m-test-race',{type:'photo'}),new Blob([png],{type:'image/png'})),post(note('m-test-race',{type:'photo'}),new Blob([png],{type:'image/png'}))]);
      assert.deepEqual(race.map(x=>x.response.status).sort(),[200,201]);
      const bucket = await mf.getR2Bucket('BUCKET');
      const uploaded = await bucket.list({prefix:'memories/'});
      assert.equal(uploaded.objects.length,3,'only winning photo/video/race objects remain');
    });
    await t.test('profile and favorite changes persist after completely restarting Worker and fresh client read', async()=>{
      assert.equal((await put('/api/profile',{names:'小宇 & 小桃',start:'2024-05-20'})).response.status,200);
      assert.equal((await put('/api/favorites/m-test-photo',{liked:true})).response.status,200);
      assert.equal((await put('/api/favorites/s1',{liked:true})).response.status,200);
      await mf.dispose(); mf = new Miniflare(options);
      const {response,body} = await json('/api/memories');
      assert.equal(response.status,200); assert.equal(body.memories.length,4);
      assert.deepEqual(body.profile,{names:'小宇 & 小桃',start:'2024-05-20'});
      assert.ok(body.favorites.includes('m-test-photo')); assert.ok(body.favorites.includes('s1'));
      assert.equal(body.storage.mediaUsedBytes,png.length*2+mp4.length);
      assert.equal(body.storage.mediaCount,3);
      const bytes = await (await request('/api/media/m-test-photo')).arrayBuffer();
      assert.equal(sha(Buffer.from(bytes)),sha(png));
    });
    await t.test('invalid input and cross-site writes reject without changing saved records', async()=>{
      for (const bad of [note('m-bad-type',{type:'executable'}),note('m-bad-date',{date:'2026-02-30'}),note('m-bad-future',{date:'2099-01-01'}),note('m-bad-empty',{title:' '})]) assert.equal((await post(bad)).response.status,400);
      const svg = await post(note('m-bad-svg',{type:'photo'}),new Blob(['<svg/>'],{type:'image/svg+xml'}),'image.svg');
      assert.equal(svg.response.status,415);
      const big = await post(note('m-bad-big',{type:'video'}),new Blob([new Uint8Array(30*1024*1024+1)],{type:'video/mp4'}),'large.mp4');
      assert.equal(big.response.status,413);
      const cross = await request('/api/memories',{method:'POST',headers:{origin:'https://other.test'},body:formFor(note('m-cross-site'))});
      assert.equal(cross.status,403);
      assert.equal((await put('/api/profile',{names:'unsafe',start:''},{'sec-fetch-site':'cross-site'})).response.status,403);
      const unchanged = (await json('/api/memories')).body;
      assert.equal(unchanged.memories.length,4); assert.equal(unchanged.profile.names,'小宇 & 小桃');
    });
    await t.test('delete removes media, favorite and accounted bytes; retries are safe', async()=>{
      const res = await json('/api/memories/m-test-photo',{method:'DELETE'}); assert.equal(res.response.status,200);
      assert.equal((await request('/api/media/m-test-photo')).status,404);
      assert.equal((await json('/api/memories/m-test-photo',{method:'DELETE'})).response.status,200);
      const after = (await json('/api/memories')).body;
      assert.equal(after.memories.length,3); assert.ok(!after.favorites.includes('m-test-photo'));
      assert.equal(after.storage.mediaUsedBytes,png.length+mp4.length); assert.equal(after.storage.mediaCount,2);
      const bucket = await mf.getR2Bucket('BUCKET');
      assert.equal((await bucket.list({prefix:'memories/'})).objects.length,2);
    });
  } finally { await mf.dispose(); await rm(state,{recursive:true,force:true}); }
});
