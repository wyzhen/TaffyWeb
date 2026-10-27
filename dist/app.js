(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const MAX_FILE = 30 * 1024 * 1024;
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
  let filter = 'all';
  let favoriteOnly = false;
  let search = '';
  let currentId = null;
  let toastTimer;
  const blobURLs = new Map();
  function readLocal(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  const storedFavorites = readLocal(STORAGE.favorites, []);
  let favorites = new Set(Array.isArray(storedFavorites) ? storedFavorites.filter(x => typeof x === 'string') : []);
  let profile = readLocal(STORAGE.profile, {});
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) profile = {};

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
  async function saveStored(items) {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('memories', 'readwrite');
      for (const item of items) transaction.objectStore('memories').put(item);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(new Error('未能保存回忆。设备空间可能不足，请先导出备份并释放空间。'));
      transaction.onabort = () => reject(new Error('保存没有完成，请检查设备空间后重试。'));
    });
  }
  async function removeStored(id) {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('memories', 'readwrite');
      transaction.objectStore('memories').delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(new Error('删除没有完成，请重试。'));
    });
  }

  function favoriteButton(item) {
    const button = el('button', 'favorite-btn');
    button.type = 'button'; button.dataset.testid = 'favorite-toggle';
    button.setAttribute('aria-label', `${favorites.has(item.id) ? '取消喜欢' : '喜欢'}：${item.title}`);
    button.setAttribute('aria-pressed', String(favorites.has(item.id)));
    button.classList.toggle('is-favorite', favorites.has(item.id)); button.append(heartIcon());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const next = new Set(favorites);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      try { localStorage.setItem(STORAGE.favorites, JSON.stringify([...next])); favorites = next; }
      catch { toast('浏览器未允许保存喜欢，请检查存储权限。'); return; }
      renderGallery();
      if ($('#detail-dialog')?.open && currentId === item.id) renderDetail(item);
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
        if (item.type === 'video' && item.blob) {
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
  function renderDetail(item) {
    const wrap = $('#detail-content'); if (!wrap) return; wrap.replaceChildren();
    if (item.type === 'photo') {
      const image = el('img', 'detail-media'); image.src = mediaURL(item); image.alt = item.title; wrap.append(image);
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
      const remove = el('button', 'text-button delete-memory', '删除这条回忆'); remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!window.confirm('确定从这台设备删除这条回忆吗？建议先导出备份。')) return;
        remove.disabled = true;
        try {
          await removeStored(item.id); custom = custom.filter(memory => memory.id !== item.id);
          if (blobURLs.has(item.id)) { URL.revokeObjectURL(blobURLs.get(item.id)); blobURLs.delete(item.id); }
          $('#detail-dialog').close(); renderGallery(); toast('已从这台设备删除回忆。');
        } catch (error) { toast(error.message); remove.disabled = false; }
      }); actions.append(remove);
    }
    copy.append(actions); wrap.append(copy);
    const visible = visibleMemories();
    for (const id of ['detail-prev', 'detail-next']) { const button = $('#' + id); if (button) button.disabled = visible.length < 2; }
  }
  function openDetail(id) {
    const item = allMemories().find(memory => memory.id === id); if (!item) return;
    currentId = id; renderDetail(item); const dialog = $('#detail-dialog'); if (!dialog.open) dialog.showModal();
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
      } else { counter.textContent = '写下故事开始的那一天'; counter.dataset.hasStart = 'false'; counter.removeAttribute('aria-label'); const label = $('#day-counter-label'); if (label) label.textContent = '写下我们的纪念日'; }
    }
  }
  function openProfile() {
    const form = $('#profile-form'); if (!form) return;
    form.elements.names.value = typeof profile.names === 'string' ? profile.names : '';
    form.elements.start.value = validDate(profile.start) ? profile.start : '';
    form.elements.start.max = today(); $('#profile-dialog').showModal();
  }
  function updateMediaField() {
    const form = $('#memory-form'); if (!form) return;
    const kind = form.elements.type.value; const needsFile = kind === 'photo' || kind === 'video';
    const field = $('#media-field'); if (field) field.hidden = !needsFile;
    form.elements.file.required = needsFile; form.elements.file.accept = kind === 'photo' ? PHOTO_TYPES.join(',') : VIDEO_TYPES.join(',');
    const help = $('#file-help'); if (help) help.textContent = kind === 'video' ? '支持 MP4、WebM、MOV；建议 MP4（H.264），最大 30 MB。' : '支持 JPG、PNG、WebP、GIF、AVIF，最大 30 MB。';
    form.elements.text.placeholder = kind === 'chat' ? '我：今天的晚霞很好看。\n你：和你一起看就更好了。' : '记下当时的小心情，未来的我们会很喜欢。';
  }
  function openAdd() {
    const form = $('#memory-form'); if (!form) return;
    form.reset(); form.elements.date.value = today(); form.elements.date.max = today();
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
  $('#detail-dialog')?.addEventListener('close', () => { $('#detail-content video')?.pause(); });
  $('#detail-prev')?.addEventListener('click', () => stepDetail(-1));
  $('#detail-next')?.addEventListener('click', () => stepDetail(1));
  document.addEventListener('keydown', event => {
    if (!$('#detail-dialog')?.open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); stepDetail(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); stepDetail(1); }
  });
  $('#memory-form')?.elements.type.addEventListener('change', updateMediaField);
  $('#memory-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const errorNode = $('#add-error'); if (errorNode) { errorNode.textContent = ''; errorNode.hidden = true; }
    const kind = form.elements.type.value; const title = form.elements.title.value.trim(); const text = form.elements.text.value.trim(); const date = form.elements.date.value;
    const save = $('#memory-save');
    try {
      if (!KINDS.includes(kind) || !title || title.length > 100) throw new Error('请填写 1–100 字的回忆标题。');
      if (!validDate(date) || date > today()) throw new Error('请选择今天或过去的真实日期。');
      if (text.length > 10000) throw new Error('这段心情有点长，请控制在 10000 字以内。');
      const item = { id: `m-${crypto.randomUUID()}`, type: kind, title, text, date, location: '我们的日常', createdAt: new Date().toISOString() };
      if (kind === 'photo' || kind === 'video') {
        const file = form.elements.file.files[0];
        if (!file) throw new Error(kind === 'photo' ? '请选择一张照片。' : '请选择一段视频。');
        if (file.size > MAX_FILE) throw new Error('文件超过 30 MB，请压缩后再试。');
        if (!(kind === 'photo' ? PHOTO_TYPES : VIDEO_TYPES).includes(file.type)) throw new Error('文件格式暂不支持，请参考下方支持的格式。');
        item.blob = file; item.filename = file.name;
      } else if (!text) throw new Error('写下一点内容，再把它收藏起来吧。');
      if (save) { save.disabled = true; save.textContent = '正在收藏…'; }
      await saveStored([item]); custom.unshift(item); filter = 'all'; favoriteOnly = false; search = ''; if ($('#search-input')) $('#search-input').value = '';
      renderGallery(); $('#add-dialog').close(); toast('已收藏在这台设备。记得定期导出备份。'); $('#memories')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } catch (error) { if (errorNode) { errorNode.textContent = error.message || '保存失败，请重试。'; errorNode.hidden = false; } else toast(error.message); }
    finally { if (save) { save.disabled = false; save.textContent = '收藏这份回忆'; } }
  });
  $('#profile-form')?.addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget; const names = form.elements.names.value.trim(); const start = form.elements.start.value;
    if (names.length > 40) { toast('两个人的昵称请控制在 40 字以内。'); return; }
    if (start && (!validDate(start) || start > today())) { toast('纪念日请选择今天或过去的日期。'); return; }
    const next = { names, start };
    try { localStorage.setItem(STORAGE.profile, JSON.stringify(next)); profile = next; updateProfile(); $('#profile-dialog').close(); toast('我们的专属设置已保存在这台设备。'); }
    catch { toast('保存设置失败，请检查浏览器存储权限。'); }
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
  $('#export-backup')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      // Read again so export includes records saved in another open tab.
      const items = await getStored();
      const memories = await Promise.all(items.map(async item => { const { blob, ...rest } = item; return { ...rest, ...(blob ? { media: await blobToDataURL(blob) } : {}) }; }));
      const payload = { application: 'taffy-memories', version: 1, exportedAt: new Date().toISOString(), profile, favorites: [...favorites], memories };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const link = el('a'); link.href = url; link.download = `我们的回忆册-${today()}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('备份已生成，请妥善保存下载的文件。');
    } catch (error) { toast(error.message || '导出失败，请重试。'); } finally { button.disabled = false; }
  });
  $('#import-backup')?.addEventListener('click', () => $('#backup-file')?.click());
  $('#backup-file')?.addEventListener('change', async event => {
    const input = event.currentTarget; const file = input.files[0]; if (!file) return;
    try {
      if (file.size > 150 * 1024 * 1024) throw new Error('备份超过 150 MB，请分批恢复。');
      const backup = JSON.parse(await file.text());
      if (backup.application !== 'taffy-memories' || backup.version !== 1 || !Array.isArray(backup.memories) || backup.memories.length > 2000) throw new Error('这不是有效的回忆册备份文件。');
      const items = [];
      for (const raw of backup.memories) {
        if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^m-[a-zA-Z0-9-]{1,90}$/.test(raw.id) || !KINDS.includes(raw.type) || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 100 || typeof raw.text !== 'string' || raw.text.length > 10000 || !validDate(raw.date) || raw.date > today()) throw new Error('备份中的回忆格式有误，未导入任何内容。');
        const item = { id: raw.id, type: raw.type, title: raw.title, text: raw.text, date: raw.date, location: typeof raw.location === 'string' ? raw.location.slice(0, 100) : '我们的日常' };
        if (raw.type === 'photo' || raw.type === 'video') {
          if (typeof raw.media !== 'string') throw new Error('备份中缺少媒体文件。');
          const match = /^data:([a-z0-9/+.-]+);base64,([a-zA-Z0-9+/=]+)$/.exec(raw.media);
          if (!match || !(raw.type === 'photo' ? PHOTO_TYPES : VIDEO_TYPES).includes(match[1]) || match[2].length > Math.ceil(MAX_FILE * 4 / 3) + 4) throw new Error('备份中的媒体格式或大小不受支持。');
          const binary = atob(match[2]); const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
          if (bytes.byteLength > MAX_FILE) throw new Error('备份中的单个文件超过 30 MB。');
          item.blob = new Blob([bytes], { type: match[1] }); item.filename = typeof raw.filename === 'string' ? raw.filename.slice(0, 255) : 'memory';
        }
        items.push(item);
      }
      await saveStored(items); custom = await getStored();
      for (const url of blobURLs.values()) URL.revokeObjectURL(url); blobURLs.clear();
      let settingsSaved = true;
      try {
        if (backup.profile && typeof backup.profile === 'object') {
          const next = { names: typeof backup.profile.names === 'string' ? backup.profile.names.slice(0, 40) : '', start: validDate(backup.profile.start) && backup.profile.start <= today() ? backup.profile.start : '' };
          localStorage.setItem(STORAGE.profile, JSON.stringify(next)); profile = next;
        }
        if (Array.isArray(backup.favorites)) { const next = new Set([...favorites, ...backup.favorites.filter(value => typeof value === 'string' && value.length < 100)]); localStorage.setItem(STORAGE.favorites, JSON.stringify([...next])); favorites = next; }
      } catch { settingsSaved = false; }
      renderGallery(); updateProfile(); toast(`已恢复 ${items.length} 条回忆${settingsSaved ? '，保存在这台设备。' : '；昵称和喜欢未能恢复，请检查存储权限。'}`);
    } catch (error) { toast(error instanceof SyntaxError ? '无法解析备份，请选择原始 JSON 备份文件。' : error.message || '导入失败，请重试。'); }
    finally { input.value = ''; }
  });

  updateProfile(); renderGallery();
  getStored().then(items => { custom = items.filter(item => item && KINDS.includes(item.type) && validDate(item.date) && typeof item.title === 'string'); renderGallery(); }).catch(error => { toast(error.message); });
  window.addEventListener('storage', event => {
    if (event.key === STORAGE.favorites) { const next = readLocal(STORAGE.favorites, []); favorites = new Set(Array.isArray(next) ? next.filter(x => typeof x === 'string') : []); renderGallery(); }
    if (event.key === STORAGE.profile) { const next = readLocal(STORAGE.profile, {}); profile = next && typeof next === 'object' ? next : {}; updateProfile(); }
  });
})();
