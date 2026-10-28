const MAX_PHOTO = 30 * 1024 * 1024;
const MAX_VIDEO = 1024 * 1024 * 1024;
const VIDEO_PART = 8 * 1024 * 1024;
const UPLOAD_TTL = 24 * 60 * 60 * 1000;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']);
const KINDS = new Set(['photo', 'video', 'chat', 'note']);
const MEMORY_ID = /^m-[a-zA-Z0-9-]{1,90}$/;
const FAVORITE_ID = /^(?:s[1-6]|m-[a-zA-Z0-9-]{1,90})$/;
const SOURCE_URL = 'https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites';

class APIError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new APIError(status, message); };
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
function json(value, status = 200) {
  return Response.json(value, {status, headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
}
function checkWriteOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) fail(403, '请从回忆册网页内保存内容。');
  if (request.headers.get('sec-fetch-site') === 'cross-site') fail(403, '不接受其他网站发起的修改。');
}
function requireStorage(env) {
  if (!env.DB?.prepare || !env.BUCKET?.put) fail(503, '云端存储尚未连接，请稍后重试。');
}
async function bodyJSON(request, limit = 16384) {
  if (!request.headers.get('content-type')?.includes('application/json')) fail(415, '请使用 JSON 提交设置。');
  // JSON is only used for the small profile/favorite settings, never for media.
  if (Number(request.headers.get('content-length')) > limit) fail(413, '设置内容过长。');
  const reader = request.body?.getReader();
  if (!reader) fail(400, '缺少设置内容。');
  let total = 0; const chunks = [];
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    total += value.byteLength; if (total > limit) {await reader.cancel(); fail(413, '设置内容过长。');}
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch {fail(400, '设置格式不正确。');}
}
function record(row) {
  return {id:row.id,type:row.type,title:row.title,date:row.memory_date,text:row.body,location:row.location,
    ...(row.object_key ? {src:`/api/media/${encodeURIComponent(row.id)}`} : {}),
    byteSize:row.byte_size,mime:row.mime,filename:row.filename,createdAt:row.created_at};
}
async function storage(env) {
  const result = await env.DB.prepare('SELECT COUNT(*) AS memory_count, COALESCE(SUM(byte_size), 0) AS media_bytes, SUM(CASE WHEN object_key IS NOT NULL THEN 1 ELSE 0 END) AS media_count FROM memories').first();
  await env.BUCKET.head('_connection-check');
  return {connected:true,mediaUsedBytes:Number(result.media_bytes || 0),mediaCount:Number(result.media_count || 0),memoryCount:Number(result.memory_count || 0),
    databaseLimitBytes:10000000000,mediaLimitBytes:null,accountRemainingBytes:null,maxFileBytes:MAX_VIDEO,maxPhotoBytes:MAX_PHOTO,maxVideoBytes:MAX_VIDEO,uploadChunkBytes:VIDEO_PART,sourceUrl:SOURCE_URL,
    limitsNote:'数据库每站最多 10 GB；照片与视频未设固定的单站容量上限，仍受账号共享使用与存储限制约束。平台未提供账号剩余共享配额的查询接口。',
    measuredAt:new Date().toISOString()};
}
async function list(env) {
  const [rows, profile, likes, usage] = await Promise.all([
    env.DB.prepare('SELECT * FROM memories ORDER BY memory_date DESC, id DESC').all(),
    env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('profile').first(),
    env.DB.prepare('SELECT memory_id FROM favorites').all(),storage(env),
  ]);
  let savedProfile = {}; try {savedProfile = JSON.parse(profile?.value || '{}');} catch {}
  return json({memories:rows.results.map(record),profile:savedProfile,favorites:likes.results.map(row => row.memory_id),storage:usage});
}
async function upload(request, env) {
  if (!request.headers.get('content-type')?.includes('multipart/form-data')) fail(415, '请以表单方式提交回忆。');
  if (Number(request.headers.get('content-length')) > MAX_PHOTO + 131072) fail(413, '照片最大 30 MB；较大视频请使用分片上传，视频最大 1024 MB。');
  // Limit the entire form even when a client omits Content-Length.
  let bytesRead = 0;
  const bounded = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytesRead += chunk.byteLength;
      if (bytesRead > MAX_PHOTO + 131072) {controller.error(new APIError(413, '表单过大，请使用视频分片上传。')); return;}
      controller.enqueue(chunk);
    }
  }));
  let form;
  try {form = await new Response(bounded, {headers:{'content-type':request.headers.get('content-type')}}).formData();}
  catch (error) {if (error instanceof APIError || bytesRead > MAX_PHOTO + 131072) fail(413, '照片最大 30 MB；较大视频请使用分片上传，视频最大 1024 MB。'); fail(400, '未能读取上传内容，请重新选择文件。');}
  const field = name => typeof form.get(name) === 'string' ? form.get(name).trim() : '';
  const id = field('id') || `m-${crypto.randomUUID()}`;
  const type = field('type'), title = field('title'), date = field('date'), text = field('text');
  if (!MEMORY_ID.test(id)) fail(400, '回忆标识不正确。');
  if (!KINDS.has(type)) fail(400, '不支持这种回忆类型。');
  if (!title || title.length > 100) fail(400, '请填写 1–100 字的回忆标题。');
  if (!validDate(date) || date > today()) fail(400, '请选择今天或过去的真实日期。');
  if (text.length > 10000) fail(400, '回忆文字请控制在 10000 字以内。');
  if ((type === 'note' || type === 'chat') && !text) fail(400, '请写下一点回忆内容。');
  const prior = await env.DB.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first();
  if (prior) return json({memory:record(prior),alreadyExists:true});
  const file = form.get('file'); let key = null, mime = null, size = 0, filename = null;
  if (type === 'photo' || type === 'video') {
    if (!file || typeof file === 'string' || typeof file.stream !== 'function' || !file.size) fail(400, '请选择需要保存的照片或视频。');
    if (file.size > MAX_PHOTO) fail(413, type === 'photo' ? '单张照片不能超过 30 MB。' : '请使用视频分片上传，单个视频最大 1024 MB。');
    if (!(type === 'photo' ? PHOTO_TYPES : VIDEO_TYPES).has(file.type)) fail(415, '文件格式不受支持，请使用网页中列出的照片或视频格式。');
    key = `memories/${id}/${crypto.randomUUID()}`; mime = file.type; size = file.size;
    filename = (file.name || 'memory').replace(/[\r\n\x00]/g, '').slice(0, 255);
    await env.BUCKET.put(key, file.stream(), {httpMetadata:{contentType:mime},customMetadata:{memoryId:id}});
  }
  const created = new Date().toISOString();
  try {
    const written = await env.DB.prepare('INSERT INTO memories (id, type, title, memory_date, body, location, object_key, mime, byte_size, filename, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(id,type,title,date,text,'我们的日常',key,mime,size,filename,created).run();
    // A simultaneous retry must not replace the winning upload or leak its losing object.
    if (!written.meta.changes && key) await env.BUCKET.delete(key);
    const row = await env.DB.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first();
    return json({memory:record(row),alreadyExists:!written.meta.changes}, written.meta.changes ? 201 : 200);
  } catch (error) {
    if (key) {
      const committed = await env.DB.prepare('SELECT object_key FROM memories WHERE id = ?').bind(id).first().catch(() => undefined);
      // An unavailable database cannot prove rollback. Keep the object rather
      // than risk deleting media whose metadata actually committed.
      if (committed !== undefined && committed?.object_key !== key) await env.BUCKET.delete(key).catch(() => {});
    }
    throw error;
  }
}
function uploadExpiry() {return new Date(Date.now() + UPLOAD_TTL).toISOString();}
async function deleteUploadRows(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM video_upload_parts WHERE memory_id = ?').bind(id),
    env.DB.prepare('DELETE FROM video_uploads WHERE memory_id = ?').bind(id),
  ]);
}
async function cleanExpiredUploads(env) {
  const expired = await env.DB.prepare('SELECT * FROM video_uploads WHERE expires_at < ? LIMIT 5').bind(new Date().toISOString()).all();
  for (const row of expired.results) {
    const memory = await env.DB.prepare('SELECT object_key FROM memories WHERE id = ?').bind(row.memory_id).first();
    await env.BUCKET.resumeMultipartUpload(row.object_key,row.upload_id).abort();
    if (memory?.object_key !== row.object_key) await env.BUCKET.delete(row.object_key);
    await deleteUploadRows(env,row.memory_id);
  }
}
async function videoSession(env, id) {
  if (!MEMORY_ID.test(id)) fail(400, '视频回忆标识不正确。');
  const row = await env.DB.prepare('SELECT * FROM video_uploads WHERE memory_id = ?').bind(id).first();
  if (!row) fail(404, '上传会话不存在，请重新选择视频上传。');
  if (row.expires_at < new Date().toISOString()) fail(410, '上传已过期，请重新上传视频。');
  return row;
}
async function sessionInfo(env, row) {
  const parts = await env.DB.prepare('SELECT part_number FROM video_upload_parts WHERE memory_id = ? ORDER BY part_number').bind(row.memory_id).all();
  return json({id:row.memory_id,partSize:VIDEO_PART,partCount:Math.ceil(row.byte_size / VIDEO_PART),uploadedParts:parts.results.map(p => p.part_number)});
}
async function startVideo(request, env) {
  const input = await bodyJSON(request,65536);
  if (!input || typeof input !== 'object') fail(400, '视频信息格式不正确。');
  const id = typeof input.id === 'string' ? input.id : '';
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!MEMORY_ID.test(id)) fail(400, '视频回忆标识不正确。');
  if (!title || title.length > 100 || text.length > 10000) fail(400, '请填写有效的视频标题与回忆文字。');
  if (!validDate(input.date) || input.date > today()) fail(400, '请选择今天或过去的真实日期。');
  if (!VIDEO_TYPES.has(input.mime)) fail(415, '视频格式不受支持。');
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) fail(400, '视频文件不能为空。');
  if (input.byteSize > MAX_VIDEO) fail(413, '单个视频不能超过 1024 MB。');
  const prior = await env.DB.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first();
  if (prior) {
    if (prior.type !== 'video') fail(409, '这个回忆标识已用于其他类型的回忆。');
    return json({memory:record(prior),alreadyExists:true});
  }
  await cleanExpiredUploads(env);
  const metadata = {id,type:'video',title,text,date:input.date,mime:input.mime,filename:(typeof input.filename === 'string' ? input.filename : 'video').replace(/[\r\n\x00]/g,'').slice(0,255)};
  const encoded = JSON.stringify(metadata);
  const existing = await env.DB.prepare('SELECT * FROM video_uploads WHERE memory_id = ?').bind(id).first();
  if (existing) {
    if (existing.byte_size !== input.byteSize || existing.metadata !== encoded) fail(409, '上传中的视频信息已改变，请重新打开收藏窗口。');
    return sessionInfo(env,existing);
  }
  const key = `memories/${id}/${crypto.randomUUID()}`;
  const upload = await env.BUCKET.createMultipartUpload(key,{httpMetadata:{contentType:input.mime},customMetadata:{memoryId:id}});
  try {
    await env.DB.prepare('INSERT INTO video_uploads (memory_id,object_key,upload_id,metadata,byte_size,created_at,expires_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(memory_id) DO NOTHING')
      .bind(id,key,upload.uploadId,encoded,input.byteSize,new Date().toISOString(),uploadExpiry()).run();
  } catch (error) {
    const committed = await env.DB.prepare('SELECT upload_id FROM video_uploads WHERE memory_id = ?').bind(id).first().catch(() => undefined);
    if (committed !== undefined && committed?.upload_id !== upload.uploadId) await upload.abort().catch(() => {});
    throw error;
  }
  const row = await videoSession(env,id);
  if (row.upload_id !== upload.uploadId) await upload.abort();
  if (row.byte_size !== input.byteSize || row.metadata !== encoded) fail(409, '上传中的视频信息已改变，请重新打开收藏窗口。');
  return sessionInfo(env,row);
}
async function uploadVideoPart(request, env, id, partNumber) {
  const row = await videoSession(env,id);
  const count = Math.ceil(row.byte_size / VIDEO_PART);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) fail(400, '视频分片编号不正确。');
  const expected = partNumber === count ? row.byte_size - (count - 1) * VIDEO_PART : VIDEO_PART;
  const length = request.headers.get('content-length');
  if (length !== null && Number(length) !== expected) fail(400, '视频分片大小不正确，请重试。');
  if (!request.body) fail(400, '视频分片内容为空。');
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  for (;;) {
    const {done,value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > expected) {await reader.cancel(); fail(413, '视频分片超过预期大小。');}
    chunks.push(value);
  }
  if (size !== expected) fail(400, '视频分片不完整，请重试。');
  // At most 8 MiB is read per request, regardless of the full video size.
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk,offset); offset += chunk.byteLength;}
  const uploaded = await env.BUCKET.resumeMultipartUpload(row.object_key,row.upload_id).uploadPart(partNumber,bytes);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO video_upload_parts (memory_id,part_number,etag,byte_size) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM video_uploads WHERE memory_id = ? AND upload_id = ?) ON CONFLICT(memory_id,part_number) DO UPDATE SET etag=excluded.etag,byte_size=excluded.byte_size').bind(id,partNumber,uploaded.etag,size,id,row.upload_id),
    env.DB.prepare('UPDATE video_uploads SET expires_at = ? WHERE memory_id = ? AND upload_id = ?').bind(uploadExpiry(),id,row.upload_id),
  ]);
  return json({partNumber,uploadedBytes:size});
}
async function completeVideo(env, id) {
  if (!MEMORY_ID.test(id)) fail(400, '视频回忆标识不正确。');
  const prior = await env.DB.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first();
  if (prior) return json({memory:record(prior),alreadyExists:true});
  const row = await videoSession(env,id);
  const {results:parts} = await env.DB.prepare('SELECT part_number,etag,byte_size FROM video_upload_parts WHERE memory_id = ? ORDER BY part_number').bind(id).all();
  const count = Math.ceil(row.byte_size / VIDEO_PART);
  if (parts.length !== count || parts.some((p,i) => p.part_number !== i + 1 || p.byte_size !== (i === count - 1 ? row.byte_size - i * VIDEO_PART : VIDEO_PART))) fail(409, '视频尚未传完，请重试未完成的分片。');
  let object = await env.BUCKET.head(row.object_key);
  if (!object) {
    try {object = await env.BUCKET.resumeMultipartUpload(row.object_key,row.upload_id).complete(parts.map(p => ({partNumber:p.part_number,etag:p.etag})));}
    catch (error) {object = await env.BUCKET.head(row.object_key); if (!object) throw error;}
  }
  if (object.size !== row.byte_size) fail(409, '云端视频大小校验失败，请重新上传。');
  const meta = JSON.parse(row.metadata);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO memories (id,type,title,memory_date,body,location,object_key,mime,byte_size,filename,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .bind(id,'video',meta.title,meta.date,meta.text,'我们的日常',row.object_key,meta.mime,row.byte_size,meta.filename,row.created_at),
    env.DB.prepare('DELETE FROM video_upload_parts WHERE memory_id = ?').bind(id),
    env.DB.prepare('DELETE FROM video_uploads WHERE memory_id = ?').bind(id),
  ]);
  const saved = await env.DB.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first();
  return json({memory:record(saved)},201);
}
async function cancelVideo(env, id) {
  if (!MEMORY_ID.test(id)) fail(400, '视频回忆标识不正确。');
  const prior = await env.DB.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first();
  if (prior) return json({alreadyCompleted:true,memory:record(prior)});
  const row = await env.DB.prepare('SELECT * FROM video_uploads WHERE memory_id = ?').bind(id).first();
  if (row) {
    await env.BUCKET.resumeMultipartUpload(row.object_key,row.upload_id).abort();
    await env.BUCKET.delete(row.object_key);
    await deleteUploadRows(env,id);
  }
  return json({cancelled:true});
}
async function media(request, env, id) {
  if (!MEMORY_ID.test(id)) fail(404, '找不到这份影像。');
  const row = await env.DB.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first();
  if (!row?.object_key) fail(404, '找不到这份影像。');
  const rangeHeader = request.headers.get('range');
  let range = null;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) return new Response(null,{status:416,headers:{'content-range':`bytes */${row.byte_size}`,'cache-control':'private, no-store'}});
    let start, end;
    if (!match[1]) {start = Math.max(0, row.byte_size - Number(match[2])); end = row.byte_size - 1;}
    else {start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), row.byte_size - 1) : row.byte_size - 1;}
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= row.byte_size || start < 0 || end < start) return new Response(null,{status:416,headers:{'content-range':`bytes */${row.byte_size}`,'cache-control':'private, no-store'}});
    range = {offset:start,length:end - start + 1};
  }
  const object = request.method === 'HEAD' ? await env.BUCKET.head(row.object_key) : await env.BUCKET.get(row.object_key, range ? {range} : undefined);
  if (!object) fail(404, '这份文件暂时无法读取，请稍后重试。');
  const headers = new Headers({'content-type':row.mime,'content-length':String(range?.length || row.byte_size),'accept-ranges':'bytes',
    'cache-control':'private, no-store','x-content-type-options':'nosniff','content-disposition':`${new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.filename || 'memory')}`});
  if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${row.byte_size}`);
  return new Response(request.method === 'HEAD' ? null : object.body,{status:range ? 206 : 200,headers});
}
async function remove(env, id) {
  if (!MEMORY_ID.test(id)) fail(400, '回忆标识不正确。');
  const row = await env.DB.prepare('SELECT object_key FROM memories WHERE id = ?').bind(id).first();
  if (row?.object_key) await env.BUCKET.delete(row.object_key);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM favorites WHERE memory_id = ?').bind(id),
    env.DB.prepare('DELETE FROM memories WHERE id = ?').bind(id),
  ]);
  return json({deleted:true});
}
async function profile(request, env) {
  const body = await bodyJSON(request);
  if (!body || typeof body !== 'object' || typeof body.names !== 'string' || typeof body.start !== 'string') fail(400, '昵称和纪念日格式不正确。');
  const names = body.names.trim(), start = body.start;
  if (names.length > 40) fail(400, '昵称请控制在 40 字以内。');
  if (start && (!validDate(start) || start > today())) fail(400, '纪念日请选择今天或过去的日期。');
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('profile',JSON.stringify({names,start})).run();
  return json({profile:{names,start}});
}
async function favorite(request, env, id) {
  if (!FAVORITE_ID.test(id)) fail(400, '回忆标识不正确。');
  const body = await bodyJSON(request);
  if (!body || typeof body.liked !== 'boolean') fail(400, '收藏状态不正确。');
  if (body.liked) await env.DB.prepare('INSERT INTO favorites (memory_id) VALUES (?) ON CONFLICT(memory_id) DO NOTHING').bind(id).run();
  else await env.DB.prepare('DELETE FROM favorites WHERE memory_id = ?').bind(id).run();
  return json({liked:body.liked});
}

// All API and media routes are behind the unchanged owner-private Sites access
// boundary. Dispatch consumes service authorization; it may supply no user header.
// Do not make this shared album public without adding application authorization.
export async function api(request, env) {
  try {
    requireStorage(env);
    const path = new URL(request.url).pathname;
    if (!['GET','HEAD'].includes(request.method)) checkWriteOrigin(request);
    if (path === '/api/memories' && request.method === 'GET') return await list(env);
    if (path === '/api/memories' && request.method === 'POST') return await upload(request,env);
    if (path === '/api/video-uploads' && request.method === 'POST') return await startVideo(request,env);
    if (path === '/api/storage' && request.method === 'GET') return json(await storage(env));
    if (path === '/api/profile' && request.method === 'PUT') return await profile(request,env);
    let match = /^\/api\/video-uploads\/([^/]+)\/parts\/(\d+)$/.exec(path);
    if (match && request.method === 'PUT') return await uploadVideoPart(request,env,decodeURIComponent(match[1]),Number(match[2]));
    match = /^\/api\/video-uploads\/([^/]+)\/complete$/.exec(path);
    if (match && request.method === 'POST') return await completeVideo(env,decodeURIComponent(match[1]));
    match = /^\/api\/video-uploads\/([^/]+)$/.exec(path);
    if (match && request.method === 'DELETE') return await cancelVideo(env,decodeURIComponent(match[1]));
    match = /^\/api\/favorites\/([^/]+)$/.exec(path);
    if (match && request.method === 'PUT') return await favorite(request,env,decodeURIComponent(match[1]));
    match = /^\/api\/memories\/([^/]+)$/.exec(path);
    if (match && request.method === 'DELETE') return await remove(env,decodeURIComponent(match[1]));
    match = /^\/api\/media\/([^/]+)$/.exec(path);
    if (match && ['GET','HEAD'].includes(request.method)) return await media(request,env,decodeURIComponent(match[1]));
    return json({error:'找不到这个接口。'},404);
  } catch (error) {
    if (!(error instanceof APIError)) console.error('Cloud memory operation failed', error?.message || 'unknown');
    return json({error:error instanceof APIError ? error.message : '云端暂时未能完成操作，请稍后重试。',code:error instanceof APIError ? 'invalid_request' : 'storage_unavailable'},error instanceof APIError ? error.status : 503);
  }
}
