(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const MAX_PHOTO = 30 * 1024 * 1024;
  const MAX_VIDEO = 1024 * 1024 * 1024;
  const MAX_JSON_MEDIA = 90 * 1024 * 1024;
  const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
  const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'];
  const KINDS = ['photo', 'video', 'note', 'chat'];
  const STORAGE = { favorites: 'taffy.favorites.v1', profile: 'taffy.profile.v1' };
  const labels = { photo: '照片', video: '影像', chat: '心动对话', note: '一封小信' };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const demos = [
    { id: 's1', type: 'photo', title: '和你一起，等一场日落', date: '2025-10-18', location: '山野之间', src: 'assets/hero.png', text: '风轻轻地吹，太阳慢慢落下。\n那一刻，身边是你，就已经很好。', sample: true },
    { id: 's2', type: 'photo', title: '把海风装进口袋', date: '2025-08-23', location: '海边散步', src: 'assets/coast.png', text: '沿着海岸走了好久，聊了好多没有答案的小问题。\n回家的路上，鞋子里还藏着一点沙。', sample: true },
    { id: 's3', type: 'chat', title: '今天，也有好好想你', date: '2025-08-12', location: '一句话的温柔', text: '我：今天的云好像一只小狗。\n你：拍给我看看。\n我：突然有点想你。\n你：我也是。下班一起回家吧。', sample: true },
    { id: 's4', type: 'photo', title: '一杯咖啡，两个人的下午', date: '2025-07-06', location: '街角的小店', src: 'assets/cafe.png', text: '点了平时最喜欢的两杯咖啡。\n没安排什么特别的事，只是和你坐在一起。', sample: true },
    { id: 's5', type: 'video', title: '风吹过的夏天', date: '2025-06-21', location: '夏日放映室', src: 'assets/memory-film.mp4', poster: 'assets/hero.png', text: '留下一小段流动的光影。\n这是示例影像，等你换上属于你们的夏天。', sample: true },
    { id: 's6', type: 'note', title: '写给未来的我们', date: '2025-05-20', location: '给未来的一封信', text: '亲爱的你：\n\n愿我们一直记得，那些一起走过的小路，一起吃过的晚饭，和一起等过的日落。\n\n不必每天都盛大，只愿每个平凡的明天，都有你在身旁。\n\n慢慢来，我们还有很长很长的故事。', sample: true }
  ];

  let custom = [];
  let cloudReady = false;
  let canWrite = false;
  let loadingCloud = false;
  let localItems = [];
  let migrating = false;
  let storageInfo = null;
  let filter = 'all';
  let favoriteOnly = false;
  let search = '';
  let currentId = null;
  let toastTimer;
  let activeVideoUpload = null;
  let draftUpload = null;
  let activePhotoViewer = null;
  const blobURLs = new Map();
  function readLocal(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  const storedFavorites = readLocal(STORAGE.favorites, []);
  const localFavorites = new Set(Array.isArray(storedFavorites) ? storedFavorites.filter(x => typeof x === 'string') : []);
  const storedProfile = readLocal(STORAGE.profile, {});
  const localProfile = storedProfile && typeof storedProfile === 'object' && !Array.isArray(storedProfile) ? storedProfile : {};
  let favorites = new Set();
  let profile = {};

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function heartIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '19'); svg.setAttribute('height', '19');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z');
    svg.append(path); return svg;
  }
  function toast(message) {
    const node = $('#toast'); if (!node) return;
    clearTimeout(toastTimer); node.textContent = message; node.hidden = false; node.classList.add('is-visible');
    toastTimer = setTimeout(() => { node.classList.remove('is-visible'); node.hidden = true; }, 3600);
  }
  function dateLabel(date) { return date.replaceAll('-', '.'); }
  function allMemories() { return [...custom, ...demos].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)); }
  function visibleMemories() {
    return allMemories().filter(item => {
      const category = filter === 'all' || item.type === filter || (filter === 'note' && item.type === 'chat');
      return category && (!favoriteOnly || favorites.has(item.id)) && (!search || `${item.title} ${item.text} ${item.location || ''}`.toLowerCase().includes(search));
    });
  }
  function mediaURL(item) {
    if (!item.blob) return item.src || '';
    if (!blobURLs.has(item.id)) blobURLs.set(item.id, URL.createObjectURL(item.blob));
    return blobURLs.get(item.id);
  }
  const dbReady = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('当前浏览器不支持本地回忆保存，请使用正常模式的现代浏览器。')); return; }
    const request = indexedDB.open('taffy-memories', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('memories')) db.createObjectStore('memories', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地回忆册，请检查浏览器的存储权限。'));
    request.onblocked = () => reject(new Error('本地回忆册暂时被其他页面占用，请关闭其他回忆册页面后重试。'));
  });
  // Attach a handler immediately so browsers without IndexedDB still show the demo.
  dbReady.catch(() => {});
  async function getStored() {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
      const request = db.transaction('memories', 'readonly').objectStore('memories').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('读取本地回忆失败，请刷新后重试。'));
    });
  }
  async function api(path, options = {}) {
    const controller = new AbortController();
    const { timeoutMs = 120000, signal, ...fetchOptions } = options;
    const externalAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort',externalAbort,{once:true});
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...fetchOptions, signal: controller.signal });
      const contentType = response.headers.get('content-type') || '';
      let data = null;
      if (contentType.includes('application/json')) data = await response.json();
      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : '';
        const error = new Error(message || (response.status === 401 || response.status === 403 ? '请确认已登录这个私有网站，然后刷新重试。' : `云端请求未完成（${response.status}），请稍后重试。`));
        error.status = response.status; throw error;
      }
      if (!data || typeof data !== 'object') throw new Error('云端没有返回有效数据，请重新登录或刷新重试。');
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        if (signal?.aborted) throw error;
        throw new Error('连接云端超时，内容尚未确认保存。请检查网络后重试。');
      }
      if (error instanceof TypeError) throw new Error('暂时无法连接云端，请检查网络后重试。');
      throw error;
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort',externalAbort); }
  }
  const jsonOptions = (value) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  function requireCloud() {
    if (!cloudReady) throw new Error('云端尚未连接，请点击「刷新状态」后再保存。');
  }
  function requireWrite() {
    requireCloud();
    if (!canWrite) throw new Error('访客只能浏览，请使用站点主人账号登录后管理回忆。');
  }
  function paintAccess(permission) {
    canWrite = permission?.canWrite === true;
    document.body.dataset.access = canWrite ? 'owner' : 'visitor';
    $$('[data-owner-only]').forEach(node => {node.hidden = !canWrite;});
    const settings = $('#settings-open'); if (settings) settings.disabled = !canWrite;
    const login = $('#owner-signin'); if (login) login.hidden = canWrite;
    const logout = $('#owner-signout');
    if (logout) {logout.hidden = !permission?.authenticated;logout.textContent = canWrite ? '退出管理' : '退出登录';}
    const visitor = $('#visitor-note'); if (visitor) visitor.hidden = canWrite;
    const note = $('#collection-status'); if (note) note.textContent = canWrite ? '示例回忆已标注，可添加你的真实故事' : '示例回忆已标注 · 访客只读浏览';
  }
  function validMemory(item) {
    return item && typeof item.id === 'string' && /^m-[a-zA-Z0-9-]{1,90}$/.test(item.id) && KINDS.includes(item.type) && validDate(item.date) && typeof item.title === 'string' && typeof item.text === 'string';
  }
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
    return `${(bytes / 1000 ** index).toLocaleString('zh-CN', { maximumFractionDigits: index ? 2 : 0 })} ${units[index]}`;
  }
  function paintStorage(info) {
    storageInfo = info || storageInfo;
    const used = $('#cloud-used'); if (used) used.textContent = storageInfo ? formatBytes(storageInfo.mediaUsedBytes) : '—';
    const count = $('#cloud-count'); if (count) count.textContent = Number.isFinite(storageInfo?.mediaCount) ? `${storageInfo.mediaCount} 个` : '—';
    const db = $('#cloud-db-limit'); if (db) db.textContent = '每个站点上限 10 GB';
    const file = $('#cloud-file-limit'); if (file) file.textContent = '每个站点未设固定容量上限';
    const account = $('#cloud-account-remaining'); if (account) account.textContent = '平台未提供查询';
    const max = $('#cloud-max-file'); if (max) max.textContent = '照片 30 MB · 视频 1024 MB';
  }
  function cloudStatus(state, message) {
    const status = $('#cloud-status');
    if (status) { status.textContent = state === 'ready' ? '云端已连接 · 主人模式' : state === 'loading' ? '正在连接云端…' : '云端暂未连接'; status.dataset.state = state; }
    const note = $('#cloud-status-note');
    if (note) note.textContent = message || (state === 'ready' ? '新增回忆已改为云端保存，登录同一账号可在不同设备查看。' : state === 'loading' ? '正在读取回忆与文件用量。' : '连接失败，请刷新状态后再保存。');
    const button = $('#cloud-refresh'); if (button) button.disabled = state === 'loading';
    const visitor = $('#visitor-note');
    if (visitor) visitor.textContent = state === 'ready' ? '欢迎看看我们的小美好 · 访客仅可浏览' : state === 'loading' ? '正在翻开回忆册…' : '回忆暂时未能加载，请刷新重试。';
  }
  function pendingLocal() {
    const ids = new Set(custom.map(item => item.id));
    return localItems.filter(item => !ids.has(item.id));
  }
  function renderMigration() {
    const pending = pendingLocal();
    const hasProfile = !profile.names && typeof localProfile.names === 'string' && localProfile.names.trim();
    const missingFavorites = [...localFavorites].some(id => !favorites.has(id));
    const show = canWrite && (pending.length > 0 || hasProfile || missingFavorites);
    const wrap = $('#local-migration'); if (wrap) wrap.hidden = !show;
    const copy = $('#local-migration-copy');
    if (copy) copy.textContent = pending.length ? `这台浏览器还有 ${pending.length} 条旧回忆尚未保存到云端。同步后保留本机原件；已有云端昵称与纪念日会保留。` : '检测到本机旧版昵称、纪念日或收藏，可同步到云端。本机原件仍然保留。';
    const button = $('#migrate-local');
    if (button) { button.textContent = migrating ? '正在同步，请稍候…' : pending.length ? `将本机 ${pending.length} 条回忆存到云端` : '同步本机纪念日与收藏'; button.disabled = !cloudReady || migrating; }
  }
  async function loadCloud({ silent = false } = {}) {
    if (loadingCloud) return;
    loadingCloud = true; cloudStatus('loading');
    try {
      const data = await api('/api/memories');
      if (!Array.isArray(data.memories) || !Array.isArray(data.favorites) || !data.profile || typeof data.profile !== 'object') throw new Error('云端回忆数据格式异常，请稍后重试。');
      if (data.storage?.connected === false) throw new Error('云端存储尚未就绪，请稍后刷新重试。');
      custom = data.memories.filter(validMemory);
      favorites = new Set(data.favorites.filter(id => typeof id === 'string'));
      profile = data.profile; cloudReady = true; paintAccess(data.permission);
      paintStorage(data.storage); renderGallery(); updateProfile(); renderMigration(); cloudStatus('ready');
    } catch (error) {
      cloudReady = false; paintAccess(null); cloudStatus('error', error.message); renderGallery(); renderMigration();
      if (!silent) toast(error.message);
      throw error;
    } finally { loadingCloud = false; const button = $('#cloud-refresh'); if (button) button.disabled = false; }
  }
  async function refreshStorage() {
    try { paintStorage(await api('/api/storage')); }
    catch (error) { cloudStatus('error', `回忆操作已完成，但用量刷新失败：${error.message}`); }
  }
  function videoProgress(sent, total, message = '') {
    const panel = $('#video-upload-progress'); if (panel) panel.hidden = false;
    const meter = $('#video-upload-meter'); if (meter) {meter.max = total; meter.value = sent;}
    const label = $('#video-upload-label');
    if (label) label.textContent = message || `视频上传 ${Math.floor(sent / total * 100)}% · ${(sent / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`;
    const note = $('#cloud-status-note'); if (note) note.textContent = message || `正在上传视频（${Math.floor(sent / total * 100)}%），请保持页面打开。`;
  }
  async function retryVideoRequest(path, options, signal) {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new DOMException('已取消上传','AbortError');
      try {return await api(path,{...options,signal,timeoutMs:300000});}
      catch (error) {
        if (signal.aborted || attempt >= 3 || (error.status && error.status < 500 && ![408,429].includes(error.status))) throw error;
        await new Promise(resolve => setTimeout(resolve,Math.min(4000,1000 * 2 ** attempt)));
      }
    }
  }
  async function uploadVideo(item) {
    if (activeVideoUpload) throw new Error('已有视频正在上传，请稍后再试。');
    if (!item.blob?.size || item.blob.size > MAX_VIDEO) throw new Error('单个视频最大 1024 MB，且不能为空。');
    if (!VIDEO_TYPES.includes(item.blob.type)) throw new Error('视频格式暂不支持。');
    const controller = new AbortController();
    activeVideoUpload = {controller,id:item.id};
    const cancel = $('#cancel-video-upload'); if (cancel) cancel.disabled = false;
    videoProgress(0,item.blob.size);
    try {
      const init = await retryVideoRequest('/api/video-uploads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:item.id,title:item.title,date:item.date,text:item.text,filename:item.filename || 'video',mime:item.blob.type,byteSize:item.blob.size})},controller.signal);
      if (init.memory) return init;
      if (init.id !== item.id || init.partSize !== 8 * 1024 * 1024 || init.partCount !== Math.ceil(item.blob.size / init.partSize) || !Array.isArray(init.uploadedParts)) throw new Error('云端分片配置异常，请刷新后重试。');
      const uploaded = new Set(init.uploadedParts);
      let sent = 0;
      for (let part = 1; part <= init.partCount; part++) {
        const offset = (part - 1) * init.partSize;
        const chunk = item.blob.slice(offset,Math.min(offset + init.partSize,item.blob.size));
        if (!uploaded.has(part)) await retryVideoRequest(`/api/video-uploads/${encodeURIComponent(item.id)}/parts/${part}`,{method:'PUT',headers:{'content-type':'application/octet-stream'},body:chunk},controller.signal);
        sent += chunk.size; videoProgress(sent,item.blob.size);
      }
      if (cancel) cancel.disabled = true;
      videoProgress(sent,item.blob.size,'分片已传完，正在确认云端保存…');
      return await retryVideoRequest(`/api/video-uploads/${encodeURIComponent(item.id)}/complete`,{method:'POST'},controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        try {await api(`/api/video-uploads/${encodeURIComponent(item.id)}`,{method:'DELETE'});}
        catch {throw new Error('已停止传输，未完成分片将在过期后清理。');}
        throw new Error('已取消视频上传，未保存为回忆。');
      }
      throw error;
    } finally {
      activeVideoUpload = null;
      const panel = $('#video-upload-progress'); if (panel) panel.hidden = true;
      cloudStatus(cloudReady ? 'ready' : 'error');
    }
  }
  async function uploadMemory(item) {
    requireWrite();
    let response;
    if (item.type === 'video') response = await uploadVideo(item);
    else {
      const data = new FormData();
      for (const key of ['id', 'type', 'title', 'date', 'text', 'location']) if (typeof item[key] === 'string') data.set(key, item[key]);
      if (item.blob) data.set('file', item.blob, item.filename || 'memory');
      response = await api('/api/memories', { method: 'POST', body: data });
    }
    if (!validMemory(response.memory)) throw new Error('云端未确认这条回忆，暂不标记为已保存。请刷新查看后重试。');
    const existing = custom.findIndex(memory => memory.id === response.memory.id);
    if (existing === -1) custom.push(response.memory); else custom[existing] = response.memory;
    return response.memory;
  }
  async function saveProfile(next) {
    requireWrite();
    const response = await api('/api/profile', jsonOptions(next));
    if (!response.profile || typeof response.profile !== 'object') throw new Error('云端未确认昵称与纪念日，请刷新重试。');
    profile = response.profile; updateProfile();
  }
  async function saveFavorite(id, liked) {
    requireWrite();
    const response = await api(`/api/favorites/${encodeURIComponent(id)}`, jsonOptions({ liked }));
    if (typeof response.liked !== 'boolean') throw new Error('云端未确认收藏状态，请刷新重试。');
    if (response.liked) favorites.add(id); else favorites.delete(id);
  }
  async function migrateLocal() {
    const errorNode = $('#migration-error'); if (errorNode) { errorNode.hidden = true; errorNode.textContent = ''; }
    let saved = 0;
    try {
      requireWrite(); migrating = true; renderMigration();
      const pending = pendingLocal();
      for (const item of pending) { await uploadMemory(item); saved++; renderGallery(); }
      if (!profile.names && typeof localProfile.names === 'string' && localProfile.names.trim()) {
        const start = validDate(localProfile.start) && localProfile.start <= today() ? localProfile.start : '';
        await saveProfile({ names: localProfile.names.slice(0, 40), start });
      }
      for (const id of localFavorites) if (!favorites.has(id)) await saveFavorite(id, true);
      renderGallery(); renderMigration(); await refreshStorage();
      toast(`已将 ${saved} 条旧回忆保存到云端，本机原件仍保留。`);
    } catch (error) {
      const message = `本次已保存 ${saved} 条回忆。${error.message} 可再次同步，已保存的回忆不会重复创建。`;
      if (errorNode) { errorNode.textContent = message; errorNode.hidden = false; }
      toast(message);
    } finally { migrating = false; renderMigration(); }
  }

  function favoriteButton(item) {
    const button = el('button', 'favorite-btn');
    button.type = 'button'; button.dataset.testid = 'favorite-toggle';
    button.setAttribute('aria-label', `${favorites.has(item.id) ? '取消喜欢' : '喜欢'}：${item.title}`);
    button.setAttribute('aria-pressed', String(favorites.has(item.id)));
    button.classList.toggle('is-favorite', favorites.has(item.id)); button.append(heartIcon()); button.disabled = !cloudReady || !canWrite;
    button.addEventListener('click', async (event) => {
      event.stopPropagation(); button.disabled = true;
      try {
        requireCloud(); await saveFavorite(item.id, !favorites.has(item.id)); renderGallery();
        if ($('#detail-dialog')?.open && currentId === item.id) renderDetail(item);
      } catch (error) { toast(error.message); button.disabled = !cloudReady || !canWrite; }
    });
    return button;
  }
  function chatPreview(text, detailed = false) {
    const wrap = el('div', detailed ? 'detail-chat' : 'chat-preview');
    const lines = text.split('\n').filter(Boolean).slice(0, detailed ? 100 : 3);
    lines.forEach((line, index) => {
      const isMe = /^我[：:]/.test(line) || (!/^(你|TA)[：:]/.test(line) && index % 2 === 0);
      const bubble = el('div', `${detailed ? 'chat-bubble' : 'chat-line'}${isMe ? ' is-me' : ''}`, line.replace(/^(我|你|TA)[：:]\s*/, ''));
      wrap.append(bubble);
    });
    return wrap;
  }
  function renderGallery() {
    const grid = $('#memory-grid'); if (!grid) return;
    const items = visibleMemories(); grid.replaceChildren();
    items.forEach((item, index) => {
      const card = el('article', `memory-card kind-${item.type}`);
      card.dataset.testid = 'memory-card'; card.dataset.kind = item.type; card.dataset.memoryId = item.id;
      const open = el('button', 'memory-open'); open.type = 'button';
      open.dataset.testid = 'photo-open'; open.setAttribute('aria-label', `查看回忆：${item.title}`);
      if (item.type === 'photo' || item.type === 'video') {
        const visual = el('div', 'memory-image');
        if (item.type === 'video' && (item.blob || !item.sample)) {
          const video = el('video'); video.src = mediaURL(item); video.preload = 'metadata'; video.muted = true; video.playsInline = true; video.setAttribute('aria-hidden', 'true'); visual.append(video);
        } else {
          const image = el('img'); image.src = item.poster || mediaURL(item); image.alt = item.title; image.loading = 'lazy'; image.decoding = 'async'; visual.append(image);
        }
        if (item.type === 'video') visual.append(el('span', 'play-badge', '▶'));
        open.append(visual);
      } else if (item.type === 'chat') {
        const visual = el('div', 'memory-image memory-conversation');
        visual.append(el('span', 'conversation-caption', 'OUR LITTLE CONVERSATION'), chatPreview(item.text)); open.append(visual);
      } else {
        const visual = el('div', 'memory-image note-preview');
        visual.append(el('span', 'note-mark', '“'), el('p', 'note-preview-text', item.text.slice(0, 86)), el('span', 'note-signature', 'To us, with love.')); open.append(visual);
      }
      const body = el('div', 'memory-body');
      const meta = el('div', 'memory-meta'); meta.append(el('time', '', dateLabel(item.date)), el('span', '', labels[item.type])); meta.firstChild.dateTime = item.date;
      body.append(meta, el('h3', 'memory-title', item.title), el('p', 'memory-excerpt', item.type === 'chat' ? '有些话，想一遍一遍地听。' : item.text.split('\n').filter(Boolean)[0]));
      const bottom = el('div', 'memory-bottom'); bottom.append(el('span', 'memory-location', item.location || '我们的日常'));
      if (item.sample) bottom.append(el('span', 'sample-label', '示例回忆'));
      body.append(bottom); open.append(body); open.addEventListener('click', () => openDetail(item.id));
      card.append(open, favoriteButton(item)); grid.append(card);
    });
    const count = $('#gallery-count'); if (count) count.textContent = String(items.length).padStart(2, '0');
    const empty = $('#empty-state'); if (empty) empty.hidden = items.length > 0;
    const total = $('#memory-total'); if (total) total.textContent = String(allMemories().length).padStart(2, '0');
    $$('.filter-btn').forEach(button => { const active = button.dataset.filter === filter; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); });
    const favorite = $('#favorites-only'); if (favorite) { favorite.setAttribute('aria-pressed', String(favoriteOnly)); favorite.classList.toggle('is-active', favoriteOnly); }
  }
  function createPhotoViewer(item) {
    const element = el('div','photo-viewer');
    const viewport = el('div','photo-viewport');
    viewport.tabIndex = 0; viewport.setAttribute('role','group');
    viewport.setAttribute('aria-label','照片预览：加减键缩放，放大后方向键或拖动查看，0 键复位');
    viewport.setAttribute('aria-busy','true');
    const image = el('img','photo-zoom-image'); image.alt = item.title; image.draggable = false;
    const error = el('p','photo-load-error','照片暂时无法加载，请稍后重试。'); error.hidden = true;
    viewport.append(image,error);
    const toolbar = el('div','photo-toolbar'); toolbar.setAttribute('role','group'); toolbar.setAttribute('aria-label','照片缩放');
    const button = (action,label,text) => {
      const node = el('button','photo-zoom-button',text);node.type = 'button';node.dataset.photoZoom = action;node.setAttribute('aria-label',label);return node;
    };
    const out = button('out','缩小照片','−');
    const level = el('output','photo-zoom-level','100%');level.setAttribute('aria-live','polite');level.setAttribute('aria-label','照片缩放比例');
    const inside = button('in','放大照片','＋');
    const resetButton = button('reset','还原照片至适应窗口','复位');
    const hint = el('span','photo-zoom-hint','双击 / 滚轮 / 双指缩放 · 放大后拖动');
    toolbar.append(out,level,inside,resetButton,hint);element.append(viewport,toolbar);
    let scale = 1, x = 0, y = 0, ready = false, destroyed = false, gesture = null, lastTap = null, touchToggleAt = 0, hadMultiplePointers = false;
    const pointers = new Map(), listeners = [];
    const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
    const point = (clientX,clientY) => {
      const rect = viewport.getBoundingClientRect();return {x:clientX - rect.left - rect.width/2,y:clientY - rect.top - rect.height/2};
    };
    function paint() {
      const limitX = Math.max(0,(image.clientWidth * scale - viewport.clientWidth)/2);
      const limitY = Math.max(0,(image.clientHeight * scale - viewport.clientHeight)/2);
      x = clamp(x,-limitX,limitX);y = clamp(y,-limitY,limitY);
      image.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
      viewport.dataset.scale = scale.toFixed(4);viewport.dataset.offsetX = x.toFixed(2);viewport.dataset.offsetY = y.toFixed(2);
      viewport.classList.toggle('is-zoomed',scale > 1.001);
      const percent = `${Math.round(scale*100)}%`;if (level.textContent !== percent) level.textContent = percent;
      out.disabled = !ready || scale <= 1.001;inside.disabled = !ready || scale >= 3.999;
      resetButton.disabled = !ready || (scale <= 1.001 && Math.abs(x)<1 && Math.abs(y)<1);
    }
    function zoom(next,anchor = {x:0,y:0}) {
      if (!ready || destroyed) return;
      const value = clamp(next,1,4), ratio = value / scale;
      x = anchor.x - (anchor.x - x)*ratio;y = anchor.y - (anchor.y - y)*ratio;scale = value;
      if (scale <= 1.001) {scale = 1;x = 0;y = 0;}
      paint();
    }
    function reset() {scale = 1;x = 0;y = 0;paint();}
    function toggle(anchor) {if (scale > 1.001) reset();else zoom(2,anchor);}
    function listen(node,type,handler,options) {
      node.addEventListener(type,handler,options);listeners.push(() => node.removeEventListener(type,handler,options));
    }
    function beginGesture() {
      const values = [...pointers.values()];
      if (values.length >= 2) {
        hadMultiplePointers = true;
        const a = values[0], b = values[1];
        gesture = {kind:'pinch',distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),middle:point((a.x+b.x)/2,(a.y+b.y)/2),scale,x,y};
        lastTap = null;
      } else if (values.length === 1) {
        gesture = {kind:'pan',start:values[0],x,y,at:Date.now(),moved:false,canTap:!hadMultiplePointers};
      } else {gesture = null;hadMultiplePointers = false;}
      viewport.classList.toggle('is-panning',values.length > 0 && scale > 1.001);
    }
    listen(viewport,'pointerdown',event => {
      if (!ready || (event.pointerType === 'mouse' && event.button !== 0)) return;
      viewport.focus({preventScroll:true});pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      viewport.setPointerCapture(event.pointerId);beginGesture();
    });
    listen(viewport,'pointermove',event => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if (gesture.kind === 'pinch') {
        const [a,b] = [...pointers.values()];if (!b) return;
        const middle = point((a.x+b.x)/2,(a.y+b.y)/2);
        scale = clamp(gesture.scale * Math.hypot(a.x-b.x,a.y-b.y) / gesture.distance,1,4);
        const ratio = scale / gesture.scale;
        x = middle.x - (gesture.middle.x - gesture.x)*ratio;y = middle.y - (gesture.middle.y - gesture.y)*ratio;
        if (scale <= 1.001) {scale = 1;x = 0;y = 0;}
        paint();
      } else {
        const dx = event.clientX - gesture.start.x, dy = event.clientY - gesture.start.y;
        if (Math.hypot(dx,dy)>8) gesture.moved = true;
        if (scale > 1.001) {x = gesture.x + dx;y = gesture.y + dy;paint();}
      }
    });
    function endPointer(event) {
      if (!pointers.has(event.pointerId)) return;
      if (event.type !== 'pointerup') lastTap = null;
      if (event.type === 'pointerup' && event.pointerType === 'touch' && pointers.size === 1 && gesture?.kind === 'pan' && gesture.canTap && !gesture.moved && Date.now()-gesture.at<300) {
        const now = Date.now();
        if (lastTap && now-lastTap.time<320 && Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<24) {
          toggle(point(event.clientX,event.clientY));touchToggleAt = now;lastTap = null;
        } else lastTap = {time:now,x:event.clientX,y:event.clientY};
      }
      pointers.delete(event.pointerId);
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      beginGesture();
    }
    for (const type of ['pointerup','pointercancel','lostpointercapture']) listen(viewport,type,endPointer);
    listen(viewport,'dblclick',event => {
      if (Date.now()-touchToggleAt<500) return;
      event.preventDefault();toggle(point(event.clientX,event.clientY));
    });
    listen(viewport,'wheel',event => {
      if (!ready) return;
      event.preventDefault();const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      zoom(scale * Math.exp(-event.deltaY * units * .002),point(event.clientX,event.clientY));
    },{passive:false});
    listen(viewport,'keydown',event => {
      if (scale <= 1.001 || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();event.stopPropagation();
      if (event.key === 'ArrowLeft') x += 40;if (event.key === 'ArrowRight') x -= 40;
      if (event.key === 'ArrowUp') y += 40;if (event.key === 'ArrowDown') y -= 40;
      paint();
    });
    listen(out,'click',() => zoom(scale/1.25));listen(inside,'click',() => zoom(scale*1.25));listen(resetButton,'click',reset);
    listen(image,'load',() => {ready = true;viewport.setAttribute('aria-busy','false');paint();});
    listen(image,'error',() => {ready = false;error.hidden = false;image.hidden = true;viewport.setAttribute('aria-busy','false');paint();});
    const observer = new ResizeObserver(() => {if (!destroyed) paint();});observer.observe(viewport);
    image.src = mediaURL(item);if (image.complete && image.naturalWidth) {ready = true;viewport.setAttribute('aria-busy','false');}
    paint();
    return {element,focus:() => viewport.focus({preventScroll:true}),zoomIn:() => zoom(scale*1.25),zoomOut:() => zoom(scale/1.25),reset,
      destroy() {destroyed = true;observer.disconnect();for (const remove of listeners) remove();for (const id of pointers.keys()) {if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);}pointers.clear();}
    };
  }
  function renderDetail(item) {
    const wrap = $('#detail-content'); if (!wrap) return;
    activePhotoViewer?.destroy();activePhotoViewer = null;wrap.replaceChildren();
    if (item.type === 'photo') {
      activePhotoViewer = createPhotoViewer(item);wrap.append(activePhotoViewer.element);
    } else if (item.type === 'video') {
      const video = el('video', 'detail-media'); video.src = mediaURL(item); video.controls = true; video.playsInline = true; video.preload = 'metadata'; if (item.poster) video.poster = item.poster;
      video.append(el('p', '', '当前浏览器无法播放这段视频。'));
      const error = el('p', 'media-error'); error.hidden = true; video.addEventListener('error', () => { error.textContent = '浏览器无法播放这段影像，请尝试 MP4（H.264）格式。'; error.hidden = false; });
      wrap.append(video, error);
    }
    const copy = el('div', 'detail-copy');
    copy.append(el('p', 'detail-meta', `${dateLabel(item.date)}  ·  ${item.location || labels[item.type]}${item.sample ? '  ·  示例回忆' : ''}`), el('h2', 'detail-title', item.title));
    if (item.type === 'chat') copy.append(chatPreview(item.text, true)); else copy.append(el('p', 'detail-text', item.text));
    const actions = el('div', 'detail-actions'); actions.append(favoriteButton(item));
    if (!item.sample) {
      if (item.src && (item.type === 'photo' || item.type === 'video')) {
        const download = el('a','text-button','下载原文件');
        download.href = item.src + '?download=1'; download.download = item.filename || 'memory'; actions.append(download);
      }
      if (canWrite) {
      const remove = el('button', 'text-button delete-memory', '删除这条回忆'); remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!window.confirm('确定从云端删除这条回忆和媒体文件吗？所有设备都会同步删除，建议先导出备份。')) return;
        remove.disabled = true;
        try {
          requireWrite(); await api(`/api/memories/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); custom = custom.filter(memory => memory.id !== item.id); favorites.delete(item.id);
          if (blobURLs.has(item.id)) { URL.revokeObjectURL(blobURLs.get(item.id)); blobURLs.delete(item.id); }
          $('#detail-dialog').close(); renderGallery(); renderMigration(); await refreshStorage(); toast('已从云端删除回忆，所有设备将同步更新。');
        } catch (error) { toast(error.message); remove.disabled = false; }
      }); actions.append(remove);
      }
    }
    copy.append(actions); wrap.append(copy);
    const visible = visibleMemories();
    for (const id of ['detail-prev', 'detail-next']) { const button = $('#' + id); if (button) button.disabled = visible.length < 2; }
  }
  function openDetail(id) {
    const item = allMemories().find(memory => memory.id === id); if (!item) return;
    currentId = id; renderDetail(item); const dialog = $('#detail-dialog'); if (!dialog.open) dialog.showModal();
    activePhotoViewer?.focus();
  }
  function stepDetail(direction) {
    const list = visibleMemories(); if (list.length < 2) return;
    const index = list.findIndex(item => item.id === currentId);
    openDetail(list[(index + direction + list.length) % list.length].id);
  }
  function updateProfile() {
    const names = typeof profile.names === 'string' && profile.names.trim() ? profile.names.trim() : '我 & 你';
    const nameNode = $('#couple-names'); if (nameNode) nameNode.textContent = names;
    const counter = $('#day-counter');
    if (counter) {
      if (validDate(profile.start) && profile.start <= today()) {
        const days = Math.floor((Date.parse(today() + 'T00:00:00Z') - Date.parse(profile.start + 'T00:00:00Z')) / 86400000) + 1;
        counter.textContent = `在一起的第 ${days} 天`; counter.dataset.hasStart = 'true'; counter.setAttribute('aria-label', `在一起的第 ${days} 天`);
        const label = $('#day-counter-label'); if (label) label.textContent = '在一起的每一天';
      } else { counter.textContent = canWrite ? '写下故事开始的那一天' : '我们的故事，慢慢写'; counter.dataset.hasStart = 'false'; counter.removeAttribute('aria-label'); const label = $('#day-counter-label'); if (label) label.textContent = '写下我们的纪念日'; }
    }
  }
  function openProfile() {
    if (!canWrite) return;
    const form = $('#profile-form'); if (!form) return;
    form.elements.names.value = typeof profile.names === 'string' ? profile.names : '';
    form.elements.start.value = validDate(profile.start) ? profile.start : '';
    form.elements.start.max = today(); const error = $('#profile-error'); if (error) { error.hidden = true; error.textContent = ''; } $('#profile-dialog').showModal();
  }
  function updateMediaField() {
    const form = $('#memory-form'); if (!form) return;
    const kind = form.elements.type.value; const needsFile = kind === 'photo' || kind === 'video';
    const field = $('#media-field'); if (field) field.hidden = !needsFile;
    form.elements.file.required = needsFile; form.elements.file.accept = kind === 'photo' ? PHOTO_TYPES.join(',') : VIDEO_TYPES.join(',');
    const help = $('#file-help'); if (help) help.textContent = kind === 'video' ? '支持 MP4、WebM、MOV；建议 MP4（H.264），最大 1024 MB，上传时显示进度。' : '支持 JPG、PNG、WebP、GIF、AVIF，最大 30 MB。';
    form.elements.text.placeholder = kind === 'chat' ? '我：今天的晚霞很好看。\n你：和你一起看就更好了。' : '记下当时的小心情，未来的我们会很喜欢。';
  }
  function openAdd() {
    if (!canWrite) return;
    if (activeVideoUpload) {if (!$('#add-dialog').open) $('#add-dialog').showModal(); return;}
    draftUpload = null;
    const form = $('#memory-form'); if (!form) return;
    form.reset(); form.dataset.pendingId = `m-${crypto.randomUUID()}`; form.elements.date.value = today(); form.elements.date.max = today();
    const error = $('#add-error'); if (error) { error.textContent = ''; error.hidden = true; } updateMediaField(); $('#add-dialog').showModal();
  }
  $$('.filter-btn').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter || 'all'; renderGallery(); }));
  $('#favorites-only')?.addEventListener('click', () => { favoriteOnly = !favoriteOnly; renderGallery(); });
  $('#search-input')?.addEventListener('input', event => { search = event.target.value.trim().toLowerCase(); renderGallery(); });
  for (const id of ['add-memory', 'add-memory-bottom']) $('#' + id)?.addEventListener('click', openAdd);
  for (const node of $$('[data-profile-open], #settings-open')) node.addEventListener('click', openProfile);
  $$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog')?.close()));
  $$('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }));
  $('#detail-dialog')?.addEventListener('close', () => { $('#detail-content video')?.pause();activePhotoViewer?.destroy();activePhotoViewer = null; });
  $('#detail-prev')?.addEventListener('click', () => stepDetail(-1));
  $('#detail-next')?.addEventListener('click', () => stepDetail(1));
  document.addEventListener('keydown', event => {
    if (!$('#detail-dialog')?.open || event.defaultPrevented || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (activePhotoViewer && ['+','=','-','0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '+' || event.key === '=') activePhotoViewer.zoomIn();
      else if (event.key === '-') activePhotoViewer.zoomOut();else activePhotoViewer.reset();
      return;
    }
    if (event.key === 'ArrowLeft') { event.preventDefault(); stepDetail(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); stepDetail(1); }
  });
  $('#memory-form')?.elements.type.addEventListener('change', updateMediaField);
  $('#memory-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const errorNode = $('#add-error'); if (errorNode) { errorNode.textContent = ''; errorNode.hidden = true; }
    const kind = form.elements.type.value; const title = form.elements.title.value.trim(); const text = form.elements.text.value.trim(); const date = form.elements.date.value;
    const save = $('#memory-save');
    try {
      requireWrite();
      if (!KINDS.includes(kind) || !title || title.length > 100) throw new Error('请填写 1–100 字的回忆标题。');
      if (!validDate(date) || date > today()) throw new Error('请选择今天或过去的真实日期。');
      if (text.length > 10000) throw new Error('这段心情有点长，请控制在 10000 字以内。');
      const item = { id: form.dataset.pendingId || `m-${crypto.randomUUID()}`, type: kind, title, text, date, location: '我们的日常', createdAt: new Date().toISOString() };
      if (kind === 'photo' || kind === 'video') {
        const file = form.elements.file.files[0];
        if (!file) throw new Error(kind === 'photo' ? '请选择一张照片。' : '请选择一段视频。');
        if (file.size > (kind === 'video' ? MAX_VIDEO : MAX_PHOTO)) throw new Error(kind === 'video' ? '视频超过 1024 MB，请压缩后再试。' : '照片超过 30 MB，请压缩后再试。');
        if (!(kind === 'photo' ? PHOTO_TYPES : VIDEO_TYPES).includes(file.type)) throw new Error('文件格式暂不支持，请参考下方支持的格式。');
        item.blob = file; item.filename = file.name;
      } else if (!text) throw new Error('写下一点内容，再把它收藏起来吧。');
      const draftKey = JSON.stringify([kind,title,date,text,item.filename,item.blob?.size,item.blob?.lastModified]);
      if (draftUpload?.key === draftKey) item.id = draftUpload.id;
      else draftUpload = {key:draftKey,id:item.id};
      if (save) { save.disabled = true; save.textContent = '正在收藏…'; }
      await uploadMemory(item); filter = 'all'; favoriteOnly = false; search = ''; if ($('#search-input')) $('#search-input').value = '';
      draftUpload = null;
      renderGallery(); renderMigration(); $('#add-dialog').close(); await refreshStorage(); toast('已收藏到云端，在其他设备打开也能看到。'); $('#memories')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } catch (error) { if (errorNode) { errorNode.textContent = error.message || '保存失败，请重试。'; errorNode.hidden = false; } else toast(error.message); }
    finally { if (save) { save.disabled = false; save.textContent = '收藏这份回忆'; } }
  });
  $('#profile-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const names = form.elements.names.value.trim(); const start = form.elements.start.value;
    const errorNode = $('#profile-error'); if (errorNode) { errorNode.hidden = true; errorNode.textContent = ''; }
    const save = form.querySelector('button[type="submit"]'); if (save) save.disabled = true;
    try {
      requireWrite();
      if (!names || names.length > 40) throw new Error('请填写 1–40 字的昵称。');
      if (start && (!validDate(start) || start > today())) throw new Error('纪念日请选择今天或过去的日期。');
      await saveProfile({ names, start }); renderMigration(); $('#profile-dialog').close(); toast('我们的专属设置已保存在云端。');
    } catch (error) {
      if (errorNode) { errorNode.textContent = error.message; errorNode.hidden = false; } else toast(error.message);
    } finally { if (save) save.disabled = false; }
  });
  const menuToggle = $('#menu-toggle');
  menuToggle?.addEventListener('click', () => { const expanded = menuToggle.getAttribute('aria-expanded') !== 'true'; menuToggle.setAttribute('aria-expanded', String(expanded)); $('#main-nav')?.classList.toggle('is-open', expanded); });
  $$('#main-nav a').forEach(link => link.addEventListener('click', () => { menuToggle?.setAttribute('aria-expanded', 'false'); $('#main-nav')?.classList.remove('is-open'); }));
  $$('[data-gallery-filter]').forEach(link => link.addEventListener('click', () => { filter = link.dataset.galleryFilter; favoriteOnly = false; search = ''; if ($('#search-input')) $('#search-input').value = ''; renderGallery(); }));
  $('#show-chats')?.addEventListener('click', () => {
    filter = 'note'; favoriteOnly = false; search = ''; if ($('#search-input')) $('#search-input').value = ''; renderGallery();
    $('#memories')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });

  function blobToDataURL(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('读取媒体文件失败。')); reader.readAsDataURL(blob); }); }
  async function downloadBackup(items, backupProfile, backupFavorites, suffix = '') {
    const totalMedia = items.reduce((sum,item) => sum + (item.blob?.size || item.byteSize || 0),0);
    if (totalMedia > MAX_JSON_MEDIA) throw new Error('媒体合计超过 JSON 备份的安全大小。请在回忆详情点击「下载原文件」单独备份较大的视频。');
    const memories = [];
    for (const item of items) {
      const { blob, src, poster, ...rest } = item;
      let media = blob;
      if (!media && (item.type === 'photo' || item.type === 'video')) {
        if (typeof src !== 'string' || !src.startsWith('/api/media/')) throw new Error('媒体地址不符合云端回忆格式，导出已停止。');
        const response = await fetch(src, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok || !(response.headers.get('content-type') || '').match(/^(image|video)\//)) throw new Error(`无法下载「${item.title}」的媒体文件，导出未完成。`);
        media = await response.blob();
      }
      memories.push({ ...rest, ...(media ? { media: await blobToDataURL(media) } : {}) });
    }
    const payload = { application: 'taffy-memories', version: 1, exportedAt: new Date().toISOString(), profile: backupProfile, favorites: [...backupFavorites], memories };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = el('a'); link.href = url; link.download = `我们的回忆册${suffix}-${today()}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('#export-backup')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      requireCloud(); await loadCloud({ silent: true }); requireCloud();
      await downloadBackup(custom, profile, favorites); toast('云端回忆备份已生成，包含照片与视频，请妥善保存。');
    } catch (error) { toast(error.message || '导出失败，请重试。'); } finally { button.disabled = false; }
  });
  $('#migration-export-local')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await downloadBackup(await getStored(), localProfile, localFavorites, '-本机原件'); toast('本机旧版备份已生成，原件仍保留。'); }
    catch (error) { toast(error.message || '本机备份导出失败。'); } finally { button.disabled = false; }
  });
  $('#import-backup')?.addEventListener('click', () => $('#backup-file')?.click());
  $('#backup-file')?.addEventListener('change', async event => {
    const input = event.currentTarget; const file = input.files[0]; if (!file) return;
    let saved = 0;
    try {
      requireWrite();
      if (file.size > 150 * 1024 * 1024) throw new Error('备份超过 150 MB，请选择分批保存的备份。');
      const backup = JSON.parse(await file.text());
      if (backup.application !== 'taffy-memories' || backup.version !== 1 || !Array.isArray(backup.memories) || backup.memories.length > 2000) throw new Error('这不是有效的回忆册备份文件。');
      const items = [];
      for (const raw of backup.memories) {
        if (!validMemory(raw) || !raw.title.trim() || raw.title.length > 100 || raw.text.length > 10000 || raw.date > today()) throw new Error('备份中的回忆格式有误，未开始导入。');
        const item = { id: raw.id, type: raw.type, title: raw.title, text: raw.text, date: raw.date, location: typeof raw.location === 'string' ? raw.location.slice(0, 100) : '我们的日常' };
        if (raw.type === 'photo' || raw.type === 'video') {
          if (typeof raw.media !== 'string') throw new Error('备份中缺少媒体文件，未开始导入。');
          const match = /^data:([a-z0-9/+.-]+);base64,([a-zA-Z0-9+/=]+)$/.exec(raw.media);
          const limit = raw.type === 'video' ? MAX_VIDEO : MAX_PHOTO;
          if (!match || !(raw.type === 'photo' ? PHOTO_TYPES : VIDEO_TYPES).includes(match[1]) || match[2].length > Math.ceil(limit * 4 / 3) + 4) throw new Error('备份中的媒体格式或大小不受支持，未开始导入。');
          const binary = atob(match[2]); const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
          if (bytes.byteLength > limit) throw new Error(`备份中的${raw.type === 'video' ? '视频超过 1024 MB' : '照片超过 30 MB'}，未开始导入。`);
          item.blob = new Blob([bytes], { type: match[1] }); item.filename = typeof raw.filename === 'string' ? raw.filename.slice(0, 255) : 'memory';
        } else if (!item.text.trim()) throw new Error('备份中的文字回忆为空，未开始导入。');
        items.push(item);
      }
      const importButton = $('#import-backup'); if (importButton) importButton.disabled = true;
      for (const item of items) { await uploadMemory(item); saved++; }
      if (backup.profile && typeof backup.profile === 'object' && typeof backup.profile.names === 'string' && backup.profile.names.trim()) {
        await saveProfile({ names: backup.profile.names.slice(0, 40), start: validDate(backup.profile.start) && backup.profile.start <= today() ? backup.profile.start : '' });
      }
      if (Array.isArray(backup.favorites)) for (const id of new Set(backup.favorites.filter(id => typeof id === 'string' && /^(m-[a-zA-Z0-9-]{1,90}|s[1-6])$/.test(id)))) if (!favorites.has(id)) await saveFavorite(id, true);
      renderGallery(); updateProfile(); renderMigration(); await refreshStorage(); toast(`已将 ${saved} 条回忆恢复到云端，其他设备登录后即可查看。`);
    } catch (error) {
      renderGallery(); renderMigration();
      const message = error instanceof SyntaxError ? '无法解析备份，请选择原始 JSON 备份文件。' : error.message || '导入失败，请重试。';
      toast(`${saved ? `本次已保存 ${saved} 条。` : ''}${message}${saved ? ' 可用同一备份重试，已保存的回忆不会重复创建。' : ''}`);
    } finally { input.value = ''; const button = $('#import-backup'); if (button) button.disabled = false; }
  });
  $('#cloud-refresh')?.addEventListener('click', () => loadCloud().catch(() => {}));
  $('#migrate-local')?.addEventListener('click', migrateLocal);
  $('#cancel-video-upload')?.addEventListener('click', () => activeVideoUpload?.controller.abort());

  updateProfile(); renderGallery(); paintStorage();
  getStored().then(items => { localItems = items.filter(validMemory); renderMigration(); }).catch(error => {
    const message = $('#migration-error'); if (message) { message.hidden = false; message.textContent = error.message; }
  });
  loadCloud({ silent: true }).catch(() => {});
})();
