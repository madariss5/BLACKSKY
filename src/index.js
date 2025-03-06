const express = require('express');
const { startConnection } = require('./connection');
const { messageHandler } = require('./handlers/messageHandler');
const { commandLoader } = require('./utils/commandLoader');
const { languageManager } = require('./utils/language');
const logger = require('./utils/logger');
const config = require('./config/config');
const { DisconnectReason } = require('@whiskeysockets/baileys');

async function findAvailablePort(startPort, maxAttempts = 10) {
    const net = require('net');

    function isPortAvailable(port) {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close(() => resolve(true));
            });
            server.listen(port, '0.0.0.0');
        });
    }

    for (let port = startPort; port < startPort + maxAttempts; port++) {
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    throw new Error(`No available ports found between ${startPort} and ${startPort + maxAttempts - 1}`);
}

async function startBot() {
    let server = null;

    try {
        logger.info('Starting WhatsApp Bot...');

        // Check required environment variables
        const { isValid, missingVars } = config.validateConfig();
        if (!isValid) {
            logger.warn(`Missing required environment variables: ${missingVars.join(', ')}`);
            logger.info('Bot will start but some features may be limited until variables are set');
        }

        // Load translations first
        logger.info('Loading translations...');
        await languageManager.loadTranslations();
        logger.info('Translations loaded successfully');

        // Load commands
        logger.info('Loading command configurations...');
        await commandLoader.loadCommandConfigs();
        await commandLoader.loadCommandHandlers();
        logger.info(`Loaded ${commandLoader.getAllCommands().length} commands successfully`);

        // Start WhatsApp connection
        logger.info('Initializing WhatsApp connection...');
        const sock = await startConnection().catch(err => {
            logger.error('Failed to establish WhatsApp connection:', err);
            throw err;
        });
        logger.info('WhatsApp connection initialized');

        // Setup Express server
        const app = express();
        app.use(express.json());

        // Health check endpoint
        app.get('/', (req, res) => {
            res.json({
                status: 'running',
                message: languageManager.getText('system.bot_active'),
                commands: commandLoader.getAllCommands().length,
                language: config.bot.language,
                uptime: process.uptime(),
                missingConfig: missingVars
            });
        });

        // Find available port starting from 5000
        const PORT = await findAvailablePort(5000);

        // Create server with proper error handling
        server = app.listen(PORT, '0.0.0.0')
            .on('error', (err) => {
                logger.error('Failed to start HTTP server:', err);
                process.exit(1);
            })
            .on('listening', () => {
                logger.info(`Server is running on http://0.0.0.0:${PORT}`);
            });

        // Listen for messages
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            if (!m.message) return;

            try {
                await messageHandler(sock, m);
            } catch (err) {
                logger.error('Error handling message:', {
                    error: err.message,
                    stack: err.stack,
                    messageId: m.key?.id,
                    from: m.key?.remoteJid
                });
            }
        });

        // Listen for connection updates
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    logger.info('Connection closed, attempting to reconnect...');
                    startBot();
                } else {
                    logger.error('Connection closed permanently. Please restart the bot.');
                    process.exit(1);
                }
            } else if (connection === 'connecting') {
                logger.info('Connecting to WhatsApp...');
            }
        });

        // Graceful shutdown
        const cleanup = async () => {
            logger.info('Received shutdown signal. Cleaning up...');

            // Close server first
            if (server) {
                await new Promise((resolve) => {
                    server.close(() => {
                        logger.info('HTTP server closed');
                        resolve();
                    });
                });
            }

            try {
                await sock.logout();
                logger.info('WhatsApp logout successful');
            } catch (err) {
                logger.error('Error during WhatsApp logout:', err);
            }

            process.exit(0);
        };

        process.on('SIGTERM', cleanup);
        process.on('SIGINT', cleanup);

    } catch (err) {
        logger.error('Fatal error starting bot:', {
            error: err.message,
            stack: err.stack
        });
        process.exit(1);
    }
}

// Start the bot with error handling
startBot().catch(err => {
    logger.error('Fatal error starting bot:', {
        error: err.message,
        stack: err.stack
    });
    process.exit(1);
});