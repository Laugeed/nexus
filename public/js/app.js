/* ═══════════════════════════════
   NEXUS MESSENGER
═══════════════════════════════ */

const S = {
  token: localStorage.getItem('nexus_token') || null,
  me: JSON.parse(localStorage.getItem('nexus_me') || 'null'),
  contacts: [],
  activeContact: null,
  ws: null,
  typingTimer: null,
  unread: {},
};

let replyTarget = null;

// ── API ──────────────────────────────────
async function api(method, url, body, isForm) {
  const opts = { method, headers: { Authorization: 'Bearer ' + S.token } };
  if (body && !isForm) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (isForm) {
    opts.body = body;
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

// ── AUTH ─────────────────────────────────
function switchTab(tab) {
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabReg').classList.toggle('active', tab === 'reg');
  document.getElementById('loginForm').style.display  = tab === 'login' ? '' : 'none';
  document.getElementById('regForm').style.display    = tab === 'reg'   ? '' : 'none';
  document.getElementById('resetForm').style.display  = tab === 'reset' ? '' : 'none';
  document.getElementById('loginErr').textContent = '';
  document.getElementById('regErr').textContent   = '';
  const re = document.getElementById('resetErr');
  if (re) re.textContent = '';
}

async function doLogin() {
  const username = document.getElementById('lUser').value.trim();
  const password = document.getElementById('lPass').value;
  document.getElementById('loginErr').textContent = '';
  try {
    const data = await api('POST', '/api/login', { username, password });
    saveSession(data); bootApp();
  } catch (e) { document.getElementById('loginErr').textContent = e.message; }
}

async function doRegister() {
  const display_name = document.getElementById('rName').value.trim();
  const username     = document.getElementById('rUser').value.trim();
  const password     = document.getElementById('rPass').value;
  document.getElementById('regErr').textContent = '';
  try {
    const data = await api('POST', '/api/register', { username, display_name, password });
    saveSession(data); bootApp();
  } catch (e) { document.getElementById('regErr').textContent = e.message; }
}

async function doReset() {
  const username  = document.getElementById('rstUser').value.trim();
  const password  = document.getElementById('rstPass').value;
  const password2 = document.getElementById('rstPass2').value;
  const err = document.getElementById('resetErr');
  err.textContent = '';
  if (!username || !password) { err.textContent = 'Заполните все поля'; return; }
  if (password !== password2)  { err.textContent = 'Пароли не совпадают'; return; }
  try {
    const r = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    switchTab('login');
    document.getElementById('lUser').value = username;
    showToast('✅ Пароль изменён');
  } catch (e) { err.textContent = e.message; }
}

function saveSession(data) {
  S.token = data.token;
  S.me    = data.user;
  localStorage.setItem('nexus_token', data.token);
  localStorage.setItem('nexus_me',    JSON.stringify(data.user));
}

async function doLogout() {
  try { await api('POST', '/api/logout'); } catch (_) {}
  S.token = null; S.me = null;
  localStorage.removeItem('nexus_token');
  localStorage.removeItem('nexus_me');
  if (S.ws) S.ws.close();
  switchScreen('authScreen');
}

// ── BOOT ─────────────────────────────────
async function bootApp() {
  switchScreen('appScreen');
  document.getElementById('myAvaEmoji').textContent = S.me.avatar_emoji;
  await loadContacts();
  connectWS();
  registerPush();
  initSwipeBack();
}

// ── WEBSOCKET ────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  S.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: S.token }));
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'message') {
      const fromId = msg.message.from_id;
      if (S.activeContact && S.activeContact.id === fromId) {
        appendMessage(msg.message);
      } else {
        S.unread[fromId] = (S.unread[fromId] || 0) + 1;
        renderContactList();
        showToast('💬 ' + getContactName(fromId));
      }
    }
    if (msg.type === 'typing' && S.activeContact && S.activeContact.id === msg.from_id) {
      showTyping(msg.typing);
    }
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
}

// ── CONTACTS ─────────────────────────────
async function loadContacts() {
  S.contacts = await api('GET', '/api/contacts');
  renderContactList();
  renderContactsFullList();
}

function getContactName(id) {
  const c = S.contacts.find(c => c.id === id);
  return c ? c.display_name : 'Пользователь';
}

