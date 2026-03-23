/* ═══════════════════════════════════════
   NEXUS MESSENGER — Frontend App
═══════════════════════════════════════ */

// ── STATE ──────────────────────────────
const S = {
  token: localStorage.getItem('nexus_token') || null,
  me: JSON.parse(localStorage.getItem('nexus_me') || 'null'),
  contacts: [],
  activeContact: null,
  ws: null,
  typingTimer: null,
  typingTimeouts: {},
  unread: {},
};

// ── API ────────────────────────────────
async function api(method, url, body, isForm) {
  const opts = {
    method,
    headers: { Authorization: 'Bearer ' + S.token }
  };
  if (body && !isForm) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (isForm) {
    opts.body = body; // FormData
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

// ── AUTH ───────────────────────────────
function switchTab(tab) {
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabReg').classList.toggle('active', tab === 'reg');
  document.getElementById('loginForm').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('regForm').style.display  = tab === 'reg'   ? '' : 'none';
  document.getElementById('resetForm').style.display = tab === 'reset' ? '' : 'none';
  document.getElementById('loginErr').textContent = '';
  document.getElementById('regErr').textContent   = '';
  if (document.getElementById('resetErr'))
    document.getElementById('resetErr').textContent = '';
}

async function doLogin() {
  const username = document.getElementById('lUser').value.trim();
  const password = document.getElementById('lPass').value;
  document.getElementById('loginErr').textContent = '';
  try {
    const data = await api('POST', '/api/login', { username, password });
    saveSession(data);
    bootApp();
  } catch (e) {
    document.getElementById('loginErr').textContent = e.message;
  }
}

async function doRegister() {
  const display_name = document.getElementById('rName').value.trim();
  const username = document.getElementById('rUser').value.trim().toLowerCase();
  const password = document.getElementById('rPass').value;
  document.getElementById('regErr').textContent = '';
  try {
    const data = await api('POST', '/api/register', { username, display_name, password });
    saveSession(data);
    bootApp();
  } catch (e) {
    document.getElementById('regErr').textContent = e.message;
  }
}

async function doReset() {
  const username = document.getElementById('rstUser').value.trim();
  const password = document.getElementById('rstPass').value;
  const password2 = document.getElementById('rstPass2').value;
  document.getElementById('resetErr').textContent = '';

  if (!username || !password) {
    document.getElementById('resetErr').textContent = 'Заполните все поля';
    return;
  }
  if (password !== password2) {
    document.getElementById('resetErr').textContent = 'Пароли не совпадают';
    return;
  }
  try {
    await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    });
    switchTab('login');
    document.getElementById('lUser').value = username;
    document.getElementById('loginErr').textContent = '';
    showToast('✅ Пароль изменён — войди с новым паролем');
  } catch (e) {
    document.getElementById('resetErr').textContent = e.message;
  }
}

function saveSession(data) {
  S.token = data.token;
  S.me = data.user;
  localStorage.setItem('nexus_token', data.token);
  localStorage.setItem('nexus_me', JSON.stringify(data.user));
}

async function doLogout() {
  try { await api('POST', '/api/logout'); } catch (_) {}
  S.token = null; S.me = null;
  localStorage.removeItem('nexus_token');
  localStorage.removeItem('nexus_me');
  if (S.ws) S.ws.close();
  switchScreen('authScreen');
}

// ── BOOT ───────────────────────────────
async function bootApp() {
  switchScreen('appScreen');
  document.getElementById('myAvaEmoji').textContent = S.me.avatar_emoji;
  await loadContacts();
  connectWS();
}

// ── WEBSOCKET ──────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  S.ws = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token: S.token }));
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'message') {
      // Входящее сообщение
      const fromId = msg.message.from_id;
      if (S.activeContact && S.activeContact.id === fromId) {
        appendMessage(msg.message, false);
        scrollToBottom();
      } else {
        // Счётчик непрочитанных
        S.unread[fromId] = (S.unread[fromId] || 0) + 1;
        renderContactList();
        showToast(`💬 Новое сообщение от ${getContactName(fromId)}`);
      }
    }

    if (msg.type === 'message_sent') {
      // Подтверждение отправки — обновляем статус
    }

    if (msg.type === 'typing') {
      if (S.activeContact && S.activeContact.id === msg.from_id) {
        showTyping(msg.typing);
      }
    }
  };

  ws.onclose = () => {
    setTimeout(connectWS, 3000); // Переподключение
  };
}

// ── CONTACTS ───────────────────────────
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
      <div>${q ? 'Ничего не найдено' : 'Добавьте контакты чтобы начать общение'}</div>
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
      ${unread > 0 ? `<div class="c-unread">${unread}</div>` : ''}
    `;
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
      <button class="btn-outline" style="margin-top:14px" onclick="showAddContact()">+ Добавить контакт</button>
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
      </button>
    `;
    list.appendChild(div);
  });
}

