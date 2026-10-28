import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';

const root = resolve(import.meta.dirname,'..');
const origin = 'https://memories.test';
const MiB = 1024 * 1024;
const metadata = (id,size,extra = {}) => ({id,title:'一段很长的夏日影像',text:'这是隔离的大视频上传测试。',date:'2026-10-20',mime:'video/mp4',filename:'our-summer.mp4',byteSize:size,...extra});

test('large videos use bounded persistent R2 multipart uploads', {timeout:180000}, async t => {
  const state = await mkdtemp(join(tmpdir(),'taffy-video-test-'));
  const options = {modules:true,scriptPath:join(root,'test/qa-worker.mjs'),modulesRoot:root,modulesRules:[{type:'ESModule',include:['**/*.js'],fallthrough:true}],
    bindings:{OWNER_EMAIL:'owner@taffy.local'}, compatibilityDate:'2026-05-01',d1Databases:{DB:'taffy-video-db'},r2Buckets:['BUCKET'],d1Persist:join(state,'d1'),r2Persist:join(state,'r2')};
  let mf = new Miniflare(options);
  const request = (path,options = {}) => mf.dispatchFetch(origin+path,{...options,headers:{'oai-authenticated-user-id':'test-owner','oai-authenticated-user-email':'owner@taffy.local',...options.headers}});
  const json = async (path,options) => {const response = await request(path,options);return {response,body:await response.json()};};
  const init = item => json('/api/video-uploads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(item)});
  const part = (id,index,bytes) => json(`/api/video-uploads/${id}/parts/${index}`,{method:'PUT',body:bytes});
  const complete = id => json(`/api/video-uploads/${id}/complete`,{method:'POST'});
  const cancel = id => json(`/api/video-uploads/${id}`,{method:'DELETE'});
  try {
    const db = await mf.getD1Database('DB');
    for (const file of (await readdir(join(root,'drizzle'))).filter(x=>x.endsWith('.sql')).sort()) {
      const sql = await readFile(join(root,'drizzle',file),'utf8');
      for (const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    await t.test('1024 MiB is accepted; one byte over is rejected before allocating media',async()=>{
      const allowed = await init(metadata('m-max-video',1024*MiB));
      assert.equal(allowed.response.status,200);assert.equal(allowed.body.partCount,128);assert.equal(allowed.body.partSize,8*MiB);
      assert.deepEqual(allowed.body.uploadedParts,[]);
      assert.equal((await init(metadata('m-too-big',1024*MiB+1))).response.status,413);
      assert.equal((await init(metadata('m-empty',0))).response.status,400);
      assert.equal((await init(metadata('m-wrong-type',1,{mime:'text/html'}))).response.status,415);
      await cancel('m-max-video');
      const usage = (await json('/api/storage')).body;
      assert.equal(usage.maxPhotoBytes,30*MiB);assert.equal(usage.maxVideoBytes,1024*MiB);assert.equal(usage.uploadChunkBytes,8*MiB);
      assert.equal(usage.memoryCount,0);assert.equal(usage.mediaUsedBytes,0);
    });
    await t.test('video over the old 30 MiB cap survives interrupted upload and restarts',async()=>{
      const item = metadata('m-large-video',40*MiB+17);
      const session = await init(item);assert.equal(session.response.status,200);assert.equal(session.body.partCount,6);
      assert.equal((await part(item.id,0,Buffer.from('bad'))).response.status,400);
      assert.equal((await part(item.id,1,Buffer.from('short'))).response.status,400);
      const expected = createHash('sha256');
      for (let index=1;index<=2;index++) {
        const bytes = Buffer.alloc(8*MiB,index);expected.update(bytes);
        assert.equal((await part(item.id,index,bytes)).response.status,200);
      }
      assert.equal((await complete(item.id)).response.status,409,'incomplete parts must never create a memory');
      assert.equal((await json('/api/storage')).body.mediaUsedBytes,0,'pending parts are not presented as saved media');
      await mf.dispose();mf = new Miniflare(options);
      const resumed = await init(item);assert.deepEqual(resumed.body.uploadedParts,[1,2]);
      assert.equal((await part(item.id,2,Buffer.alloc(8*MiB,2))).response.status,200,'retrying a part is safe');
      for (let index=3;index<=6;index++) {
        const bytes = Buffer.alloc(index===6 ? 17 : 8*MiB,index);expected.update(bytes);
        assert.equal((await part(item.id,index,bytes)).response.status,200);
      }
      const saved = await complete(item.id);assert.equal(saved.response.status,201);assert.equal(saved.body.memory.byteSize,item.byteSize);
      const result = await request(saved.body.memory.src);assert.equal(result.status,200);
      const actual = createHash('sha256');let size = 0;
      for await (const chunk of result.body) {actual.update(chunk);size += chunk.byteLength;}
      assert.equal(size,item.byteSize);assert.equal(actual.digest('hex'),expected.digest('hex'),'every byte from all six parts must be preserved');
      const range = await request(saved.body.memory.src,{headers:{range:`bytes=${8*MiB-16}-${8*MiB+15}`}});
      assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),Buffer.concat([Buffer.alloc(16,1),Buffer.alloc(16,2)]));
      const download = await request(saved.body.memory.src+'?download=1',{method:'HEAD'});
      assert.match(download.headers.get('content-disposition'),/^attachment;/);
      assert.equal((await complete(item.id)).response.status,200,'repeating completion after network loss returns the saved memory');
      assert.equal((await init(item)).body.alreadyExists,true);
      const usage = (await json('/api/storage')).body;assert.equal(usage.mediaUsedBytes,item.byteSize);assert.equal(usage.mediaCount,1);
      const currentDB = await mf.getD1Database('DB');
      assert.equal((await currentDB.prepare('SELECT COUNT(*) AS n FROM video_uploads').first()).n,0);
      assert.equal((await currentDB.prepare('SELECT COUNT(*) AS n FROM video_upload_parts').first()).n,0);
      assert.equal((await cancel(item.id)).body.alreadyCompleted,true,'cancel cannot delete an already committed memory');
      assert.equal((await request(saved.body.memory.src,{method:'HEAD'})).status,200);
      await json(`/api/memories/${item.id}`,{method:'DELETE'});
    });
    await t.test('cancel and expiry clean partial uploads without recording incomplete memories',async()=>{
      const id = 'm-cancelled-video';await init(metadata(id,9*MiB));
      await part(id,1,Buffer.alloc(8*MiB,7));
      assert.equal((await cancel(id)).body.cancelled,true);
      assert.equal((await part(id,2,Buffer.from('x'))).response.status,404);
      assert.equal((await complete(id)).response.status,404);
      assert.equal((await cancel(id)).response.status,200);
      const expired = 'm-expired-video';await init(metadata(expired,9*MiB));await part(expired,1,Buffer.alloc(8*MiB,9));
      const currentDB = await mf.getD1Database('DB');
      await currentDB.prepare('UPDATE video_uploads SET expires_at = ? WHERE memory_id = ?').bind('2020-01-01T00:00:00.000Z',expired).run();
      assert.equal((await part(expired,2,Buffer.from('x'))).response.status,410);
      await init(metadata('m-after-expiry',1));
      assert.equal(await currentDB.prepare('SELECT memory_id FROM video_uploads WHERE memory_id = ?').bind(expired).first(),null);
      assert.equal((await currentDB.prepare('SELECT COUNT(*) AS n FROM video_upload_parts').first()).n,0);
      await cancel('m-after-expiry');
      const usage = (await json('/api/storage')).body;assert.equal(usage.mediaUsedBytes,0);assert.equal(usage.memoryCount,0);
    });
    await t.test('cross-origin requests cannot create multipart sessions',async()=>{
      const result = await json('/api/video-uploads',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:JSON.stringify(metadata('m-cross-video',1))});
      assert.equal(result.response.status,403);
    });
  } finally {await mf.dispose();await rm(state,{recursive:true,force:true});}
});
