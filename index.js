const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const config = require('./config');
const helpCommand = require('./helpCommand');

// ===== تخزين مؤقت =====
const pendingJoins = new Map();
const userWarnings = new Map();

// ===== القناة =====
const NEWSLETTER_JID = config.NEWSLETTER_JID || '120363427092431731@newsletter';
const NEWSLETTER_NAME = 'Speaking in English';

// ===== البحث عن ملف =====
function findFile(filename) {
    const paths = [
        path.join(__dirname, filename),
        path.join(__dirname, 'session', filename),
        path.join(__dirname, 'auth_info_baileys', filename),
        path.join(__dirname, 'backgrounds', filename),
        path.join(__dirname, 'images', filename)
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// ===== الإعدادات =====
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

let settings = {
    welcomeEnabled: true,
    protectionEnabled: true,
    warningsToKick: 3
};

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            settings = { ...settings, ...JSON.parse(data) };
            console.log('✅ Settings loaded:', settings);
        }
    } catch (err) {
        console.error('Error loading settings:', err);
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        console.log('💾 Settings saved');
    } catch (err) {
        console.error('Error saving settings:', err);
    }
}

loadSettings();

// ===== التحقق من الرقم المغربي =====
function isMoroccanNumber(jid) {
    const phone = jid.split('@')[0].split(':')[0];
    if (jid.includes('@lid')) return true;
    return phone.startsWith(config.MOROCCO_PREFIX) && phone.length === 12;
}

// ===== استخراج المنشن =====
function getMentionedJid(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || null;
}

// ===== التحقق واش مشرف =====
async function isAdmin(sock, groupJid, participant) {
    try {
        const metadata = await sock.groupMetadata(groupJid);
        const p = metadata.participants.find(x => x.id === participant);
        return p?.admin === 'admin' || p?.admin === 'superadmin';
    } catch {
        return false;
    }
}

// ===== تحويل النص إلى كتابة مزخرفة =====
function toFancyText(text) {
    const normal = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const fancyUpper = '𝑨𝑩𝑪𝑫𝑬𝑭𝑮𝑯𝑰𝑱𝑲𝑳𝑴𝑵𝑶𝑷𝑸𝑹𝑺𝑻𝑼𝑽𝑾𝑿𝒀𝒁';
    const fancyLower = '𝒂𝒃𝒄𝒅𝒆𝒇𝒈𝒉𝒊𝒋𝒌𝒍𝒎𝒏𝒐𝒑𝒒𝒓𝒔𝒕𝒖𝒗𝒘𝒙𝒚𝒛';

    let result = '';
    for (const char of text) {
        const idx = normal.indexOf(char);
        if (idx !== -1 && idx < 26) {
            result += fancyUpper[idx];
        } else if (idx >= 26) {
            result += fancyLower[idx - 26];
        } else {
            result += char;
        }
    }
    return result;
}

// ===== صورة الترحيب =====
async function generateWelcomeImage(profilePicUrl, memberName) {
    try {
        const width = 800;
        const height = 420;

        const bgPath = findFile('welcome5.png');
        let backgroundImage;
        if (bgPath) {
            console.log('🖼️ Using background: welcome5.png');
            backgroundImage = await sharp(bgPath).resize(width, height, { fit: 'cover' }).toBuffer();
        } else {
            backgroundImage = await sharp({
                create: { width, height, channels: 4, background: { r: 26, g: 26, b: 46, alpha: 1 } }
            }).png().toBuffer();
        }

        let avatarBuffer = null;
        if (profilePicUrl) {
            try {
                const res = await fetch(profilePicUrl);
                avatarBuffer = Buffer.from(await res.arrayBuffer());
                console.log('👤 Using member profile picture');
            } catch {
                console.log('⚠️ Failed to load profile picture');
            }
        }

        if (!avatarBuffer) {
            const zoroPath = findFile('zoro.png');
            if (zoroPath) {
                console.log('🗡️ Using zoro.png as fallback');
                avatarBuffer = await sharp(zoroPath).resize(200, 200, { fit: 'cover' }).toBuffer();
            } else {
                avatarBuffer = await sharp({
                    create: { width: 200, height: 200, channels: 4, background: { r: 100, g: 100, b: 100, alpha: 1 } }
                }).png().toBuffer();
            }
        }

        const circleSvg = Buffer.from(
            `<svg width="200" height="200"><circle cx="100" cy="100" r="100" fill="white"/></svg>`
        );
        const circularAvatar = await sharp(avatarBuffer)
            .resize(200, 200)
            .composite([{ input: circleSvg, blend: 'dest-in' }])
            .png()
            .toBuffer();

        const fancyName = toFancyText(memberName || 'New Member');
        const svgText = `
            <svg width="${width}" height="${height}">
                <text x="50%" y="90"
                    text-anchor="middle"
                    fill="#FFFFFF"
                    font-size="48"
                    font-family="Arial, sans-serif"
                    font-weight="bold">
                    ${fancyName}
                </text>
            </svg>
        `;

        const finalImage = await sharp(backgroundImage)
            .resize(width, height)
            .composite([
                { input: Buffer.from(svgText), top: 0, left: 0 },
                { input: circularAvatar, top: 150, left: 60 }
            ])
            .jpeg({ quality: 92 })
            .toBuffer();

        return finalImage;
    } catch (err) {
        console.error('Error generating welcome image:', err);
        return null;
    }
}

