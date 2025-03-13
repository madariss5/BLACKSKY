/**
 * Simplified WhatsApp Bot
 * Designed for maximum reliability 
 */

// External modules
const path = require('path');
const handler = require(path.join(__dirname, 'src/handlers/ultra-minimal-handler'));
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const express = require('express');
const app = express();

// Constants
const PORT = process.env.PORT || 5000;
const SESSION_DIR = './auth_info_qr';

// Track bot statistics
const botStats = {
    startTime: Date.now(),
    messagesReceived: 0,
    commandsProcessed: 0,
    errors: 0,
    lastMessage: null,
    lastCommand: null,
    lastError: null,
    status: 'initializing'
};

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Root endpoint with status dashboard
app.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    
    res.send(`
        <html>
            <head>
                <title>WhatsApp Bot Status</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                    .status { padding: 10px; border-radius: 5px; margin-bottom: 10px; }
                    .connected { background-color: #d4edda; color: #155724; }
                    .disconnected { background-color: #f8d7da; color: #721c24; }
                    .connecting { background-color: #fff3cd; color: #856404; }
                    .initializing { background-color: #d1ecf1; color: #0c5460; }
                    .error { background-color: #f8d7da; color: #721c24; }
                    .stat-container { display: flex; flex-wrap: wrap; gap: 20px; }
                    .stat-box { flex: 1; min-width: 200px; border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
                </style>
            </head>
            <body>
                <h1>WhatsApp Bot Status</h1>
                <div class="status ${botStats.status}">
                    <strong>Status:</strong> ${botStats.status.charAt(0).toUpperCase() + botStats.status.slice(1)}
                </div>
                
                <div class="stat-container">
                    <div class="stat-box">
                        <h3>Uptime</h3>
                        <p>${hours}h ${minutes}m ${seconds}s</p>
                    </div>
                    <div class="stat-box">
                        <h3>Messages</h3>
                        <p>${botStats.messagesReceived} received</p>
                    </div>
                    <div class="stat-box">
                        <h3>Commands</h3>
                        <p>${botStats.commandsProcessed} processed</p>
                    </div>
                    <div class="stat-box">
                        <h3>Errors</h3>
                        <p>${botStats.errors} occurred</p>
                    </div>
                </div>
                
                <h3>Last Activity</h3>
                <div class="stat-container">
                    <div class="stat-box">
                        <h4>Last Message</h4>
                        <p>${botStats.lastMessage || 'None yet'}</p>
                    </div>
                    <div class="stat-box">
                        <h4>Last Command</h4>
                        <p>${botStats.lastCommand || 'None yet'}</p>
                    </div>
                </div>
                
                ${botStats.lastError ? `
                <h3>Last Error</h3>
                <div class="stat-box">
                    <p>${botStats.lastError}</p>
                </div>
                ` : ''}
                
                <p><small>Generated at ${new Date().toLocaleString()}</small></p>
            </body>
        </html>
    `);
});

