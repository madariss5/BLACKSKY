const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const logger = require('./utils/logger');
const path = require('path');
const fs = require('fs').promises;
const { messageHandler } = require('./handlers/messageHandler');

let sock = null;
let retryCount = 0;
const MAX_RETRIES = 10;
const RETRY_INTERVAL = 10000;
const AUTH_DIR = path.join(process.cwd(), 'auth_info');

async function validateSession() {
    try {
        const credentialsPath = path.join(AUTH_DIR, 'creds.json');
        const exists = await fs.access(credentialsPath)
            .then(() => true)
            .catch(() => false);

        if (!exists) return false;

        const creds = JSON.parse(await fs.readFile(credentialsPath, 'utf8'));
        return !!creds?.me?.id;
    } catch (err) {
        return false;
    }
}

async function cleanAuthState() {
    try {
        await fs.rm(AUTH_DIR, { recursive: true, force: true });
        await fs.mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
    } catch (err) {
        logger.error('Auth cleanup failed');
    }
}

async function startConnection() {
    try {
        await fs.mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });

        const { version } = await fetchLatestBaileysVersion();
        const isValidSession = await validateSession();

        if (!isValidSession && retryCount > 0) {
            await cleanAuthState();
        }

        let state, saveCreds;
        try {
            const auth = await useMultiFileAuthState(AUTH_DIR);
            state = auth.state;
            saveCreds = auth.saveCreds;
        } catch (authErr) {
            await cleanAuthState();
            const auth = await useMultiFileAuthState(AUTH_DIR);
            state = auth.state;
            saveCreds = auth.saveCreds;
        }

        sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false, // Disable default QR print
            logger: logger,
            browser: ['WhatsApp-MD', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000,
            qrTimeout: 60000,
            defaultQueryTimeoutMs: 30000,
            keepAliveIntervalMs: 15000,
            retryRequestDelayMs: 5000,
            markOnlineOnConnect: true
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.clear(); // Clear console before showing QR
                qrcode.generate(qr, { small: true });
                console.log('\nScan this QR code with WhatsApp to start the bot\n');
            }

            if (connection === 'open') {
                retryCount = 0;
                try {
                    let ownerNumber = process.env.OWNER_NUMBER;
                    if (!ownerNumber.includes('@s.whatsapp.net')) {
                        ownerNumber = ownerNumber.replace(/[^\d]/g, '');
                        if (!ownerNumber.startsWith('1') && !ownerNumber.startsWith('91')) {
                            ownerNumber = '1' + ownerNumber;
                        }
                        ownerNumber = `${ownerNumber}@s.whatsapp.net`;
                    }

                    await sock.sendMessage(ownerNumber, {
                        text: '𝔹𝕃𝔸ℂ𝕂𝕊𝕂𝕐-𝕄𝔻 Bot is now connected!'
                    });
                } catch (err) {}
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && 
                                     statusCode !== DisconnectReason.forbidden;

                if (shouldReconnect && retryCount < MAX_RETRIES) {
                    retryCount++;
                    const delay = Math.min(RETRY_INTERVAL * Math.pow(1.5, retryCount - 1), 300000);

                    if (statusCode === DisconnectReason.connectionClosed) {
                        const isValid = await validateSession();
                        if (!isValid) await cleanAuthState();
                    }

                    setTimeout(startConnection, delay);
                } else {
                    if (!shouldReconnect) {
                        console.log('\nSession expired. Please scan QR code again.\n');
                        await cleanAuthState();
                        process.exit(1);
                    } else {
                        console.log('\nConnection failed. Please restart the bot.\n');
                        process.exit(1);
                    }
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const message = messages[0];
                if (!message?.message) return;
                await messageHandler(sock, message);
            } catch (err) {
                logger.error('Message processing failed');
            }
        });

        sock.ev.on('creds.update', async () => {
            try {
                await saveCreds();
            } catch (err) {
                try {
                    await fs.writeFile(path.join(AUTH_DIR, 'creds.json'), JSON.stringify(state.creds));
                } catch (recoveryErr) {
                    await cleanAuthState();
                }
            }
        });

        const cleanup = async (signal) => {
            if (sock) {
                try {
                    await sock.logout();
                    await sock.end();
                    await cleanAuthState();
                } catch (err) {}
            }
            process.exit(0);
        };

        process.on('SIGTERM', () => cleanup('SIGTERM'));
        process.on('SIGINT', () => cleanup('SIGINT'));
        process.on('uncaughtException', (err) => cleanup('UNCAUGHT_EXCEPTION'));

        return sock;
    } catch (err) {
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            const delay = Math.min(RETRY_INTERVAL * Math.pow(1.5, retryCount - 1), 300000);
            setTimeout(startConnection, delay);
        } else {
            throw err;
        }
    }
}

module.exports = { startConnection };