// ===== إرسال تحذير =====
async function sendWarning(sock, participant, count) {
    const msg =
        `⚠️ *WARNING* ⚠️\n\n` +
        `> Dear member, sending WhatsApp links is not allowed in this group.\n\n` +
        `*Warning number:* ${count} of ${settings.warningsToKick}\n\n` +
        `> If you reach the limit, you will be removed from the group.`;
    await sock.sendMessage(config.GROUP_JID, { text: msg, mentions: [participant] });
}

// ===== إرسال معلومات المطور =====
async function sendDeveloperInfo(sock, chatId, message) {
    try {
        // ===== نص معلومات المطور =====
        const devText =
            `🎃 *Name:* Jawad\n\n` +
            `👤 *Surname:* Darkxecutor\n\n` +
            `🖇️ *Bot repository link:*\nhttps://github.com/darkxecutor/Bot-group.git\n\n` +
            `🕸️ *YouTube:*\nhttps://www.youtube.com/@jawad_darkxecutor`;

        // ===== contextInfo من القناة =====
        const contextInfo = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: NEWSLETTER_JID,
                newsletterName: NEWSLETTER_NAME,
                serverMessageId: -1
            }
        };

        // ===== 1. إرسال صورة zoro.png مع النص =====
        const zoroPath = findFile('zoro.png');
        if (zoroPath) {
            const zoroBuffer = fs.readFileSync(zoroPath);
            await sock.sendMessage(chatId, {
                image: zoroBuffer,
                caption: devText,
                contextInfo: contextInfo
            }, { quoted: message });
            console.log('✅ Developer info sent with zoro.png');
        } else {
            // إلا ما كانش zoro.png → نص فقط
            await sock.sendMessage(chatId, {
                text: devText,
                contextInfo: contextInfo
            }, { quoted: message });
            console.log('⚠️ zoro.png not found — sent text only');
        }

        // ===== 2. إرسال جهة اتصال المطور =====
        await sock.sendMessage(chatId, {
            contacts: {
                displayName: 'Jawad (Developer)',
                contacts: [
                    {
                        vcard: `BEGIN:VCARD
VERSION:3.0
FN:Jawad (Developer)
N:Jawad;Darkxecutor;;;
TEL;type=CELL;type=VOICE;waid=212675894174:+212 675-894174
END:VCARD`
                    }
                ]
            },
            contextInfo: contextInfo
        }, { quoted: message });
        console.log('✅ Developer contact sent');

        // ===== 3. Reaction =====
        try {
            await sock.sendMessage(chatId, {
                react: {
                    text: '👨🏼‍💻',
                    key: message.key
                }
            });
        } catch (e) {
            console.log('⚠️ Could not react:', e.message);
        }

    } catch (error) {
        console.error('❌ Developer command error:', error);
    }
}

// ===== قائمة الأوامر المعروفة =====
const KNOWN_COMMANDS = [
    'طرد', 'تحذير', 'تحذيرات', 'ترحيب', 'تفعيل الترحيب', 'تعطيل الترحيب',
    'تفعيل الحماية', 'تعطيل الحماية', 'مسح التحذيرات', 'قائمة التحذيرات',
    'reset', 'الحالة', 'حالة', 'مساعدة', 'help', 'id', 'jid', 'ping', 'warnings',
    'testwelcome', 'status', 'بوت', 'أوامر', 'اوامر', 'menu', 'قائمة', 'bot',
    'developer'
];

