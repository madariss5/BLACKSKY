// Load environment variables first
require('dotenv').config();

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

// Configure logging first
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    }
});

// Load message handlers with proper error handling
let messageHandler;
let commandHandler;

try {
    logger.info('Loading message and command handlers...');

    // Load command handler first since message handler depends on it
    commandHandler = require('./src/handlers/commandHandler');
    if (!commandHandler || !commandHandler.processCommand) {
        throw new Error('Command handler failed to load properly');
    }
    logger.info('Command handler loaded successfully');

    // Then load message handler
    const { messageHandler: handler, init: initMessageHandler } = require('./src/handlers/messageHandler');
    messageHandler = handler;
    if (!messageHandler) {
        throw new Error('Message handler failed to load properly');
    }
    
    // Verify the init function is available
    if (typeof initMessageHandler !== 'function') {
        throw new Error('Message handler init function is not properly exported');
    }
    
    logger.info('Message handler loaded successfully');

} catch (err) {
    logger.error('Failed to load handlers:', err);
    process.exit(1);
}

// Configure options based on environment variables
const AUTH_DIR = process.env.AUTH_DIR || 'auth_info_qr';
const SESSION_DIR = path.join(__dirname, AUTH_DIR);
const PORT = parseInt(process.env.PORT || '5000', 10);

// Initialize express app
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        port: PORT,
        commandsLoaded: commandHandler.commands.size
    });
});

// Root endpoint for web interface
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>WhatsApp Bot Status</title>
            </head>
            <body>
                <h1>WhatsApp Bot Status</h1>
                <p>Status: Active</p>
                <p>Port: ${PORT}</p>
                <p>Commands Loaded: ${commandHandler.commands.size}</p>
            </body>
        </html>
    `);
});

// Connection state storage
let connectionState = {
    state: 'disconnected',
    qrCode: null,
    connected: false,
    lastError: null,
    reconnectCount: 0
};

// Retry configuration
const RETRY_CONFIG = {
    maxRetries: 5,
    baseDelay: 5000,
    maxDelay: 30000
};

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(attempt) {
    return Math.min(
        RETRY_CONFIG.maxDelay,
        RETRY_CONFIG.baseDelay * Math.pow(2, attempt)
    ) + (Math.random() * 1000);
}

/**
 * Helper function to check broadcast JIDs
 */
function isJidBroadcast(jid) {
    return jid?.endsWith('@broadcast');
}

/**
 * Initialize WhatsApp connection with retry logic
 */
async function connectToWhatsApp(retryCount = 0) {
    try {
        connectionState.state = 'connecting';
        logger.info('🟢 Starting WhatsApp authentication...');

        // Ensure session directory exists
        if (!fs.existsSync(SESSION_DIR)) {
            fs.mkdirSync(SESSION_DIR, { recursive: true });
        }

        // Initialize auth state
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        // Create WhatsApp socket connection
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' }), // Reduce noise in logs
            browser: ['𝔹𝕃𝔸ℂ𝕂𝕊𝕂𝕐-𝕄𝔻', 'Chrome', '121.0.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            markOnlineOnConnect: true,
            keepAliveIntervalMs: 30000,
            shouldIgnoreJid: jid => isJidBroadcast(jid)
        });

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            logger.info('Connection update:', update);

            if (qr) {
                connectionState.state = 'qr_ready';
                connectionState.qrCode = qr;
                logger.info('New QR code generated');
            }

            if (connection === 'connecting') {
                connectionState.state = 'connecting';
                logger.info('Connecting to WhatsApp...');
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && 
                                     retryCount < RETRY_CONFIG.maxRetries;

                connectionState.state = 'disconnected';
                connectionState.connected = false;
                connectionState.lastError = lastDisconnect?.error;

                logger.info('Connection closed:', { statusCode, shouldReconnect, retryCount });

                if (shouldReconnect) {
                    const delay = getRetryDelay(retryCount);
                    logger.info(`Reconnecting in ${delay}ms... (Attempt ${retryCount + 1}/${RETRY_CONFIG.maxRetries})`);
                    setTimeout(() => connectToWhatsApp(retryCount + 1), delay);
                } else {
                    logger.error('Connection closed permanently:', lastDisconnect?.error);
                }
            }

            if (connection === 'open') {
                logger.info('🟢 WhatsApp connection established!');
                connectionState.state = 'connected';
                connectionState.connected = true;
                connectionState.reconnectCount = 0;

                // Initialize message handlers
                logger.info('Initializing message handlers...');
                try {
                    // Initialize message handler
                    const initialized = await initMessageHandler();
                    if (!initialized) {
                        throw new Error('Message handler initialization failed');
                    }
                    logger.info('Message handler initialized successfully');

                    // Set up message event handlers
                    sock.ev.off('messages.upsert'); // Remove any existing handlers
                    sock.ev.on('messages.upsert', async ({ messages, type }) => {
                        if (type === 'notify') {
                            for (const message of messages) {
                                if (message.key.fromMe) continue;

                                try {
                                    logger.debug('Processing message:', {
                                        type: message.message ? Object.keys(message.message)[0] : null,
                                        from: message.key.remoteJid,
                                        content: message.message?.conversation || 
                                                message.message?.extendedTextMessage?.text ||
                                                message.message?.imageMessage?.caption ||
                                                message.message?.videoMessage?.caption
                                    });

                                    await messageHandler(sock, message);
                                } catch (err) {
                                    logger.error('Message handling error:', err);
                                }
                            }
                        }
                    });
                    logger.info('Message event handler registered successfully');

                } catch (err) {
                    logger.error('Failed to initialize message handlers:', err);
                    logger.error('Stack trace:', err.stack);
                }
            }
        });

        // Handle credentials update
        sock.ev.on('creds.update', saveCreds);

        return sock;
    } catch (error) {
        logger.error('Error in WhatsApp connection:', error);
        logger.error('Stack trace:', error.stack);
        throw error;
    }
}

// Start the bot
async function start() {
    try {
        logger.info('Starting 𝔹𝕃𝔸ℂ𝕂𝕊𝕂𝕐-𝕄𝔻...');

        // Create required directories
        if (!fs.existsSync(SESSION_DIR)) {
            fs.mkdirSync(SESSION_DIR, { recursive: true });
        }

        // Start HTTP server
        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info(`Server started on port ${PORT}`);

            // Initialize WhatsApp connection
            connectToWhatsApp().catch(error => {
                logger.error('Failed to initialize WhatsApp:', error);
                process.exit(1);
            });
        });

        server.on('error', (err) => {
            logger.error('Server error:', err);
            process.exit(1);
        });

    } catch (error) {
        logger.error('Failed to start application:', error);
        process.exit(1);
    }
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Rejection:', err);
    process.exit(1);
});

// Start application
start().catch((error) => {
    logger.error('Fatal error during startup:', error);
    process.exit(1);
});

module.exports = {
    connectToWhatsApp,
    start,
    isJidBroadcast
};