const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── БАЗА ДАННЫХ (JSON файл) ───────────────────────────
const DB_FILE = path.join(__dirname, '..', 'nexus_data.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const empty = { users: [], sessions: [], contacts: [], messages: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(x => x.id)) + 1;
}

// ── ХРАНИЛИЩЕ ФАЙЛОВ ──────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── MIDDLEWARE ────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(uploadsDir));

function auth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  const db = loadDB();
  const session = db.sessions.find(s => s.token === token);
  if (!session) return res.status(401).json({ error: 'Сессия истекла' });
  req.userId = session.user_id;
  req.token = token;
  next();
}

// ── СБРОС ПАРОЛЯ ─────────────────────────────────────
app.post('/api/reset-password', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Заполните все поля' });

  const db = loadDB();
  const idx = db.users.findIndex(u => u.username === username);
  if (idx === -1)
    return res.status(404).json({ error: 'Пользователь не найден' });

  db.users[idx].password_hash = bcrypt.hashSync(password, 10);
  // Удаляем все старые сессии этого пользователя
  db.sessions = db.sessions.filter(s => s.user_id !== db.users[idx].id);
  saveDB(db);

  res.json({ ok: true });
});

// ── РЕГИСТРАЦИЯ ───────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { username, display_name, password } = req.body;
  if (!username || !display_name || !password)
    return res.status(400).json({ error: 'Заполните все поля' });


  const db = loadDB();
  if (db.users.find(u => u.username === username))
    return res.status(409).json({ error: 'Этот username уже занят' });

  const emojis = ['🙂','😎','🧑‍💻','👩‍💼','🧔','👩‍🎨','🦊','🐻','🦁','🐯','🦅','🌟'];
  const emoji = emojis[Math.floor(Math.random() * emojis.length)];
  const hash = bcrypt.hashSync(password, 10);
  const user = {
    id: nextId(db.users), username, display_name,
    password_hash: hash, avatar_emoji: emoji,
    created_at: new Date().toISOString()
  };
  db.users.push(user);
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({ token, user_id: user.id, created_at: new Date().toISOString() });
  saveDB(db);
  res.json({ token, user: { id: user.id, username, display_name, avatar_emoji: emoji } });
});

// ── ВХОД ─────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Введите логин и пароль' });
  const db = loadDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  if (!bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Неверный пароль' });
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({ token, user_id: user.id, created_at: new Date().toISOString() });
  saveDB(db);
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, avatar_emoji: user.avatar_emoji } });
});

// ── ВЫХОД ─────────────────────────────────────────────
app.post('/api/logout', auth, (req, res) => {
  const db = loadDB();
  db.sessions = db.sessions.filter(s => s.token !== req.token);
  saveDB(db);
  res.json({ ok: true });
});

// ── ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ ──────────────────────────────
app.get('/api/me', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  res.json({ id: user.id, username: user.username, display_name: user.display_name, avatar_emoji: user.avatar_emoji });
});

// ── ПОИСК ПОЛЬЗОВАТЕЛЕЙ ──────────────────────────────
app.get('/api/users/search', auth, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (q.length < 2) return res.json([]);
  const db = loadDB();
  const results = db.users
    .filter(u => u.id !== req.userId && (u.username.includes(q) || u.display_name.toLowerCase().includes(q)))
    .slice(0, 10)
    .map(u => ({ id: u.id, username: u.username, display_name: u.display_name, avatar_emoji: u.avatar_emoji }));
  res.json(results);
});

