const fs = require('fs');
const path = require('path');

// ===== مسارات الصور المتاحة =====
const imagePaths = [
    path.join(__dirname, 'help.png'),
    path.join(__dirname, 'assets', 'help.png'),
    path.join(__dirname, 'assets', 'help1.png'),
    path.join(__dirname, 'assets', 'help2.png'),
    path.join(__dirname, 'assets', 'help3.png'),
    path.join(__dirname, 'assets', 'help4.png')
];

// ===== الأسماء المستعارة للأمر =====
const ALIASES = [
    'help', 'menu', 'قائمة', 'اوامر', 'أوامر', 'بوت', 'bot', 'مساعدة'
];

// ===== قناة التوجيه =====
const NEWSLETTER_JID = '120363427092431731@newsletter';
const NEWSLETTER_NAME = 'Speaking in English';

async function helpCommand(sock, chatId, message) {
    // ===== استخراج النص =====
    let messageText = '';
    if (message?.message?.conversation) {
        messageText = message.message.conversation;
    } else if (message?.message?.extendedTextMessage?.text) {
        messageText = message.message.extendedTextMessage.text;
    } else if (message?.message?.imageMessage?.caption) {
        messageText = message.message.imageMessage.caption;
    } else if (message?.message?.videoMessage?.caption) {
        messageText = message.message.videoMessage.caption;
    }

    // ===== استخراج الأمر =====
    const command = messageText.trim().split(/\s+/)[0].toLowerCase();
    const isHelpCommand = ALIASES.some(alias => command === alias);

    if (!isHelpCommand) return false;

    // ===== نص القائمة =====
    const helpMessage =
        `*Bot group*🎃\n` +
        `*ـــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ*\n` +
        `*🌝 Public Commands:*\n\n` +
        `*• id —> Group ID*\n\n` +
        `*• ping —> Test bot*\n\n` +
        `*• warnings —> Your warning count*\n\n` +
        `*• status —> Bot status*\n\n` +
        `*• help —> This menu*\n\n` +
        `*• Developer —> info*\n\n` +
        `*ـــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ*\n` +
        `*🛡️ Admin Commands:*\n\n` +
        `*• welcome —> Toggle welcome*\n\n` +
        `*• warn @member —> Warn*\n\n` +
        `*• kick @member —> Kick*\n\n` +
        `*• warnings list —> List*\n\n` +
        `*• clear warnings —> Reset*\n\n` +
        `*• testwelcome —> Test*\n\n` +
        `*• reset —> Reset all*\n` +
        `*ـــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ*`;

    try {
        // ===== اختيار صورة عشوائية =====
        const availableImages = imagePaths.filter(imgPath => fs.existsSync(imgPath));

        // ===== contextInfo للقناة =====
        const contextInfo = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: NEWSLETTER_JID,
                newsletterName: NEWSLETTER_NAME,
                serverMessageId: -1
            }
        };

        if (availableImages.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableImages.length);
            const selectedImage = availableImages[randomIndex];
            const imageBuffer = fs.readFileSync(selectedImage);
            console.log('📸 Help image:', path.basename(selectedImage));

            await sock.sendMessage(chatId, {
                image: imageBuffer,
                caption: helpMessage,
                contextInfo: contextInfo
            }, { quoted: message });
        } else {
            console.log('⚠️ No help images found — sending text only');
            await sock.sendMessage(chatId, {
                text: helpMessage,
                contextInfo: contextInfo
            }, { quoted: message });
        }

        // ===== تفاعل بإيموجي =====
        try {
            await sock.sendMessage(chatId, {
                react: {
                    text: '👊🏻',
                    key: message.key
                }
            });
        } catch (e) {
            console.log('⚠️ Could not react:', e.message);
        }

        return true;
    } catch (error) {
        console.error('❌ Help command error:', error);
        try {
            await sock.sendMessage(chatId, { text: helpMessage }, { quoted: message });
        } catch (e) {
            console.error('❌ Fallback failed:', e.message);
        }
        return true;
    }
}

module.exports = helpCommand;