// Heartbeat endpoint
app.get('/heartbeat', (req, res) => {
    res.json({
        status: botStats.status,
        uptime: Math.floor((Date.now() - botStats.startTime) / 1000),
        stats: {
            messagesReceived: botStats.messagesReceived,
            commandsProcessed: botStats.commandsProcessed,
            errors: botStats.errors
        },
        timestamp: Date.now()
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    // Calculate memory usage
    const memoryUsage = process.memoryUsage();
    
    res.json({
        status: botStats.status,
        uptime: Math.floor((Date.now() - botStats.startTime) / 1000),
        memory: {
            rss: Math.round(memoryUsage.rss / 1024 / 1024),
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            external: Math.round(memoryUsage.external / 1024 / 1024)
        },
        timestamp: Date.now()
    });
});

// Initialize directories
async function initializeDirectories() {
    const directories = [
        SESSION_DIR,
        './data',
        './data/educational',
        './data/educational/flashcards',
        './data/temp'
    ];

    for (const dir of directories) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Created directory: ${dir}`);
        }
    }
}

// Save session data
const saveCreds = (creds) => {
    try {
        fs.writeFileSync(
            path.join(SESSION_DIR, 'creds.json'),
            JSON.stringify(creds, null, 2)
        );
    } catch (err) {
        console.error('Error saving credentials:', err);
        botStats.lastError = `Failed to save credentials: ${err.message}`;
        botStats.errors++;
    }
};

// Initialize WhatsApp connection
async function connectToWhatsApp() {
    try {
        // Ensure directories exist
        await initializeDirectories();

        // Initialize handler first
        console.log('Initializing message handler...');
        await handler.init();
        console.log('Message handler initialized successfully');

        // Get authentication state
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        // Create socket connection with enhanced configuration
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: console.log,
            // More reliable connection settings
            connectTimeoutMs: 30000,
            keepAliveIntervalMs: 15000,
            retryRequestDelayMs: 3000,
            maxRetries: 5,
            // Browser profile
            browser: ['BLACKSKY-MD', 'Chrome', '104.0.0.0'],
            // Connection behavior
            markOnlineOnConnect: true,
            emitOwnEvents: false,
            syncFullHistory: false
        });

        // Track connection state
        let isConnected = false;
        let reconnectAttempt = 0;
        let connectionLock = false;
        let messageHandlerInitialized = false;

        // Connection update handler with enhanced logging
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            console.log('Connection update:', update); // Log all updates

            // Update bot status
            if (connection) {
                botStats.status = connection;
                console.log(`Connection status changed to: ${connection}`);
            }

            if (connection === 'open') {
                console.log('🟢 Connected to WhatsApp');

                try {
                    // Initialize message handler if not already initialized
                    if (!messageHandlerInitialized) {
                        await handler.init();
                        console.log('✅ Message handler initialized');
                        messageHandlerInitialized = true;
                    }

                    // Clear any existing message handlers
                    sock.ev.removeAllListeners('messages.upsert');

                    // Register new message handler
                    sock.ev.on('messages.upsert', async (m) => {
                        console.log('Received message update:', m.type);
                        if (m.type === 'notify') {
                            for (const msg of m.messages) {
                                try {
                                    console.log('Processing message:', msg.key.id);
                                    await handler.messageHandler(sock, msg);
                                } catch (err) {
                                    console.error('Error processing message:', err);
                                    botStats.errors++;
                                    botStats.lastError = err.message;
                                }
                            }
                        }
                    });

                    // Send test message to confirm handler is working
                    try {
                        const remoteJid = sock.user.id;
                        await sock.sendMessage(remoteJid, { text: '🤖 Bot is online and ready!' });
                        console.log('Test message sent successfully');
                    } catch (err) {
                        console.error('Failed to send test message:', err);
                        botStats.errors++;
                        botStats.lastError = err.message;
                    }

                } catch (err) {
                    console.error('Error in connection setup:', err);
                    botStats.errors++;
                    botStats.lastError = err.message;
                }
            } else if (connection === 'close') {
                console.log('🔴 Connection closed');
                // Handle reconnection
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log('Attempting to reconnect...');
                    connectToWhatsApp();
                }
            } else if (connection === 'connecting') {
                console.log('Connecting to WhatsApp...');
            }
            
            // Show QR code update if we have one
            if (qr) {
                console.log('New QR code received');
            }
        });
        

        // Handle credentials update
        sock.ev.on('creds.update', saveCreds);

        // Handle group participants update
        sock.ev.on('group-participants.update', async (update) => {
            try {
                const { id, participants, action } = update;
                console.log(`Group update: ${action} in ${id}`);
                
                // We could implement group-specific logic here if needed
            } catch (err) {
                console.error('Error handling group update:', err);
                botStats.errors++;
                botStats.lastError = err.message;
            }
        });
        
        // Handle in-coming calls
        sock.ev.on('call', async (calls) => {
            for (const call of calls) {
                try {
                    console.log(`Received call from ${call.from}`);
                    // We could implement call handling logic here
                } catch (err) {
                    console.error('Error handling call:', err);
                    botStats.errors++;
                    botStats.lastError = err.message;
                }
            }
        });
        

        return sock;
    } catch (err) {
        console.error('Fatal error in WhatsApp connection:', err);
        botStats.errors++;
        botStats.lastError = err.message;
        // Try to reconnect after error
        setTimeout(() => {
            console.log('Retrying connection after fatal error...');
            connectToWhatsApp();
        }, 10000); // Longer delay after fatal error
    }
}

// Periodic health check function
async function performHealthCheck() {
    try {
        console.log('🔍 Performing periodic health check...');
        
        // Check memory usage
        const memoryUsage = process.memoryUsage();
        console.log('📊 Memory Usage:', {
            rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
            heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
            heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
            external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`
        });
        
        // Check handler status
        try {
            const handlerPath = './src/handlers/ultra-minimal-handler.js';
            const handler = require(handlerPath);
            console.log(`✅ Command handler loaded with ${handler.commands?.size || 0} commands`);
            
            // List a few random commands as a health check
            if (handler.commands?.size > 0) {
                const commandKeys = Array.from(handler.commands.keys());
                const sampleSize = Math.min(5, commandKeys.length);
                const randomSample = [];
                
                for (let i = 0; i < sampleSize; i++) {
                    const randomIndex = Math.floor(Math.random() * commandKeys.length);
                    randomSample.push(commandKeys[randomIndex]);
                    commandKeys.splice(randomIndex, 1);
                }
                
                console.log(`📋 Random command sample: ${randomSample.join(', ')}`);
            }
        } catch (handlerErr) {
            console.error('❌ Command handler check failed:', handlerErr);
            botStats.errors++;
            botStats.lastError = handlerErr.message;
        }
        
        // Check uptime
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        console.log(`⏱️ Bot uptime: ${hours}h ${minutes}m ${seconds}s`);
        
        // Schedule next health check
        setTimeout(performHealthCheck, 30 * 60 * 1000); // Run every 30 minutes
    } catch (err) {
        console.error('❌ Health check failed:', err);
        botStats.errors++;
        botStats.lastError = err.message;
        // Schedule another check even if this one failed
        setTimeout(performHealthCheck, 30 * 60 * 1000);
    }
}

// Start the bot
async function start() {
    try {
        console.log('🚀 Starting WhatsApp Bot...');
        
        // Start HTTP server
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Server started on port ${PORT}`);
            
            // Initialize WhatsApp connection
            connectToWhatsApp();
            
            // Schedule first health check after 5 minutes
            setTimeout(performHealthCheck, 5 * 60 * 1000);
        });
        
        server.on('error', (err) => {
            console.error('❌ Server error:', err);
            botStats.errors++;
            botStats.lastError = err.message;
        });
    } catch (err) {
        console.error('❌ Failed to start application:', err);
        botStats.errors++;
        botStats.lastError = err.message;
    }
}

// Handle errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    botStats.errors++;
    botStats.lastError = err.message;
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    botStats.errors++;
    botStats.lastError = err.message;
});

// Start application
start();

module.exports = { start, connectToWhatsApp };