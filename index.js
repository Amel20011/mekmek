// index.js
// Astheric Bot - Baileys MD with Interactive Buttons V2
// Node.js 18 LTS (wajib) atau 20 LTS

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  jidNormalizedUser,
  proto,
} = require('@whiskeysockets/baileys');

const Pino = require('pino');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const _ = require('lodash');
const { nanoid } = require('nanoid');
const fs = require('fs');

// Commands
const allmenu = require('./commands/allmenu');

const CONFIG = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

// Simple DB
const adapter = new JSONFile('./database.json');
const db = new Low(adapter);
async function initDB() {
  await db.read();
  db.data ||= {
    users: [],      // { id, name, registeredAt, warns }
    groups: [],     // { id, welcome, goodbye, antilink, mute }
    broadcasts: [],
    settings: { prefix: CONFIG.prefix, wm: CONFIG.wm, menuStyle: 'ASTHERIC' }
  };
  await db.write();
}

// DB helpers
function getUser(jid) {
  const id = jidNormalizedUser(jid);
  return db.data.users.find(u => u.id === id);
}
async function registerUser(jid, name = '') {
  const id = jidNormalizedUser(jid);
  let u = getUser(id);
  if (!u) {
    u = { id, name, registeredAt: Date.now(), warns: 0 };
    db.data.users.push(u);
    await db.write();
  }
  return u;
}
function getGroup(gid) {
  return db.data.groups.find(g => g.id === gid);
}
async function ensureGroup(gid) {
  let g = getGroup(gid);
  if (!g) {
    g = {
      id: gid,
      welcome: CONFIG.welcomeEnabledByDefault,
      goodbye: true,
      antilink: CONFIG.antilinkEnabledByDefault,
      mute: CONFIG.muteEnabledByDefault
    };
    db.data.groups.push(g);
    await db.write();
  }
  return g;
}
async function setGroupFlag(gid, key, value) {
  const g = await ensureGroup(gid);
  g[key] = value;
  await db.write();
  return g;
}

// Logger & Store
const logger = Pino({ level: 'info' });
const store = makeInMemoryStore({ logger });

// Utils
function extractNumberFromJid(jid) {
  return String(jid).split('@')[0];
}

// Interactive Buttons V2 builder
function buildInteractiveButtonsV2({ title, body, footer, buttons = [] }) {
  return {
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          header: { hasMediaAttachment: false },
          body: { text: body },
          footer: { text: footer || CONFIG.footer },
          nativeFlowMessage: {
            buttons: buttons.map(b => ({
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: b.text, // e.g., '#owner'
                id: b.id              // internal id
              })
            }))
          }
        }
      }
    }
  };
}

async function sendInteractive(sock, jid, opts) {
  const content = buildInteractiveButtonsV2(opts);
  await sock.sendMessage(jid, content);
}

