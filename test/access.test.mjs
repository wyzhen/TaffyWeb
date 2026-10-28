import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Miniflare} from 'miniflare';

const root = resolve(import.meta.dirname,'..');
const origin = 'https://album.test';
const owner = {'oai-authenticated-user-id':'owner-stable-id','oai-authenticated-user-email':'owner@taffy.local'};
const visitor = {'oai-authenticated-user-id':'visitor-id','oai-authenticated-user-email':'visitor@taffy.local'};

test('public readers cannot perform any owner-only mutation', {timeout:120000}, async t => {
  const state = await mkdtemp(join(tmpdir(),'taffy-access-'));
  const base = {modules:true,scriptPath:join(root,'test/qa-worker.mjs'),modulesRoot:root,modulesRules:[{type:'ESModule',include:['**/*.js'],fallthrough:true}],
    compatibilityDate:'2026-05-01',d1Databases:{DB:'access-test-db'},r2Buckets:['BUCKET'],d1Persist:join(state,'d1'),r2Persist:join(state,'r2')};
  let mf = new Miniflare({...base,bindings:{}});
  const request = (path,options = {},identity = {}) => mf.dispatchFetch(origin+path,{...options,headers:{...identity,...options.headers}});
  const json = async(path,options,identity) => {const response = await request(path,options,identity);return {response,body:await response.json()};};
  const write = (method,value) => ({method,headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  const video = {id:'m-protected-video',title:'只有主人能收藏',text:'公开只读测试',date:'2026-10-20',mime:'video/mp4',filename:'video.mp4',byteSize:1};
  try {
    const db = await mf.getD1Database('DB');
    for (const file of (await readdir(join(root,'drizzle'))).filter(x=>x.endsWith('.sql')).sort()) {
      const sql = await readFile(join(root,'drizzle',file),'utf8');
      for (const statement of sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    await t.test('missing owner configuration denies edits even to signed-in identities',async()=>{
      assert.equal((await json('/api/session',{},owner)).body.canWrite,false);
      assert.equal((await request('/api/profile',write('PUT',{names:'cannot claim',start:''}),owner)).status,403);
      assert.equal(await db.prepare('SELECT value FROM settings WHERE key = ?').bind('owner-user-id').first(),null);
    });
    await mf.dispose();mf = new Miniflare({...base,bindings:{OWNER_EMAIL:'owner@taffy.local'}});
    await t.test('visitors cannot claim ownership before the verified owner first signs in',async()=>{
      assert.deepEqual((await json('/api/session')).body,{authenticated:false,canWrite:false});
      assert.deepEqual((await json('/api/session',{},visitor)).body,{authenticated:true,canWrite:false});
      assert.equal((await json('/api/session',{}, {'oai-authenticated-user-email':'owner@taffy.local'})).body.canWrite,false);
      assert.equal((await request('/api/profile',write('PUT',{names:'visitor claim',start:''}),visitor)).status,403);
      const currentDB = await mf.getD1Database('DB');
      assert.equal(await currentDB.prepare('SELECT value FROM settings WHERE key = ?').bind('owner-user-id').first(),null);
      assert.equal((await json('/api/session',{},owner)).body.canWrite,true);
    });
    await t.test('owner identity remains bound to a stable user ID across email changes and restarts',async()=>{
      const changed = {...owner,'oai-authenticated-user-email':'new-owner-email@example.test'};
      assert.equal((await json('/api/session',{},changed)).body.canWrite,true);
      const otherIDWithSameEmail = {...visitor,'oai-authenticated-user-email':'owner@taffy.local'};
      assert.equal((await json('/api/session',{},otherIDWithSameEmail)).body.canWrite,false);
      await mf.dispose();mf = new Miniflare({...base,bindings:{OWNER_EMAIL:'owner@taffy.local'}});
      assert.equal((await json('/api/session',{},owner)).body.canWrite,true);
    });
    await t.test('the owner can create memories, upload video, edit settings and favorites',async()=>{
      const form = new FormData();for (const [key,value] of Object.entries({id:'m-owner-note',type:'note',title:'主人的回忆',text:'访客可看不可改。',date:'2026-10-20'})) form.set(key,value);
      const encoded = new Request(origin+'/api/memories',{method:'POST',body:form});
      assert.equal((await request('/api/memories',{method:'POST',headers:Object.fromEntries(encoded.headers),body:Buffer.from(await encoded.arrayBuffer())},owner)).status,201);
      assert.equal((await request('/api/profile',write('PUT',{names:'我 & 你',start:'2025-05-20'}),owner)).status,200);
      assert.equal((await request('/api/favorites/m-owner-note',write('PUT',{liked:true}),owner)).status,200);
      assert.equal((await request('/api/video-uploads',write('POST',video),owner)).status,200);
    });
    await t.test('all mutation routes reject anonymous and other signed-in readers before processing bodies',async()=>{
      const routes = [
        ['/api/memories',{method:'POST',body:'forged'}],
        ['/api/profile',write('PUT',{names:'hacked',start:''})],
        ['/api/favorites/m-owner-note',write('PUT',{liked:false})],
        ['/api/memories/m-owner-note',{method:'DELETE'}],
        ['/api/video-uploads',write('POST',video)],
        ['/api/video-uploads/m-protected-video/parts/1',{method:'PUT',body:'x'}],
        ['/api/video-uploads/m-protected-video/complete',{method:'POST'}],
        ['/api/video-uploads/m-protected-video',{method:'DELETE'}],
      ];
      for (const [route,options] of routes) {
        assert.equal((await request(route,options)).status,401,`${options.method} ${route} anonymous`);
        assert.equal((await request(route,options,visitor)).status,403,`${options.method} ${route} visitor`);
      }
      // Client flags or service authorization without a user identity do not
      // grant write permission. Only Sites-authenticated identity is trusted.
      assert.equal((await request('/api/profile?canWrite=true',write('PUT',{names:'hacked',start:'',isOwner:true}),{'x-user-role':'owner','OAI-Sites-Authorization':'Bearer service-test'})).status,401);
      const list = (await json('/api/memories')).body;
      assert.equal(list.profile.names,'我 & 你');assert.equal(list.memories.length,1);assert(list.favorites.includes('m-owner-note'));
      assert.equal(list.permission.canWrite,false);assert.equal(JSON.stringify(list).includes('owner@taffy.local'),false);
    });
    await t.test('anonymous visitors can browse media while the owner can complete and delete it',async()=>{
      assert.equal((await request('/api/video-uploads/m-protected-video/parts/1',{method:'PUT',body:'x'},owner)).status,200);
      assert.equal((await request('/api/video-uploads/m-protected-video/complete',{method:'POST'},owner)).status,201);
      const file = await request('/api/media/m-protected-video');assert.equal(file.status,200);assert.equal(await file.text(),'x');
      assert.equal((await request('/api/media/m-protected-video',{headers:{range:'bytes=0-0'}})).status,206);
      assert.equal((await request('/api/memories/m-protected-video',{method:'DELETE'},owner)).status,200);
      assert.equal((await request('/api/memories/m-owner-note',{method:'DELETE'},owner)).status,200);
    });
  } finally {await mf.dispose();await rm(state,{recursive:true,force:true});}
});
