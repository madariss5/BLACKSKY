const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const pino = require('pino');
const logger = require('./utils/logger');
const express = require('express');
const http = require('http');
const app = express();
const server = http.createServer(app);

// Connection state management
let sock = null;
let retryCount = 0;
const MAX_RETRIES = 5;
const INITIAL_RETRY_INTERVAL = 10000;
const MAX_RETRY_INTERVAL = 300000;
let currentRetryInterval = INITIAL_RETRY_INTERVAL;
let qrPort = 5006;
let isConnecting = false;
let connectionLock = false;
let sessionInvalidated = false;
let reconnectTimer = null;
let latestQR = null;

// Set up Express server for QR code display
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>WhatsApp QR Code</title>
                <meta http-equiv="refresh" content="30">
                <style>
                    body { 
                        display: flex; 
                        flex-direction: column;
                        align-items: center; 
                        justify-content: center; 
                        height: 100vh; 
                        margin: 0;
                        font-family: Arial, sans-serif;
                        background: #f0f2f5;
                    }
                    #qrcode {
                        padding: 20px;
                        background: white;
                        border-radius: 10px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    }
                    h2 { color: #333; margin-bottom: 20px; }
                    .status { margin-top: 20px; color: #666; }
                    .reconnecting { color: #e67e22; }
                    .error { color: #e74c3c; }
                </style>
            </head>
            <body>
                <h2>Scan QR Code with WhatsApp</h2>
                <div id="qrcode">
                    ${sessionInvalidated ? 'Reconnecting...' : (latestQR ? `<img src="${latestQR}" alt="QR Code"/>` : 'Waiting for QR Code...')}
                </div>
                <p class="status" id="statusMessage">Please scan the QR code with WhatsApp to connect</p>
            </body>
        </html>
    `);
});

async function cleanupSession() {
    try {
        logger.info('Starting complete session cleanup...');

        // Files to clean
        const filesToClean = [
            'auth_info_multi.json',
            'auth_info_baileys.json',
            'auth_info.json',
            'auth_info_qr.json',
            'session.json',
            'creds.json'
        ];

        // Directories to clean
        const authDirs = [
            'auth_info',
            'auth_info_baileys',
            'auth_info_multi',
            'session',
            '.session'
        ].map(dir => path.join(process.cwd(), dir));

        // Clean files
        for (const file of filesToClean) {
            try {
                if (fs.existsSync(file)) {
                    await fsPromises.unlink(file);
                    logger.info(`Removed session file: ${file}`);
                }
            } catch (err) {
                logger.error(`Error removing file ${file}:`, err);
            }
        }

        // Clean directories
        for (const dir of authDirs) {
            try {
                if (fs.existsSync(dir)) {
                    await fsPromises.rm(dir, { recursive: true, force: true });
                    logger.info(`Removed directory: ${dir}`);
                }
            } catch (err) {
                logger.error(`Error removing directory ${dir}:`, err);
            }
        }

        sessionInvalidated = true;
        logger.info('Session cleanup completed successfully');
    } catch (err) {
        logger.error('Error during session cleanup:', err);
        throw err;
    }
}

async function ensureAuthDir() {
    const authDir = path.join(process.cwd(), 'auth_info');
    try {
        await fsPromises.mkdir(authDir, { recursive: true });
        return authDir;
    } catch (err) {
        logger.error('Failed to create auth directory:', err);
        throw err;
    }
}

async function displayQR(qr) {
    try {
        latestQR = await qrcode.toDataURL(qr);
        logger.info(`QR Code ready at http://localhost:${qrPort}`);
    } catch (err) {
        logger.error('QR code generation failed:', err);
        throw err;
    }
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

async function startConnection() {
    if (isConnecting || connectionLock) {
        logger.info('Connection attempt already in progress, skipping...');
        return null;
    }

    try {
        isConnecting = true;
        connectionLock = true;

        // Start QR server if not already running
        if (!server.listening) {
            server.listen(qrPort, '0.0.0.0', () => {
                logger.info(`QR server listening on port ${qrPort}`);
            });
        }

        // Clear any existing session before starting
        await cleanupSession();

        const authDir = await ensureAuthDir();
        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        // Create socket with enhanced settings to prevent conflicts
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            // Use a unique browser ID for each connection to prevent conflicts
            browser: ['BLACKSKY-MD', 'Chrome', '121.0.0.' + Date.now()],
            // Enhanced connection settings to reduce reconnections
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            emitOwnEvents: false,
            retryRequestDelayMs: 5000,
            fireInitQueries: true,
            downloadHistory: false,
            syncFullHistory: false,
            shouldSyncHistoryMessage: false,
            markOnlineOnConnect: false,
            version: [2, 2323, 4],
            transactionOpts: { 
                maxCommitRetries: 10, 
                delayBetweenTriesMs: 5000 
            },
            // Custom options to reduce conflicts
            fireAndForget: true, // Don't wait for server ack
            patchMessageBeforeSending: (message) => {
                // Add timestamp to make messages unique
                const now = new Date();
                message.messageTimestamp = now / 1000;
                return message;
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                await displayQR(qr);
            }

            if (connection === 'open') {
                logger.info('Connection established successfully');
                retryCount = 0;
                currentRetryInterval = INITIAL_RETRY_INTERVAL;
                sessionInvalidated = false;
                clearReconnectTimer();
                await saveCreds();

                // Initialize message handling after successful connection
                sock.ev.on('messages.upsert', async ({ messages, type }) => {
                    if (type === 'notify') {
                        for (const message of messages) {
                            try {
                                await messageHandler(sock, message);
                                logger.info('Message handled successfully');
                            } catch (err) {
                                logger.error('Error handling message:', err);
                            }
                        }
                    }
                });

                isConnecting = false;
                connectionLock = false;
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                logger.info(`Connection closed with status code: ${statusCode}`);

                // Handle critical errors
                if (statusCode === DisconnectReason.loggedOut || 
                    statusCode === DisconnectReason.connectionReplaced ||
                    statusCode === DisconnectReason.connectionClosed ||
                    statusCode === DisconnectReason.connectionLost ||
                    statusCode === DisconnectReason.timedOut ||
                    statusCode === 440) {

                    logger.info('Critical connection error detected');
                    await cleanupSession();

                    // Force restart on critical errors
                    logger.info('Restarting process after critical error...');
                    process.exit(1);
                    return;
                }

                if (retryCount >= MAX_RETRIES) {
                    logger.error('Max retries reached, clearing session and restarting...');
                    await cleanupSession();
                    process.exit(1);
                    return;
                }

                // Implement exponential backoff
                retryCount++;
                currentRetryInterval = Math.min(
                    currentRetryInterval * 2,
                    MAX_RETRY_INTERVAL
                );

                logger.info(`Scheduling reconnection attempt ${retryCount}/${MAX_RETRIES} in ${currentRetryInterval}ms`);

                clearReconnectTimer();
                reconnectTimer = setTimeout(async () => {
                    try {
                        // First, completely clear any session data
                        await cleanupSession();
                        
                        // Make sure we reset flags before reconnecting
                        isConnecting = false;
                        connectionLock = false;
                        
                        // Create some delay to ensure WhatsApp servers register the disconnect
                        logger.info('Cleared session, waiting 5 seconds before reconnecting...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        
                        // Attempt reconnection with fresh session
                        logger.info('Starting fresh connection after cleanup...');
                        await startConnection();
                    } catch (err) {
                        logger.error('Reconnection attempt failed:', err);
                        if (retryCount >= MAX_RETRIES) {
                            await cleanupSession();
                            process.exit(1);
                        }
                    }
                }, currentRetryInterval);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Add message receipt acknowledgment
        sock.ev.on('messages.update', async (messages) => {
            for (const message of messages) {
                if (message.key && message.key.remoteJid) {
                    try {
                        await sock.readMessages([message.key]);
                        logger.debug('Message marked as read');
                    } catch (err) {
                        logger.error('Error marking message as read:', err);
                    }
                }
            }
        });

        // Handle chat updates
        sock.ev.on('chats.update', async (chats) => {
            for (const chat of chats) {
                if (chat.unreadCount > 0) {
                    try {
                        await sock.readMessages([{
                            remoteJid: chat.id,
                            id: chat.conversationTimestamp.toString()
                        }]);
                        logger.debug('Chat marked as read');
                    } catch (err) {
                        logger.error('Error marking chat as read:', err);
                    }
                }
            }
        });


        return sock;
    } catch (err) {
        logger.error('Fatal error in startConnection:', err);

        if (retryCount < MAX_RETRIES) {
            retryCount++;
            currentRetryInterval = Math.min(
                currentRetryInterval * 2,
                MAX_RETRY_INTERVAL
            );

            logger.info(`Retrying connection in ${currentRetryInterval}ms`);
            clearReconnectTimer();
            reconnectTimer = setTimeout(async () => {
                try {
                    // First, completely clear any session data
                    await cleanupSession();
                    
                    // Make sure we reset flags before reconnecting
                    isConnecting = false;
                    connectionLock = false;
                    
                    // Create some delay to ensure WhatsApp servers register the disconnect
                    logger.info('Cleared session, waiting 5 seconds before reconnecting...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    // Attempt reconnection with fresh session
                    logger.info('Starting fresh connection after cleanup...');
                    await startConnection();
                } catch (retryErr) {
                    logger.error('Retry failed:', retryErr);
                    if (retryCount >= MAX_RETRIES) {
                        await cleanupSession();
                        process.exit(1);
                    }
                }
            }, currentRetryInterval);
        } else {
            await cleanupSession();
            process.exit(1);
        }
    } finally {
        isConnecting = false;
        connectionLock = false;
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, cleaning up...');
    clearReconnectTimer();
    try {
        if (sock) {
            await sock.logout();
            await cleanupSession();
        }
    } catch (err) {
        logger.error('Cleanup error:', err);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, cleaning up...');
    clearReconnectTimer();
    try {
        if (sock) {
            await sock.logout();
            await cleanupSession();
        }
    } catch (err) {
        logger.error('Cleanup error:', err);
    }
    process.exit(0);
});

module.exports = { startConnection };