// ===== نص الترحيب =====
function buildWelcomeText(phoneNumber) {
    return (
        `*👋🏻𝓦𝓮𝓵𝓬𝓸𝓶𝓮 𝓽𝓸 𝓽𝓱𝓮 𝓰𝓻𝓸𝓾𝓹!*\n` +
        `*@${phoneNumber} ∼. 𝒴𝑜𝓊 𝓁𝒾𝑔𝒽𝓉 𝓊𝓅 𝑜𝓊𝓇 𝒹𝒶𝓎🌿*\n\n` +
        `> This group is dedicated to speaking English only, aiming to improve pronunciation and communication skills.`
    );
}

// ===== إرسال الترحيب =====
async function sendWelcome(sock, participant, img) {
    const phoneNumber = participant.split('@')[0];
    const welcomeText = buildWelcomeText(phoneNumber);

    const contextInfo = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: NEWSLETTER_JID,
            newsletterName: NEWSLETTER_NAME,
            serverMessageId: -1
        }
    };

    try {
        if (img) {
            await sock.sendMessage(config.GROUP_JID, {
                image: img,
                caption: welcomeText,
                mentions: [participant],
                contextInfo: contextInfo
            });
        } else {
            await sock.sendMessage(config.GROUP_JID, {
                text: welcomeText,
                mentions: [participant],
                contextInfo: contextInfo
            });
        }
        console.log('✅ Welcome message sent (from newsletter)');
    } catch (err) {
        console.error('❌ Failed to send welcome:', err.message);
    }
}