function renderContactList() {
  const list = document.getElementById('contactsList');
  const q = (document.getElementById('chatSearch')?.value || '').toLowerCase();
  const filtered = S.contacts.filter(c =>
    !q || c.display_name.toLowerCase().includes(q) || c.username.includes(q)
  );
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-contacts">
      <div style="font-size:36px;margin-bottom:10px">💬</div>
      <div>${q ? 'Ничего не найдено' : 'Добавьте контакты'}</div>
      ${!q ? `<button class="btn-outline" style="margin-top:14px" onclick="showAddContact()">Найти пользователя</button>` : ''}
    </div>`;
    return;
  }
  list.innerHTML = '';
  filtered.forEach(c => {
    const unread = S.unread[c.id] || 0;
    const div = document.createElement('div');
    div.className = 'contact-row' + (S.activeContact?.id === c.id ? ' active' : '');
    div.onclick = () => openChat(c);
    div.innerHTML = `
      <div class="c-ava">${c.avatar_emoji}</div>
      <div class="c-meta">
        <div class="c-name">${esc(c.display_name)}</div>
        <div class="c-preview">@${esc(c.username)}</div>
      </div>
      ${unread > 0 ? `<div class="c-unread">${unread}</div>` : ''}`;
    list.appendChild(div);
  });
}

function renderContactsFullList() {
  const list = document.getElementById('contactsFullList');
  const q = (document.getElementById('contactSearch')?.value || '').toLowerCase();
  const filtered = S.contacts.filter(c =>
    !q || c.display_name.toLowerCase().includes(q) || c.username.includes(q)
  );
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-contacts">
      <div style="font-size:36px;margin-bottom:10px">👥</div>
      <div>Контактов пока нет</div>
      <button class="btn-outline" style="margin-top:14px" onclick="showAddContact()">+ Добавить</button>
    </div>`;
    return;
  }
  list.innerHTML = '';
  filtered.forEach(c => {
    const div = document.createElement('div');
    div.className = 'contact-row';
    div.innerHTML = `
      <div class="c-ava">${c.avatar_emoji}</div>
      <div class="c-meta">
        <div class="c-name">${esc(c.display_name)}</div>
        <div class="c-preview">@${esc(c.username)}</div>
      </div>
      <button class="icon-btn" onclick="openChat({id:${c.id},display_name:'${esc(c.display_name)}',avatar_emoji:'${c.avatar_emoji}',username:'${esc(c.username)}'})" title="Написать">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>`;
    list.appendChild(div);
  });
}

