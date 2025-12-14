// commands/allmenu.js
// Balasan command .allmenu untuk Astheric Bot

module.exports = async function allmenu(sock, jid, sender) {
  const userTag = String(sender).split('@')[0];

  const menuText = `
╭─── 🎀 ASTHERIC BOT MENU 🎀 ───╮
│ Bot : Astheric
│ User : 🌸 @${userTag}
│ Mode : Multi Device
╰─────────────────────────────╯

🌸 MAIN MENU
♡ .menu       → Tampilkan menu
♡ .allmenu    → Semua command
♡ .info       → Info bot
♡ .ping       → Cek bot aktif
♡ .profile    → Cek profil user
♡ .daftar     → Daftar user baru
♡ .rules      → Peraturan bot
♡ .donasi     → Info donasi / support

💞 GROUP MENU
♡ .antilink on/off     → Blokir link otomatis
♡ .welcome on/off      → Nyalakan pesan welcome
♡ .goodbye on/off      → Nyalakan pesan keluar
♡ .group open/close    → Buka/tutup grup
♡ .add          → Tambah member
♡ .kick         → Keluarkan member
♡ .promote      → Jadikan admin
♡ .demote       → Turunkan admin
♡ .tagall              → Tag semua member
♡ .mute on/off         → Heningkan grup
♡ .unmute              → Buka hening

🛡 ADMIN MENU
♡ .del          → Hapus pesan
♡ .warn         → Beri peringatan
♡ .stickers            → Buat sticker dari gambar
♡ .setdesc       → Ganti deskripsi grup
♡ .setname       → Ganti nama grup
♡ .hidetag             → Kirim pesan tanpa tag terlihat

💗 OWNER MENU
♡ .owner               → Info owner
♡ .broadcast    → Kirim ke semua user
♡ .eval          → Jalankan kode JS
♡ .restart             → Restart bot
♡ .setprefix   → Ganti prefix bot
♡ .block        → Block user
♡ .unblock      → Unblock user
♡ .setppbot            → Ganti foto profil bot
♡ .setwm         → Set watermark / footer
♡ .setmenu       → Set tampilan menu

✨ BUTTON / LIST RECOMMENDATION
[Owner] [Group] [Admin] [User] [Donasi]
`;

  await sock.sendMessage(jid, { text: menuText, mentions: [sender] });
};