// Menu text
function mainMenuText(userTag) {
  return [
    '╭─── 🎀 ASTHERIC BOT MENU 🎀 ───╮',
    `│ Bot : Astheric`,
    `│ User : 🌸 @${userTag}`,
    `│ Mode : Multi Device`,
    '╰─────────────────────────────╯',
    '',
    '🌸 MAIN MENU',
    '♡ .menu       → Tampilkan menu',
    '♡ .allmenu    → Semua command',
    '♡ .info       → Info bot',
    '♡ .ping       → Cek bot aktif',
    '♡ .profile    → Cek profil user',
    '♡ .daftar     → Daftar user baru',
    '♡ .rules      → Peraturan bot',
    '♡ .donasi     → Info donasi / support',
    '',
    '💞 GROUP MENU',
    '♡ .antilink on/off     → Blokir link otomatis',
    '♡ .welcome on/off      → Nyalakan pesan welcome',
    '♡ .goodbye on/off      → Nyalakan pesan keluar',
    '♡ .group open/close    → Buka/tutup grup',
    '♡ .add          → Tambah member',
    '♡ .kick         → Keluarkan member',
    '♡ .promote      → Jadikan admin',
    '♡ .demote       → Turunkan admin',
    '♡ .tagall              → Tag semua member',
    '♡ .mute on/off         → Heningkan grup',
    '♡ .unmute              → Buka hening',
    '',
    '🛡 ADMIN MENU',
    '♡ .del          → Hapus pesan',
    '♡ .warn         → Beri peringatan',
    '♡ .stickers            → Buat sticker dari gambar',
    '♡ .setdesc       → Ganti deskripsi grup',
    '♡ .setname       → Ganti nama grup',
    '♡ .hidetag             → Kirim pesan tanpa tag terlihat',
    '',
    '💗 OWNER MENU',
    '♡ .owner               → Info owner',
    '♡ .broadcast    → Kirim ke semua user',
    '♡ .eval          → Jalankan kode JS',
    '♡ .restart             → Restart bot',
    '♡ .setprefix   → Ganti prefix bot',
    '♡ .block        → Block user',
    '♡ .unblock      → Unblock user',
    '♡ .setppbot            → Ganti foto profil bot',
    '♡ .setwm         → Set watermark / footer',
    '♡ .setmenu       → Set tampilan menu',
    '',
    '✨ BUTTON / LIST RECOMMENDATION',
    '[Owner] [Group] [Admin] [User] [Donasi]'
  ].join('\n');
}

// Permissions
function isOwner(jid) {
  const ownerJid = jidNormalizedUser(CONFIG.ownerNumber + '@s.whatsapp.net');
  return jidNormalizedUser(jid) === ownerJid;
}
async function isAdmin(sock, gid, jid) {
  const meta = await sock.groupMetadata(gid);
  const participant = meta.participants.find(p => jidNormalizedUser(p.id) === jidNormalizedUser(jid));
  return participant?.admin === 'admin' || participant?.admin === 'superadmin';
}