// ── SEARCH USERS ─────────────────────────
let searchTimer;
async function searchUsers() {
  clearTimeout(searchTimer);
  const q   = document.getElementById('userSearchInput').value.trim();
  const res = document.getElementById('userSearchResults');
  if (q.length < 2) { res.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">Введите минимум 2 символа</div>'; return; }
  res.innerHTML = '<div style="color:var(--dim);font-size:13px;padding:8px">Поиск...</div>';
  searchTimer = setTimeout(async () => {
    try {
      const users = await api('GET', `/api/users/search?q=${encodeURIComponent(q)}`);
      if (!users.length) { res.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">Никого не найдено</div>'; return; }
      res.innerHTML = '';
      users.forEach(u => {
        const isContact = S.contacts.some(c => c.id === u.id);
        const div = document.createElement('div');
        div.className = 'user-result';
        div.innerHTML = `
          <div class="c-ava" style="width:40px;height:40px;font-size:18px">${u.avatar_emoji}</div>
          <div class="ur-info">
            <div class="ur-name">${esc(u.display_name)}</div>
            <div class="ur-handle">@${esc(u.username)}</div>
          </div>
          <button class="ur-btn ${isContact ? 'added' : ''}" onclick="addContact(${u.id},this)">
            ${isContact ? 'Добавлен' : '+ Добавить'}
          </button>`;
        res.appendChild(div);
      });
    } catch (e) { res.innerHTML = `<div style="color:var(--red);font-size:13px;padding:8px">${e.message}</div>`; }
  }, 350);
}

async function addContact(contactId, btn) {
  try {
    const data = await api('POST', '/api/contacts', { contact_id: contactId });
    btn.textContent = 'Добавлен'; btn.classList.add('added');
    await loadContacts();
    showToast(`✅ ${data.contact.display_name} добавлен`);
  } catch (e) { showToast('❌ ' + e.message); }
}

// ── OPEN CHAT ────────────────────────────
async function openChat(contact) {
  S.activeContact = contact;
  S.unread[contact.id] = 0;

  document.getElementById('emptyState').style.display = 'none';
  const ca = document.getElementById('chatArea');
  ca.style.display = 'flex';

  document.getElementById('chatAva').textContent  = contact.avatar_emoji;
  document.getElementById('chatName').textContent = contact.display_name;
  document.getElementById('chatStatus').textContent = '@' + contact.username;
  document.getElementById('chatStatus').className  = 'topbar-status off';

  renderContactList();
  cancelReply();

  const msgs = document.getElementById('msgs');
  msgs.innerHTML = '<div class="date-sep"><span class="date-sep-lbl">Загрузка...</span></div>';

  try {
    const messages = await api('GET', `/api/messages/${contact.id}`);
    msgs.innerHTML = '';
    if (!messages.length) {
      msgs.innerHTML = '<div style="text-align:center;color:var(--dim);font-size:13px;margin-top:40px">Начните переписку!</div>';
    } else {
      let lastDate = null;
      messages.forEach(m => {
        const d = new Date(m.created_at).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
        if (d !== lastDate) {
          const sep = document.createElement('div');
          sep.className = 'date-sep';
          sep.innerHTML = `<span class="date-sep-lbl">${d}</span>`;
          msgs.appendChild(sep);
          lastDate = d;
        }
        msgs.appendChild(buildMsgEl(m));
      });
    }
    scrollToBottom();
  } catch (e) {
    msgs.innerHTML = `<div style="color:var(--red);padding:20px">${e.message}</div>`;
  }

  document.getElementById('msgInput').focus();

  // Mobile — показать чат
  if (window.innerWidth <= 600) {
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('mainArea').classList.add('visible');
  }
}

// ── BUILD MESSAGE ────────────────────────
function buildMsgEl(msg) {
  const isOut = msg.from_id === S.me.id;
  const wrap  = document.createElement('div');
  wrap.className = 'msg-wrap ' + (isOut ? 'out' : 'in');
  wrap.dataset.msgId = msg.id;

  const time = new Date(msg.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

  let html = '<div class="reply-hint">↩</div>';

  if (msg.reply_to_text) {
    html += `<div class="msg-reply-quote"><strong>${esc(msg.reply_to_sender || '')}</strong>${esc(msg.reply_to_text)}</div>`;
  }

  if (msg.type === 'file') {
    const ext  = (msg.file_name || '').split('.').pop().toLowerCase();
    html += `
      <a class="msg-file" href="${msg.content}" download="${esc(msg.file_name)}" target="_blank">
        <div class="file-icon">${fileIcon(ext)}</div>
        <div class="file-info">
          <div class="file-name">${esc(msg.file_name)}</div>
          <div class="file-size">${formatSize(msg.file_size)}</div>
          <div class="file-dl">Скачать ↓</div>
        </div>
      </a>`;
  } else {
    html += `<div class="msg-bubble">${esc(msg.content || '').replace(/\n/g,'<br>')}</div>`;
  }

  html += `<div class="msg-meta">${time}${isOut ? ' <span class="chk">✓✓</span>' : ''}</div>`;
  wrap.innerHTML = html;

  initMsgSwipe(wrap, msg);
  return wrap;
}

function appendMessage(msg) {
  const msgs = document.getElementById('msgs');
  const ph = msgs.querySelector('[style*="Начните"]');
  if (ph) ph.remove();
  msgs.appendChild(buildMsgEl(msg));
  scrollToBottom();
}

// ── SEND MESSAGE ─────────────────────────
async function sendMsg() {
  const input = document.getElementById('msgInput');
  const text  = input.value.trim();
  if (!text || !S.activeContact) return;

  input.value = '';
  input.style.height = 'auto';

  const fakeMsg = {
    id: Date.now(),
    from_id: S.me.id,
    to_id:   S.activeContact.id,
    type:    'text',
    content: text,
    reply_to_text:   replyTarget ? replyTarget.text   : null,
    reply_to_sender: replyTarget ? replyTarget.sender : null,
    created_at: new Date().toISOString()
  };

  const rd = replyTarget ? { reply_to_text: replyTarget.text, reply_to_sender: replyTarget.sender } : {};
  cancelReply();
  appendMessage(fakeMsg);

  try {
    await api('POST', '/api/messages', { to_id: S.activeContact.id, content: text, ...rd });
  } catch (e) {
    showToast('❌ ' + e.message);
  }
  stopTyping();
}

// ── FILE SEND ────────────────────────────
function sendFileDialog() {
  if (!S.activeContact) { showToast('Выберите контакт'); return; }
  document.getElementById('fileInput').click();
}

async function doSendFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  if (file.size > 50 * 1024 * 1024) { showToast('❌ Файл > 50 МБ'); return; }
  showToast('📎 Отправляем...');
  const form = new FormData();
  form.append('file', file);
  form.append('to_id', S.activeContact.id);
  try {
    const msg = await api('POST', '/api/files/send', form, true);
    appendMessage(msg);
    showToast('✅ Файл отправлен');
  } catch (e) { showToast('❌ ' + e.message); }
}

// ── TYPING ───────────────────────────────
function onTyping() {
  if (!S.activeContact || !S.ws) return;
  S.ws.send(JSON.stringify({ type: 'typing', to_id: S.activeContact.id, typing: true }));
  clearTimeout(S.typingTimer);
  S.typingTimer = setTimeout(stopTyping, 2000);
}

function stopTyping() {
  if (!S.activeContact || !S.ws) return;
  S.ws.send(JSON.stringify({ type: 'typing', to_id: S.activeContact?.id, typing: false }));
}

function showTyping(on) {
  document.getElementById('typingBar').style.display = on ? '' : 'none';
  if (on) scrollToBottom();
}

// ── REPLY ────────────────────────────────
function cancelReply() {
  replyTarget = null;
  document.getElementById('replyBox').style.display  = 'none';
  document.getElementById('replyName').textContent   = '';
  document.getElementById('replyText').textContent   = '';
}

function startReply(senderName, text) {
  replyTarget = { sender: senderName, text };
  document.getElementById('replyName').textContent = senderName;
  document.getElementById('replyText').textContent = text.slice(0, 80);
  document.getElementById('replyBox').style.display = 'flex';
  document.getElementById('msgInput').focus();
}

// ── SWIPE BACK ───────────────────────────
function initSwipeBack() {
  const main = document.getElementById('mainArea');
  let sx = 0, sy = 0, active = false;

  main.addEventListener('touchstart', e => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    active = (sx < 30 && window.innerWidth <= 600);
  }, { passive: true });

  main.addEventListener('touchmove', e => {
    if (!active) return;
    const dx = e.touches[0].clientX - sx;
    const dy = Math.abs(e.touches[0].clientY - sy);
    if (dy > 60) { active = false; main.style.transform = ''; return; }
    if (dx > 0) {
      main.style.transition = 'none';
      main.style.transform  = `translateX(${Math.min(dx, window.innerWidth)}px)`;
    }
  }, { passive: true });

  main.addEventListener('touchend', e => {
    if (!active) return;
    active = false;
    const dx = e.changedTouches[0].clientX - sx;
    main.style.transition = '';
    main.style.transform  = '';
    if (dx > 80) goBack();
  }, { passive: true });
}

// ── SWIPE MESSAGE (reply) ────────────────
function initMsgSwipe(el, msg) {
  const isOut = msg.from_id === S.me.id;
  let sx = 0, sy = 0, moving = false, done = false;

  el.addEventListener('touchstart', e => {
    if (e.touches[0].clientX < 30) return; // не мешать свайпу назад
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    moving = false; done = false;
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (sx === 0) return;
    const dx = e.touches[0].clientX - sx;
    const dy = Math.abs(e.touches[0].clientY - sy);
    if (!moving && dy > Math.abs(dx) + 5) return; // вертикальный скролл
    const dir = isOut ? -dx : dx;
    if (dir > 5) {
      moving = true;
      const offset = Math.min(dir, 65);
      el.classList.add('swiping');
      el.style.transform = isOut ? `translateX(${-offset}px)` : `translateX(${offset}px)`;
      if (offset > 42 && !done) {
        done = true;
        el.classList.add('show-reply-hint');
        if (navigator.vibrate) navigator.vibrate(25);
      }
      if (offset < 30) { done = false; el.classList.remove('show-reply-hint'); }
    }
  }, { passive: true });

  el.addEventListener('touchend', () => {
    el.classList.remove('swiping', 'show-reply-hint');
    el.style.transform = '';
    if (done) {
      const name = isOut ? 'Вы' : (msg.sender || S.activeContact?.display_name || '');
      startReply(name, msg.content || msg.file_name || '');
    }
    sx = 0; moving = false; done = false;
  }, { passive: true });
}

// ── MOBILE NAV ───────────────────────────
function goBack() {
  document.getElementById('sidebar').classList.remove('hidden');
  document.getElementById('mainArea').classList.remove('visible');
  document.getElementById('mainArea').style.transform = '';
  S.activeContact = null;
}

function mobileNav(panel) {
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  const isChats = panel === 'chats';
  document.getElementById('mnavChats').classList.toggle('active', isChats);
  document.getElementById('mnavContacts').classList.toggle('active', !isChats);
  document.getElementById('panelChats').style.display    = isChats ? '' : 'none';
  document.getElementById('panelContacts').style.display = isChats ? 'none' : '';
  if (!isChats) renderContactsFullList();
  if (window.innerWidth <= 600) {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('mainArea').classList.remove('visible');
  }
}

// ── DOTS MENU ────────────────────────────
function toggleDotsMenu() {
  if (!S.activeContact) return;
  const c = document.getElementById('profileContent');
  c.innerHTML = `
    <div class="modal-head">
      <h3>${esc(S.activeContact.display_name)}</h3>
      <button class="close-btn" onclick="closeModal('modalProfile')">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="settings-item-btn" onclick="closeModal('modalProfile');sendFileDialog()">📎 Отправить файл</button>
      <button class="settings-item-btn" onclick="closeModal('modalProfile');showToast('🔕 Замьючено')">🔕 Замьютить</button>
      <button class="settings-item-btn danger" onclick="closeModal('modalProfile');showToast('🗑 Очищено')">🗑 Очистить историю</button>
    </div>`;
  openModal('modalProfile');
}

// ── PUSH ─────────────────────────────────
async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await fetch('/api/push/vapid-public-key').then(r => r.json());
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    await api('POST', '/api/push/subscribe', sub.toJSON());
  } catch (_) {}
}

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g,'+').replace(/_/g,'/'));
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

