const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const sharp = require('sharp');
const http = require('http');

// 1. Server HTTP Formalitas (Supaya Web Service Render Free Tier Tidak Error)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot WhatsApp Aktif!');
}).listen(PORT, () => {
    console.log(`Server HTTP berjalan di port ${PORT}`);
});

// Map untuk menyimpan status aktif/mati bot per ruang obrolan (chat ID)
const botStatus = new Map();

async function connectToWhatsApp() {
    // Menyimpan sesi login di folder 'auth_info_baileys'
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true // Menampilkan QR code di Log Render
    });

    sock.ev.on('creds.update', saveCreds);

    // Handling Status Koneksi
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba menghubungkan kembali...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Bot WhatsApp Berhasil Terhubung!');
        }
    });

    // Handling Pesan Masuk
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const type = Object.keys(msg.message)[0];
        
        // Membaca teks baik dari pesan biasa, pesan balasan, maupun caption gambar
        let text = '';
        if (type === 'conversation') {
            text = msg.message.conversation;
        } else if (type === 'extendedTextMessage') {
            text = msg.message.extendedTextMessage.text;
        } else if (type === 'imageMessage') {
            text = msg.message.imageMessage.caption || '';
        }

        const command = text.trim().toLowerCase();
        // Cek status aktif bot di chat ini (default: true)
        const isActive = botStatus.get(from) ?? true;

        // --- COMMAND 1: !bot-start ---
        if (command === '!bot-start') {
            botStatus.set(from, true);
            const replyText = `halo! ada yang bisa saya bantu? kami di sini memiliki fitur-fitur berikut:\nhttps://0xloyz.github.io/bot/`;
            await sock.sendMessage(from, { text: replyText });
            return;
        }

        // --- COMMAND 2: !bot-stop ---
        if (command === '!bot-stop') {
            botStatus.set(from, false);
            await sock.sendMessage(from, { text: 'Bot dimatikan. Hanya akan merespon perintah !bot-start.' });
            return;
        }

        // Jika bot dalam kondisi mati/stop, abaikan perintah lainnya
        if (!isActive) return;

        // --- COMMAND 3: !sticker (Mengirim gambar dengan caption !sticker) ---
        if (type === 'imageMessage' && command === '!sticker') {
            try {
                await sock.sendMessage(from, { text: 'Sedang membuat stiker... ⏳' });
                
                // Unduh buffer gambar dari server WhatsApp
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                
                // Resize & konversi gambar ke format WebP (stiker) memakai Sharp
                const stickerBuffer = await sharp(buffer)
                    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .toFormat('webp')
                    .toBuffer();

                // Kirim stiker ke pengguna
                await sock.sendMessage(from, { sticker: stickerBuffer });
            } catch (err) {
                console.error('Gagal membuat stiker:', err);
                await sock.sendMessage(from, { text: 'Gagal membuat stiker. Pastikan gambar valid!' });
            }
        }
    });
}

connectToWhatsApp();