// ===== تشغيل البوت =====
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: P({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        generateHighQualityLinkPreview: true
    });

    sock.ev.on('creds.update', saveCreds);

    // ===== الاتصال =====
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📱 Scan QR code:');
            qrcode.generate(qr, { small: true });
            const qrPath = path.join(__dirname, 'qr.png');
            QRCode.toFile(qrPath, qr, { width: 500, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } }, (err) => {
                if (err) console.error('Error saving QR:', err);
                else console.log('✅ QR saved to:', qrPath);
            });
        }

        if (connection === 'close') {
            const code = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;
            console.log('❌ Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Connected successfully!');
            console.log('📌 Group ID:', config.GROUP_JID);
            console.log('📢 Newsletter:', NEWSLETTER_JID);
            console.log('⚙️ Settings:', settings);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🎯 Bot is ready!');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }
    });

    // ===== طلبات الانضمام =====
    sock.ev.on('group.join.request', async (req) => {
        const { jid, participant } = req;
        if (jid !== config.GROUP_JID) return;

        if (isMoroccanNumber(participant)) {
            console.log(`✅ Accepted number: ${participant}. Approving in 2 minutes...`);
            pendingJoins.set(participant, Date.now());
            setTimeout(async () => {
                try {
                    if (pendingJoins.has(participant)) {
                        await sock.groupRequestParticipantsUpdate(jid, [participant], 'approve');
                        console.log(`✅ Approved ${participant}`);
                        pendingJoins.delete(participant);
                    }
                } catch (e) {
                    console.error('Error approving:', e);
                }
            }, config.WELCOME_DELAY_MS);
        } else {
            console.log(`❌ Rejected number: ${participant}`);
        }
    });

    // ===== انضمام أعضاء جدد =====
    sock.ev.on('group-participants.update', async (update) => {
        if (update.id !== config.GROUP_JID || !settings.welcomeEnabled) return;
        for (const participant of update.participants) {
            if (update.action === 'add' && participant !== sock.user.id) {
                try {
                    let profilePicUrl = null;
                    try {
                        profilePicUrl = await sock.profilePictureUrl(participant, 'image');
                    } catch {}

                    let memberName = 'New Member';
                    try {
                        const metadata = await sock.groupMetadata(config.GROUP_JID);
                        const info = metadata.participants.find(p => p.id === participant);
                        memberName = info?.notify || participant.split('@')[0];
                    } catch {}

                    const img = await generateWelcomeImage(profilePicUrl, memberName);
                    await sendWelcome(sock, participant, img);
                    console.log(`✅ Welcomed ${memberName}`);
                } catch (e) {
                    console.error('Error in welcome:', e);
                }
            }
        }
    });

    // ===== معالجة الرسائل =====
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || !msg.key.remoteJid) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');

        const text = (msg.message.conversation
            || msg.message.extendedTextMessage?.text
            || msg.message.imageMessage?.caption
            || '').trim();

        const firstWord = text.split(/\s+/)[0];
        const isCommand = KNOWN_COMMANDS.some(c => text === c || firstWord === c);

        if (isCommand) {
            const cmdLower = text.toLowerCase();
            const admin = await isAdmin(sock, from, sender);

            // ===== أوامر القائمة =====
            if (cmdLower === 'بوت' || cmdLower === 'أوامر' || cmdLower === 'اوامر'
                || cmdLower === 'menu' || cmdLower === 'قائمة'
                || cmdLower === 'help' || cmdLower === 'مساعدة'
                || cmdLower === 'bot') {
                await helpCommand(sock, from, msg);
                return;
            }

            // ===== Developer =====
            if (cmdLower === 'developer') {
                await sendDeveloperInfo(sock, from, msg);
                return;
            }

            // --- خاص ---
            if (!isGroup) {
                if (cmdLower === 'ping') { await sock.sendMessage(from, { text: '🏓 Pong!' }); return; }
                if (cmdLower === 'id' || cmdLower === 'jid') {
                    await sock.sendMessage(from, { text: `📌 Chat ID:\n\`${from}\`` });
                    return;
                }
                return;
            }

            // --- أوامر عامة ---
            if (cmdLower === 'id' || cmdLower === 'jid') {
                await sock.sendMessage(from, { text: `📌 Group ID:\n\`${from}\`` });
                return;
            }

            if (cmdLower === 'ping') {
                await sock.sendMessage(from, { text: '🏓 Pong!' });
                return;
            }

            if (cmdLower === 'warnings' || cmdLower === 'تحذيرات') {
                const w = userWarnings.get(sender) || 0;
                await sock.sendMessage(from, {
                    text: `⚠️ Your warnings: *${w}* / *${settings.warningsToKick}*`,
                    mentions: [sender]
                });
                return;
            }

            if (cmdLower === 'الحالة' || cmdLower === 'حالة' || cmdLower === 'status') {
                const statusText =
                    `📊 *Bot Status*\n\n` +
                    `🎉 Welcome: ${settings.welcomeEnabled ? '✅ ON' : '❌ OFF'}\n` +
                    `🛡️ Link Protection: ${settings.protectionEnabled ? '✅ ON' : '❌ OFF'}\n` +
                    `⚠️ Warnings Before Kick: *${settings.warningsToKick}*\n` +
                    `👥 Warned Members: *${userWarnings.size}*`;
                await sock.sendMessage(from, { text: statusText });
                return;
            }

            // --- اختبار الترحيب ---
            if (cmdLower === 'testwelcome') {
                try {
                    let testPicUrl = null;
                    try {
                        testPicUrl = await sock.profilePictureUrl(sender, 'image');
                    } catch {}

                    let memberName = 'New Member';
                    try {
                        const metadata = await sock.groupMetadata(from);
                        const info = metadata.participants.find(p => p.id === sender);
                        memberName = info?.notify || sender.split('@')[0];
                    } catch {}

                    const img = await generateWelcomeImage(testPicUrl, memberName);
                    if (img) {
                        const testText = buildWelcomeText(sender.split('@')[0]);
                        await sock.sendMessage(from, {
                            image: img,
                            caption: testText,
                            mentions: [sender],
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: NEWSLETTER_JID,
                                    newsletterName: NEWSLETTER_NAME,
                                    serverMessageId: -1
                                }
                            }
                        });
                        console.log('✅ Test welcome sent');
                    } else {
                        await sock.sendMessage(from, { text: '❌ Failed to generate image' });
                    }
                } catch (e) {
                    console.error('Error in test welcome:', e);
                }
                return;
            }

            // --- مشرف فقط ---
            if (!admin) {
                await sock.sendMessage(from, {
                    text: '❌ This command is for admins only.',
                    mentions: [sender]
                });
                return;
            }

            if (cmdLower === 'ترحيب') {
                settings.welcomeEnabled = !settings.welcomeEnabled;
                saveSettings();
                await sock.sendMessage(from, {
                    text: settings.welcomeEnabled ? '✅ Welcome feature enabled' : '❌ Welcome feature disabled'
                });
                return;
            }

            if (cmdLower === 'تفعيل الترحيب') {
                settings.welcomeEnabled = true;
                saveSettings();
                await sock.sendMessage(from, { text: '✅ Welcome feature enabled' });
                return;
            }

            if (cmdLower === 'تعطيل الترحيب') {
                settings.welcomeEnabled = false;
                saveSettings();
                await sock.sendMessage(from, { text: '❌ Welcome feature disabled' });
                return;
            }

            if (cmdLower === 'تفعيل الحماية') {
                settings.protectionEnabled = true;
                saveSettings();
                await sock.sendMessage(from, { text: '✅ Link protection enabled' });
                return;
            }

            if (cmdLower === 'تعطيل الحماية') {
                settings.protectionEnabled = false;
                saveSettings();
                await sock.sendMessage(from, { text: '❌ Link protection disabled' });
                return;
            }

            if (cmdLower.startsWith('تحذير')) {
                const target = getMentionedJid(msg);
                if (!target) {
                    await sock.sendMessage(from, { text: '⚠️ You must mention a member: warn @member' });
                    return;
                }
                const count = (userWarnings.get(target) || 0) + 1;
                userWarnings.set(target, count);
                await sendWarning(sock, target, count);
                if (count >= settings.warningsToKick) {
                    try {
                        await sock.groupParticipantsUpdate(from, [target], 'remove');
                        await sock.sendMessage(from, {
                            text: `🚫 Member @${target.split('@')[0]} removed after exceeding ${settings.warningsToKick} warnings.`,
                            mentions: [target]
                        });
                        userWarnings.delete(target);
                    } catch (e) {
                        console.error('Error removing member:', e);
                    }
                }
                return;
            }

            if (cmdLower.startsWith('طرد')) {
                const target = getMentionedJid(msg);
                if (!target) {
                    await sock.sendMessage(from, { text: '⚠️ You must mention a member: kick @member' });
                    return;
                }
                try {
                    await sock.groupParticipantsUpdate(from, [target], 'remove');
                    await sock.sendMessage(from, {
                        text: `🚫 Member @${target.split('@')[0]} has been kicked from the group.`,
                        mentions: [target]
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Could not kick the member.' });
                }
                return;
            }

            if (cmdLower.startsWith('مسح التحذيرات')) {
                const target = getMentionedJid(msg);
                if (!target) {
                    await sock.sendMessage(from, { text: '⚠️ You must mention a member: clear warnings @member' });
                    return;
                }
                userWarnings.delete(target);
                await sock.sendMessage(from, {
                    text: `✅ Warnings cleared for @${target.split('@')[0]}`,
                    mentions: [target]
                });
                return;
            }

            if (cmdLower === 'قائمة التحذيرات') {
                if (userWarnings.size === 0) {
                    await sock.sendMessage(from, { text: '✅ No warned members.' });
                    return;
                }
                let list = '⚠️ *Warned members list:*\n\n';
                let i = 1;
                const mentions = [];
                for (const [jid, count] of userWarnings.entries()) {
                    list += `${i}. @${jid.split('@')[0]} — *${count}* warning(s)\n`;
                    mentions.push(jid);
                    i++;
                }
                await sock.sendMessage(from, { text: list, mentions });
                return;
            }

            if (cmdLower === 'reset') {
                userWarnings.clear();
                await sock.sendMessage(from, { text: '✅ All warnings have been reset.' });
                return;
            }

            return;
        }

        // ===== حماية الروابط =====
        if (!settings.protectionEnabled || !isGroup || from !== config.GROUP_JID) return;

        const hasWhatsAppLink = /chat\.whatsapp\.com|wa\.me\/|whatsapp\.com\/channel/i.test(text);
        if (hasWhatsAppLink) {
            console.log(`🚫 WhatsApp link from ${sender}`);
            try {
                await sock.sendMessage(from, { delete: msg.key });
                console.log('🗑️ Message deleted');
            } catch (e) {
                console.error('Error deleting:', e);
            }

            const count = (userWarnings.get(sender) || 0) + 1;
            userWarnings.set(sender, count);
            await sendWarning(sock, sender, count);

            if (count >= settings.warningsToKick) {
                try {
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    await sock.sendMessage(from, {
                        text: `🚫 Member @${sender.split('@')[0]} removed after exceeding ${settings.warningsToKick} warnings.`,
                        mentions: [sender]
                    });
                    userWarnings.delete(sender);
                } catch (e) {
                    console.error('Error removing:', e);
                }
            }
        }
    });
}

startBot().catch(console.error);