// ── КОНТАКТЫ ─────────────────────────────────────────
app.post('/api/contacts', auth, (req, res) => {
  const contact_id = parseInt(req.body.contact_id);
  if (!contact_id) return res.status(400).json({ error: 'Не указан contact_id' });
  if (contact_id === req.userId) return res.status(400).json({ error: 'Нельзя добавить себя' });
  const db = loadDB();
  const target = db.users.find(u => u.id === contact_id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!db.contacts.find(c => c.user_id === req.userId && c.contact_id === contact_id))
    db.contacts.push({ id: nextId(db.contacts), user_id: req.userId, contact_id, created_at: new Date().toISOString() });
  if (!db.contacts.find(c => c.user_id === contact_id && c.contact_id === req.userId))
    db.contacts.push({ id: nextId(db.contacts), user_id: contact_id, contact_id: req.userId, created_at: new Date().toISOString() });
  saveDB(db);
  res.json({ ok: true, contact: { id: target.id, username: target.username, display_name: target.display_name, avatar_emoji: target.avatar_emoji } });
});

app.get('/api/contacts', auth, (req, res) => {
  const db = loadDB();
  const contacts = db.contacts
    .filter(c => c.user_id === req.userId)
    .map(c => { const u = db.users.find(u => u.id === c.contact_id); return u ? { id: u.id, username: u.username, display_name: u.display_name, avatar_emoji: u.avatar_emoji } : null; })
    .filter(Boolean);
  res.json(contacts);
});

app.delete('/api/contacts/:id', auth, (req, res) => {
  const db = loadDB();
  db.contacts = db.contacts.filter(c => !(c.user_id === req.userId && c.contact_id === parseInt(req.params.id)));
  saveDB(db);
  res.json({ ok: true });
});

// ── СООБЩЕНИЯ ─────────────────────────────────────────
app.post('/api/messages', auth, (req, res) => {
  const { to_id, content } = req.body;
  if (!to_id || !content?.trim())
    return res.status(400).json({ error: 'Нет получателя или сообщение пустое' });
  const db = loadDB();
  const msg = {
    id: nextId(db.messages), from_id: req.userId, to_id: parseInt(to_id),
    type: 'text', content: content.trim(), file_name: null, file_size: null,
    created_at: new Date().toISOString()
  };
  db.messages.push(msg);
  saveDB(db);
  broadcast(parseInt(to_id), { type: 'message', message: msg });
  res.json(msg);
});

app.get('/api/messages/:with_id', auth, (req, res) => {
  const withId = parseInt(req.params.with_id);
  const db = loadDB();
  const messages = db.messages
    .filter(m => (m.from_id === req.userId && m.to_id === withId) || (m.from_id === withId && m.to_id === req.userId))
    .slice(-200);
  res.json(messages);
});

// ── ФАЙЛЫ ─────────────────────────────────────────────
app.post('/api/files/send', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const to_id = parseInt(req.body.to_id);
  if (!to_id) return res.status(400).json({ error: 'Не указан получатель' });
  const db = loadDB();
  const msg = {
    id: nextId(db.messages), from_id: req.userId, to_id,
    type: 'file', content: `/uploads/${req.file.filename}`,
    file_name: req.file.originalname, file_size: req.file.size,
    created_at: new Date().toISOString()
  };
  db.messages.push(msg);
  saveDB(db);
  broadcast(to_id, { type: 'message', message: msg });
  res.json(msg);
});

// ── WEBSOCKET ─────────────────────────────────────────
const clients = new Map();

wss.on('connection', (ws) => {
  let userId = null;
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'auth') {
        const db = loadDB();
        const session = db.sessions.find(s => s.token === msg.token);
        if (session) {
          userId = session.user_id;
          clients.set(userId, ws);
          ws.send(JSON.stringify({ type: 'auth_ok', userId }));
        }
      }
      if (msg.type === 'typing' && userId) {
        const target = clients.get(msg.to_id);
        if (target && target.readyState === WebSocket.OPEN)
          target.send(JSON.stringify({ type: 'typing', from_id: userId, typing: msg.typing }));
      }
    } catch (_) {}
  });
  ws.on('close', () => { if (userId) clients.delete(userId); });
});

function broadcast(userId, data) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ── ЗАПУСК ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅ NEXUS запущен! Открой браузер: http://localhost:${PORT}\n`);
  console.log(`   Данные: nexus_data.json`);
  console.log(`   Файлы:  uploads/\n`);
});