// ── SEARCH USERS ───────────────────────
let searchTimer;
async function searchUsers() {
  clearTimeout(searchTimer);
  const q = document.getElementById('userSearchInput').value.trim();
  const res = document.getElementById('userSearchResults');
  if (q.length < 2) { res.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 4px">Введите минимум 2 символа</div>'; return; }

  res.innerHTML = '<div style="color:var(--dim);font-size:13px;padding:8px 4px">Поиск...</div>';
  searchTimer = setTimeout(async () => {
    try {
      const users = await api('GET', `/api/users/search?q=${encodeURIComponent(q)}`);
      if (users.length === 0) {
        res.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 4px">Никого не найдено</div>';
        return;
      }
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
          <button class="ur-btn ${isContact ? 'added' : ''}" onclick="addContact(${u.id}, this)">
            ${isContact ? 'Добавлен' : '+ Добавить'}
          </button>
        `;
        res.appendChild(div);
      });
    } catch (e) {
      res.innerHTML = `<div style="color:var(--red);font-size:13px;padding:8px 4px">${e.message}</div>`;
    }
  }, 350);
}

async function addContact(contactId, btn) {
  try {
    const data = await api('POST', '/api/contacts', { contact_id: contactId });
    btn.textContent = 'Добавлен';
    btn.classList.add('added');
    await loadContacts();
    showToast(`✅ ${data.contact.display_name} добавлен в контакты`);
  } catch (e) {
    showToast('❌ ' + e.message);
  }
}

// ── CHAT ───────────────────────────────
async function openChat(contact) {
  S.activeContact = contact;
  S.unread[contact.id] = 0;

  // Switch to chat view
  document.getElementById('emptyState').style.display = 'none';
  const ca = document.getElementById('chatArea');
  ca.style.display = 'flex';

  // Topbar
  document.getElementById('chatAva').textContent = contact.avatar_emoji;
  document.getElementById('chatName').textContent = contact.display_name;
  document.getElementById('chatStatus').textContent = '@' + contact.username;
  document.getElementById('chatStatus').className = 'topbar-status off';

  renderContactList();

  // Load messages
  const msgs = document.getElementById('msgs');
  msgs.innerHTML = '<div class="date-sep"><span class="date-sep-lbl">Загрузка...</span></div>';

  try {
    const messages = await api('GET', `/api/messages/${contact.id}`);
    msgs.innerHTML = '';
    if (messages.length === 0) {
      msgs.innerHTML = `<div style="text-align:center;color:var(--dim);font-size:13px;margin-top:40px">Начните переписку!</div>`;
    } else {
      let lastDate = null;
      messages.forEach(m => {
        const d = new Date(m.created_at).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
        if (d !== lastDate) {
          msgs.innerHTML += `<div class="date-sep"><span class="date-sep-lbl">${d}</span></div>`;
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
}

function buildMsgEl(msg) {
  const isOut = msg.from_id === S.me.id;
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap ' + (isOut ? 'out' : 'in');

  const time = new Date(msg.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

  if (msg.type === 'file') {
    const size = formatSize(msg.file_size);
    const ext = (msg.file_name || '').split('.').pop().toLowerCase();
    const icon = fileIcon(ext);
    wrap.innerHTML = `
      <a class="msg-file" href="${msg.content}" download="${esc(msg.file_name)}" target="_blank">
        <div class="file-icon">${icon}</div>
        <div class="file-info">
          <div class="file-name">${esc(msg.file_name)}</div>
          <div class="file-size">${size}</div>
          <div class="file-dl">Скачать ↓</div>
        </div>
      </a>
      <div class="msg-meta">${time}${isOut ? ' <span class="chk">✓✓</span>' : ''}</div>`;
  } else {
    wrap.innerHTML = `
      <div class="msg-bubble">${esc(msg.content).replace(/\n/g, '<br>')}</div>
      <div class="msg-meta">${time}${isOut ? ' <span class="chk">✓✓</span>' : ''}</div>`;
  }

  return wrap;
}

function appendMessage(msg, scrollDown = true) {
  const msgs = document.getElementById('msgs');
  // Remove "начните переписку" placeholder if exists
  const placeholder = msgs.querySelector('[data-placeholder]');
  if (placeholder) placeholder.remove();

  msgs.appendChild(buildMsgEl(msg));
  if (scrollDown) scrollToBottom();
}

// ── SEND MESSAGE ───────────────────────
async function sendMsg() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text || !S.activeContact) return;

  input.value = '';
  input.style.height = 'auto';

  // Optimistic UI
  const fakeMsg = {
    id: Date.now(),
    from_id: S.me.id,
    to_id: S.activeContact.id,
    type: 'text',
    content: text,
    created_at: new Date().toISOString()
  };
  appendMessage(fakeMsg);

  try {
    await api('POST', '/api/messages', { to_id: S.activeContact.id, content: text });
  } catch (e) {
    showToast('❌ Ошибка отправки: ' + e.message);
  }

  stopTyping();
}

// ── FILE SEND ──────────────────────────
function sendFileDialog() {
  if (!S.activeContact) { showToast('Сначала выберите контакт'); return; }
  document.getElementById('fileInput').click();
}

async function doSendFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  if (file.size > 50 * 1024 * 1024) {
    showToast('❌ Файл слишком большой (макс 50 МБ)');
    return;
  }

  showToast(`📎 Отправляем ${file.name}...`);

  const form = new FormData();
  form.append('file', file);
  form.append('to_id', S.activeContact.id);

  try {
    const msg = await api('POST', '/api/files/send', form, true);
    appendMessage(msg);
    showToast(`✅ Файл отправлен`);
  } catch (e) {
    showToast('❌ Ошибка: ' + e.message);
  }
}

// ── TYPING ─────────────────────────────
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

// ── HELPERS ────────────────────────────
function scrollToBottom() {
  const msgs = document.getElementById('msgs');
  msgs.scrollTop = msgs.scrollHeight;
}

function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

function cancelReply() {
  document.getElementById('replyBox').style.display = 'none';
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

function fileIcon(ext) {
  const map = { pdf:'📄', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📊', pptx:'📊',
    zip:'🗜', rar:'🗜', '7z':'🗜', mp3:'🎵', wav:'🎵', mp4:'🎥', mov:'🎥', avi:'🎥',
    jpg:'🖼', jpeg:'🖼', png:'🖼', gif:'🖼', svg:'🖼', txt:'📃', js:'💻', ts:'💻',
    py:'💻', html:'💻', css:'💻', json:'💻' };
  return map[ext] || '📎';
}

// ── NAV ────────────────────────────────
function setNav(el, panel) {
  document.querySelectorAll('.lnav-icon').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('panelChats').style.display = panel === 'chats' ? '' : 'none';
  document.getElementById('panelContacts').style.display = panel === 'contacts' ? '' : 'none';
  if (panel === 'contacts') renderContactsFullList();
}

// ── PROFILE ────────────────────────────
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
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--dim);margin-bottom:6px;font-family:var(--h)">Твой ID</div>
      <div style="font-size:16px;font-weight:700;color:var(--text);font-family:var(--h)">${S.me.id}</div>
      <div style="font-size:11px;margin-top:4px">Поделись своим username <b>@${esc(S.me.username)}</b> с другом чтобы он мог найти тебя</div>
    </div>
    <button class="btn-outline" style="width:100%" onclick="doLogout()">🚪 Выйти</button>
  `;
  openModal('modalProfile');
}

// ── MODALS ─────────────────────────────
function showAddContact() {
  document.getElementById('userSearchInput').value = '';
  document.getElementById('userSearchResults').innerHTML = '';
  openModal('modalAddContact');
  setTimeout(() => document.getElementById('userSearchInput').focus(), 100);
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── SCREEN ─────────────────────────────
function switchScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── TOAST ──────────────────────────────
let toastT;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── MOBILE NAV ─────────────────────────────
function isMobile() { return window.innerWidth <= 600; }

function mobileNav(panel) {
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  if (panel === 'chats') {
    document.getElementById('mnavChats').classList.add('active');
    document.getElementById('panelChats').style.display = '';
    document.getElementById('panelContacts').style.display = 'none';
  } else {
    document.getElementById('mnavContacts').classList.add('active');
    document.getElementById('panelChats').style.display = 'none';
    document.getElementById('panelContacts').style.display = '';
    renderContactsFullList();
  }
  if (isMobile()) {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('mainArea').classList.remove('visible');
  }
}

function goBack() {
  if (isMobile()) {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('mainArea').classList.remove('visible');
  }
}

// Патч openChat для мобильного
const _origOpenChat = openChat;
openChat = async function(contact) {
  await _origOpenChat(contact);
  if (isMobile()) {
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('mainArea').classList.add('visible');
  }
};

// ── KEYBOARD SHORTCUTS ─────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-bg.open').forEach(m => m.classList.remove('open'));
  }
});

// ── INIT ───────────────────────────────
(async () => {
  if (S.token && S.me) {
    try {
      // Verify session still valid
      await api('GET', '/api/me');
      bootApp();
    } catch (_) {
      // Session expired
      S.token = null; S.me = null;
      localStorage.removeItem('nexus_token');
      localStorage.removeItem('nexus_me');
      switchScreen('authScreen');
    }
  } else {
    switchScreen('authScreen');
  }
})();

// Enter on auth forms
document.getElementById('lPass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('lUser').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