// Command parsing
function parseCommand(text, prefix) {
  if (!text || !text.startsWith(prefix)) return null;
  const args = text.slice(prefix.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  return { cmd, args };
}

// Main
async function start() {
  await initDB();
  const { state, saveCreds } = await useMultiFileAuthState('./session');

  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: true,
    auth: state,
    browser: ['Astheric', 'Safari', '1.0'],
    syncFullHistory: false
  });

  store.bind(sock.ev);

  // Connection
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
      if (shouldReconnect) start();
    } else if (connection === 'open') {
      logger.info('✅ Astheric Bot connected');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Group participants (welcome/goodbye)
  sock.ev.on('group-participants.update', async (ev) => {
    const gid = ev.id;
    await ensureGroup(gid);

    if (ev.action === 'add') {
      for (const jid of ev.participants) {
        const userNumber = extractNumberFromJid(jid);
        const g = getGroup(gid);
        if (!g?.welcome) continue;

        // Auto welcome (Buttons V2)
        await sendInteractive(sock, gid, {
          title: 'Welcome',
          body: `🦋✨ Welcome kak @${userNumber} 💐 Selamat datang di LIVIAA ID 🌷\nSilakan klik button di bawah ya 🦋`,
          footer: CONFIG.footer,
          buttons: [
            { id: 'btn_daftar', text: '#daftar' },
            { id: 'btn_owner', text: '#owner' },
            { id: 'btn_help', text: '#pusat bantuan' }
          ]
        });

        // Additional join prompt
        await sendInteractive(sock, gid, {
          title: 'Hello',
          body: `✨ Hello @${userNumber} 💖 Aku Liviaa 🌷 yang akan menyambutmu sekarang 💗\nOh iya, kamu mau pakai aku? Klik salah satu tombol di bawah 🌸`,
          footer: CONFIG.footer,
          buttons: [
            { id: 'btn_daftar2', text: '#daftar' },
            { id: 'btn_owner2', text: '#owner' }
          ]
        });
      }
    } else if (ev.action === 'remove') {
      const g = getGroup(gid);
      if (g?.goodbye) {
        for (const jid of ev.participants) {
          const userNumber = extractNumberFromJid(jid);
          await sock.sendMessage(gid, {
            text: `🌸 Goodbye @${userNumber} — semoga kembali lagi!`,
            mentions: [jidNormalizedUser(jid)]
          });
        }
      }
    }
  });

  // Messages handler (commands + interactive)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        const m = msg;
        const jid = m.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        const sender = m.key.fromMe ? sock.user.id : (m.key.participant || m.key.remoteJid);
        const text = (m.message?.conversation)
          || (m.message?.extendedTextMessage?.text)
          || (m.message?.imageMessage?.caption)
          || (m.message?.videoMessage?.caption)
          || '';

        // Prompt unregistered users in group
        const user = getUser(sender);
        if (!user && isGroup) {
          const userNumber = extractNumberFromJid(sender);
          await sendInteractive(sock, jid, {
            title: 'Daftar diperlukan',
            body: `🌸 Hai @${userNumber} ✨ Kamu belum terdaftar di sistemku 💗\nKalau ingin pakai aku, klik tombol di bawah ya 🌷`,
            footer: CONFIG.footer,
            buttons: [
              { id: 'btn_daftar_pribadi', text: '#daftar' },
              { id: 'btn_owner3', text: '#owner' }
            ]
          });
        }

        // Handle interactive quick replies
        const interactiveId = m.message?.interactiveResponseMessage?.reply?.id;
        if (interactiveId) {
          await handleInteractive(sock, jid, sender, interactiveId);
          continue;
        }

        const prefix = db.data.settings.prefix || CONFIG.prefix;
        const parsed = parseCommand(text, prefix);
        if (!parsed) continue;

        const { cmd, args } = parsed;

        // Core commands
        if (cmd === 'ping') {
          await sock.sendMessage(jid, { text: '🏓 Astheric aktif!' });
        }

        else if (cmd === 'menu') {
          const userTag = extractNumberFromJid(sender);
          await sendInteractive(sock, jid, {
            title: 'ASTHERIC MENU',
            body: mainMenuText(userTag),
            footer: CONFIG.footer,
            buttons: [
              { id: 'btn_owner', text: '#owner' },
              { id: 'btn_user', text: '#user' },
              { id: 'btn_group', text: '#group' },
              { id: 'btn_admin', text: '#admin' },
              { id: 'btn_donasi', text: '#donasi' }
            ]
          });
        }

        else if (cmd === 'allmenu') {
          await allmenu(sock, jid, sender);
        }

        else if (cmd === 'info') {
          await sock.sendMessage(jid, {
            text: `🤖 ${CONFIG.botName}\nOwner: ${CONFIG.ownerName}\nPrefix: ${prefix}\nFooter/WM: ${db.data.settings.wm || CONFIG.wm}`
          });
        }

        else if (cmd === 'profile') {
          const u = getUser(sender);
          const reg = u ? 'Terdaftar' : 'Belum terdaftar';
          await sock.sendMessage(jid, {
            text: `👤 Status: ${reg}\nID: ${jidNormalizedUser(sender)}\nNama: ${u?.name || '-'}`
          });
        }

        else if (cmd === 'daftar') {
          const nameGuess = args.join(' ') || (m.pushName || '').trim() || `User-${nanoid(6)}`;
          const u = await registerUser(sender, nameGuess);
          await sock.sendMessage(jid, { text: `✅ Terdaftar: ${u.name}\nID: ${u.id}\nSelamat bergabung di ${CONFIG.wm}!` });
        }

        else if (cmd === 'rules') {
          await sock.sendMessage(jid, { text: `📜 Peraturan:\n1. Jangan spam.\n2. Hormati sesama.\n3. Ikuti arahan admin.\n4. Dilarang sebar link tanpa izin.` });
        }

        else if (cmd === 'donasi') {
          await sendInteractive(sock, jid, {
            title: 'Donasi',
            body: '💗 Dukungan kamu berarti! Pilih opsi donasi:',
            footer: CONFIG.footer,
            buttons: [
              { id: 'btn_donasi_qris', text: '#donasi qris' },
              { id: 'btn_donasi_saweria', text: '#donasi saweria' },
              { id: 'btn_owner', text: '#owner' }
            ]
          });
        }

        // Group commands
        else if (cmd === 'welcome' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const arg = (args[0] || '').toLowerCase();
          if (arg === 'on' || arg === 'off') {
            await setGroupFlag(jid, 'welcome', arg === 'on');
            await sock.sendMessage(jid, { text: `🔧 Welcome ${arg}` });
          }
        }

        else if (cmd === 'goodbye' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const arg = (args[0] || '').toLowerCase();
          if (arg === 'on' || arg === 'off') {
            await setGroupFlag(jid, 'goodbye', arg === 'on');
            await sock.sendMessage(jid, { text: `🔧 Goodbye ${arg}` });
          }
        }

        else if (cmd === 'antilink' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const arg = (args[0] || '').toLowerCase();
          if (arg === 'on' || arg === 'off') {
            await setGroupFlag(jid, 'antilink', arg === 'on');
            await sock.sendMessage(jid, { text: `🛡 Antilink ${arg}` });
          }
        }

        else if (cmd === 'group' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const arg = (args[0] || '').toLowerCase();
          if (arg === 'open') await sock.groupSettingUpdate(jid, 'not_announcement');
          else if (arg === 'close') await sock.groupSettingUpdate(jid, 'announcement');
          await sock.sendMessage(jid, { text: `🚪 Group ${arg}` });
        }

        else if (cmd === 'add' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const number = (args[0] || '').replace(/\D/g, '');
          if (number) await sock.groupParticipantsUpdate(jid, [number + '@s.whatsapp.net'], 'add');
        }

        else if (cmd === 'kick' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mentioned.length) await sock.groupParticipantsUpdate(jid, mentioned, 'remove');
        }

        else if (cmd === 'promote' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mentioned.length) await sock.groupParticipantsUpdate(jid, mentioned, 'promote');
        }

        else if (cmd === 'demote' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mentioned.length) await sock.groupParticipantsUpdate(jid, mentioned, 'demote');
        }

        else if (cmd === 'tagall' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const meta = await sock.groupMetadata(jid);
          const mentions = meta.participants.map(p => p.id);
          const names = meta.participants.map(p => '@' + extractNumberFromJid(p.id)).join(' ');
          await sock.sendMessage(jid, { text: `Tag All:\n${names}`, mentions });
        }

        else if (cmd === 'mute' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const arg = (args[0] || '').toLowerCase();
          if (arg === 'on') {
            await setGroupFlag(jid, 'mute', true);
            await sock.groupSettingUpdate(jid, 'announcement');
            await sock.sendMessage(jid, { text: '🔇 Grup dimute' });
          } else if (arg === 'off') {
            await setGroupFlag(jid, 'mute', false);
            await sock.groupSettingUpdate(jid, 'not_announcement');
            await sock.sendMessage(jid, { text: '🔊 Grup dibuka' });
          }
        }

        else if (cmd === 'unmute' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          await setGroupFlag(jid, 'mute', false);
          await sock.groupSettingUpdate(jid, 'not_announcement');
          await sock.sendMessage(jid, { text: '🔊 Grup dibuka' });
        }

        // Admin commands
        else if (cmd === 'del') {
          const key = m.message?.extendedTextMessage?.contextInfo?.stanzaId
            ? {
                remoteJid: jid,
                fromMe: false,
                id: m.message.extendedTextMessage.contextInfo.stanzaId,
                participant: m.message.extendedTextMessage.contextInfo.participant
              }
            : null;
          if (key) await sock.sendMessage(jid, { delete: key });
        }

        else if (cmd === 'warn') {
          const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          for (const x of mentioned) {
            const u = await registerUser(x, '');
            u.warns = (u.warns || 0) + 1;
          }
          await db.write();
          await sock.sendMessage(jid, { text: '⚠️ Peringatan diberikan.' });
        }

        else if (cmd === 'stickers') {
          if (m.message?.imageMessage) {
            const buffer = await sock.downloadMediaMessage(m);
            await sock.sendMessage(jid, { sticker: buffer });
          } else {
            await sock.sendMessage(jid, { text: 'Kirim gambar dengan caption .stickers' });
          }
        }

        else if (cmd === 'setdesc' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const newDesc = args.join(' ');
          await sock.groupUpdateDescription(jid, newDesc);
          await sock.sendMessage(jid, { text: '📝 Deskripsi diperbarui.' });
        }

        else if (cmd === 'setname' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const newName = args.join(' ');
          await sock.groupUpdateSubject(jid, newName);
          await sock.sendMessage(jid, { text: '📝 Nama grup diperbarui.' });
        }

        else if (cmd === 'hidetag' && isGroup) {
          if (!await isAdmin(sock, jid, sender) && !isOwner(sender)) return;
          const meta = await sock.groupMetadata(jid);
          const mentions = meta.participants.map(p => p.id);
          await sock.sendMessage(jid, { text: args.join(' ') || 'Hidetag', mentions });
        }

        // Owner commands
        else if (cmd === 'owner') {
          await sock.sendMessage(jid, { text: `👑 Owner: ${CONFIG.ownerName}\n📞 ${CONFIG.ownerNumber}` });
        }

        else if (cmd === 'broadcast') {
          if (!isOwner(sender)) return;
          const textBC = args.join(' ');
          const allUsers = db.data.users.map(u => u.id);
          for (const id of allUsers) {
            await sock.sendMessage(id, { text: `📣 Broadcast:\n${textBC}` });
          }
          db.data.broadcasts.push({ id: nanoid(), text: textBC, date: Date.now() });
          await db.write();
          await sock.sendMessage(jid, { text: '✅ Broadcast terkirim.' });
        }

        else if (cmd === 'eval') {
          if (!isOwner(sender)) return;
          try {
            const code = text.slice(prefix.length + 4).trim();
            const result = await eval(`(async()=>{ ${code} })()`);
            await sock.sendMessage(jid, { text: '✅ Eval:\n' + String(result) });
          } catch (e) {
            await sock.sendMessage(jid, { text: '❌ Error:\n' + e.message });
          }
        }

        else if (cmd === 'restart') {
          if (!isOwner(sender)) return;
          await sock.sendMessage(jid, { text: '♻️ Restarting...' });
          process.exit(0);
        }

        else if (cmd === 'setprefix') {
          if (!isOwner(sender)) return;
          const np = args[0] || '.';
          db.data.settings.prefix = np;
          await db.write();
          await sock.sendMessage(jid, { text: `✅ Prefix diubah: ${np}` });
        }

        else if (cmd === 'block') {
          if (!isOwner(sender)) return;
          const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          for (const x of mentioned) await sock.updateBlockStatus(x, 'block');
          await sock.sendMessage(jid, { text: '🚫 User diblok.' });
        }

        else if (cmd === 'unblock') {
          if (!isOwner(sender)) return;
          const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          for (const x of mentioned) await sock.updateBlockStatus(x, 'unblock');
          await sock.sendMessage(jid, { text: '✅ User di-unblock.' });
        }

        else if (cmd === 'setppbot') {
          if (!isOwner(sender)) return;
          if (m.message?.imageMessage) {
            const buffer = await sock.downloadMediaMessage(m);
            await sock.updateProfilePicture(sock.user.id, buffer);
            await sock.sendMessage(jid, { text: '🖼 Foto profil bot diperbarui.' });
          } else {
            await sock.sendMessage(jid, { text: 'Kirim gambar dengan caption .setppbot' });
          }
        }

        else if (cmd === 'setwm') {
          if (!isOwner(sender)) return;
          const newWM = args.join(' ') || CONFIG.wm;
          db.data.settings.wm = newWM;
          await db.write();
          await sock.sendMessage(jid, { text: `✅ Watermark diubah: ${newWM}` });
        }

        else if (cmd === 'setmenu') {
          if (!isOwner(sender)) return;
          const style = (args[0] || 'ASTHERIC').toUpperCase();
          db.data.settings.menuStyle = style;
          await db.write();
          await sock.sendMessage(jid, { text: `✅ Menu style: ${style}` });
        }
      } catch (err) {
        logger.error('Message handler error: ' + err.message);
      }
    }
  });

  // Antilink middleware
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      const jid = m.key.remoteJid;
      const isGroup = jid.endsWith('@g.us');
      if (!isGroup) continue;

      const text = (m.message?.conversation)
        || (m.message?.extendedTextMessage?.text)
        || (m.message?.imageMessage?.caption)
        || (m.message?.videoMessage?.caption)
        || '';

      const g = getGroup(jid);
      if (!g?.antilink) continue;

      if (/https?:\/\/\S+/i.test(text)) {
        const sender = m.key.fromMe ? sock.user.id : (m.key.participant || m.key.remoteJid);
        if (!(await isAdmin(sock, jid, sender)) && !isOwner(sender)) {
          await sock.sendMessage(jid, { text: '🛡 Link terdeteksi, pesan akan dihapus.' });
          if (m.key.id) {
            await sock.sendMessage(jid, { delete: m.key });
          }
        }
      }
    }
  });

  // Interactive handler
  async function handleInteractive(sock, jid, sender, id) {
    const map = {
      btn_owner: async () => sock.sendMessage(jid, { text: `👑 Owner: ${CONFIG.ownerName}\n📞 ${CONFIG.ownerNumber}` }),
      btn_owner2: async () => sock.sendMessage(jid, { text: `👑 Owner: ${CONFIG.ownerName}\n📞 ${CONFIG.ownerNumber}` }),
      btn_owner3: async () => sock.sendMessage(jid, { text: `👑 Owner: ${CONFIG.ownerName}\n📞 ${CONFIG.ownerNumber}` }),

      btn_user: async () => sock.sendMessage(jid, { text: `🌸 User menu:\n${CONFIG.prefix}profile\n${CONFIG.prefix}daftar\n${CONFIG.prefix}info` }),
      btn_group: async () => sock.sendMessage(jid, { text: `💞 Group menu:\n${CONFIG.prefix}welcome on/off\n${CONFIG.prefix}goodbye on/off\n${CONFIG.prefix}group open/close\n${CONFIG.prefix}antilink on/off` }),
      btn_admin: async () => sock.sendMessage(jid, { text: `🛡 Admin menu:\n${CONFIG.prefix}del\n${CONFIG.prefix}warn\n${CONFIG.prefix}hidetag` }),
      btn_donasi: async () => sock.sendMessage(jid, { text: `💗 Donasi:\n#donasi qris\n#donasi saweria` }),

      btn_help: async () => sock.sendMessage(jid, { text: `🧭 Pusat bantuan:\nGunakan ${CONFIG.prefix}menu atau klik tombol kategori.` }),

      btn_daftar: async () => {
        const name = 'User-' + nanoid(5);
        await registerUser(sender, name);
        await sock.sendMessage(jid, { text: `✅ Kamu terdaftar: ${name}` });
      },
      btn_daftar2: async () => {
        const name = 'User-' + nanoid(5);
        await registerUser(sender, name);
        await sock.sendMessage(jid, { text: `✅ Kamu terdaftar: ${name}` });
      },
      btn_daftar_pribadi: async () => {
        const name = 'User-' + nanoid(5);
        await registerUser(sender, name);
        await sock.sendMessage(jid, { text: `✅ Kamu terdaftar: ${name}` });
      },

      btn_donasi_qris: async () => sock.sendMessage(jid, { text: '🙏 Donasi via QRIS (kirim bukti ke owner).' }),
      btn_donasi_saweria: async () => sock.sendMessage(jid, { text: '🙏 Donasi via Saweria (hubungi owner untuk link).' })
    };

    if (map[id]) await map[id]();
  }
}

start();