// ── NAV ──────────────────────────────────
function setNav(el, panel) {
  document.querySelectorAll('.lnav-icon').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('panelChats').style.display    = panel === 'chats' ? '' : 'none';
  document.getElementById('panelContacts').style.display = panel === 'contacts' ? '' : 'none';
  if (panel === 'contacts') renderContactsFullList();
}

// ── PROFILE ──────────────────────────────
function openMyProfile() {
  const c = document.getElementById('profileContent');
  c.innerHTML = `
    <div class="modal-head">
      <h3>Мой профиль</h3>
      <button class="close-btn" onclick="closeModal('modalProfile')">✕</button>
    </div>
    <div class="profile-big-ava">${S.me.avatar_emoji}</div>
    <div class="profile-big-name">${esc(S.me.display_name)}</div>
    <div class="profile-big-handle">@${esc(S.me.username)}</div>
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:13px;color:var(--muted);margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--dim);margin-bottom:6px;font-family:var(--h)">Username для поиска</div>
      <div style="font-size:15px;font-weight:700;color:var(--text);font-family:var(--h)">@${esc(S.me.username)}</div>
    </div>
    <button class="btn-outline" style="width:100%" onclick="doLogout()">🚪 Выйти</button>`;
  openModal('modalProfile');
}

// ── MODALS ───────────────────────────────
function showAddContact() {
  document.getElementById('userSearchInput').value = '';
  document.getElementById('userSearchResults').innerHTML = '';
  openModal('modalAddContact');
  setTimeout(() => document.getElementById('userSearchInput').focus(), 300);
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── HELPERS ──────────────────────────────
function switchScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function scrollToBottom() {
  const m = document.getElementById('msgs');
  m.scrollTop = m.scrollHeight;
}

function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' Б';
  if (b < 1048576) return (b/1024).toFixed(1) + ' КБ';
  return (b/1048576).toFixed(1) + ' МБ';
}

function fileIcon(ext) {
  const m = { pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',zip:'🗜',rar:'🗜',
    mp3:'🎵',wav:'🎵',mp4:'🎥',mov:'🎥',jpg:'🖼',jpeg:'🖼',png:'🖼',gif:'🖼',
    txt:'📃',js:'💻',py:'💻',html:'💻',json:'💻' };
  return m[ext] || '📎';
}

let toastT;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── KEYBOARD ─────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape')
    document.querySelectorAll('.modal-bg.open').forEach(m => m.classList.remove('open'));
});

document.getElementById('lPass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('lUser').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });

// ── INIT ─────────────────────────────────
(async () => {
  if (S.token && S.me) {
    try { await api('GET', '/api/me'); bootApp(); }
    catch (_) {
      localStorage.removeItem('nexus_token');
      localStorage.removeItem('nexus_me');
      switchScreen('authScreen');
    }
  } else {
    switchScreen('authScreen');
  }
})();
