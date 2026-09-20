const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const sharp = require('sharp');

// Menyimpan status aktif/matinya bot tiap ruang obrolan (chat ID)
const botStatus = new Map();

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('Bot WhatsApp Berhasil Terhubung!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const type = Object.keys(msg.message)[0];
        
        // Mengambil teks dari pesan biasa atau caption gambar
        let text = '';
        if (type === 'conversation') {
            text = msg.message.conversation;
        } else if (type === 'extendedTextMessage') {
            text = msg.message.extendedTextMessage.text;
        } else if (type === 'imageMessage') {
            text = msg.message.imageMessage.caption || '';
        }

        const command = text.trim().toLowerCase();
        // Cek apakah bot dalam kondisi aktif di chat ini (default: true)
        const isActive = botStatus.get(from) ?? true;

        // --- COMMAND: !bot-start ---
        if (command === '!bot-start') {
            botStatus.set(from, true);
            const replyText = `halo! ada yang bisa saya bantu? kami di sini memiliki fitur-fitur berikut:\nhttps://0xloyz.github.io/bot/`;
            await sock.sendMessage(from, { text: replyText });
            return;
        }

        // --- COMMAND: !bot-stop ---
        if (command === '!bot-stop') {
            botStatus.set(from, false);
            await sock.sendMessage(from, { text: 'Bot dimatikan. Hanya akan merespon perintah !bot-start.' });
            return;
        }

        // Jika status bot matikan, abaikan semua perintah di bawah ini
        if (!isActive) return;

        // --- COMMAND: !sticker (Kirim Foto + Caption !sticker) ---
        if (type === 'imageMessage' && command === '!sticker') {
            try {
                await sock.sendMessage(from, { text: 'Sedang membuat stiker... ⏳' });
                
                // Unduh buffer gambar dari WhatsApp
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                
                // Konversi ke format WebP stiker (512x512) memakai Sharp
                const stickerBuffer = await sharp(buffer)
                    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .toFormat('webp')
                    .toBuffer();

                await sock.sendMessage(from, { sticker: stickerBuffer });
            } catch (err) {
                console.error('Gagal membuat stiker:', err);
                await sock.sendMessage(from, { text: 'Gagal membuat stiker. Pastikan format gambar sesuai!' });
            }
        }
    });
}

connectToWhatsApp();
