/**
 * Safari-based WhatsApp Connection
 * Advanced connection system optimized for cloud environments
 * Features automatic credential backup and enhanced error recovery
 * Version: 1.2.2
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fsPromises = require('fs').promises;

// Initialize Express
const app = express();
const port = process.env.PORT || 5000;

// Configuration
const AUTH_FOLDER = process.env.AUTH_DIR || './auth_info_safari';
const VERSION = '1.2.2';
const MAX_RETRIES = 10;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const RECONNECT_INTERVAL = 60000; // 1 minute base interval
const QR_TIMEOUT = 60000; // 1 minute QR timeout

// Environment detection
const IS_CLOUD_ENV = process.env.REPLIT_ID || process.env.HEROKU_APP_ID;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Setup logger with improved formatting
const LOGGER = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      levelFirst: false,
      ignore: 'hostname,pid',
      translateTime: 'SYS:standard'
    }
  }
}).child({ name: 'BLACKSKY-MD' });

// Connection state
let sock = null;
let connectionRetries = 0;
let reconnectTimer = null;
let heartbeatTimer = null;
let cleanupTimer = null;
let qrDisplayTimer = null;
let qrGenerated = false;
let connectionState = 'disconnected';
let lastDisconnectCode = null;
let lastQRCode = null;
let isReconnecting = false;
let lastConnectTime = null;
let connectionUptime = 0;
let qrRetryCount = 0;

// Safari fingerprint (optimized for reliability)
const SAFARI_FINGERPRINT = {
  device: 'Safari on MacOS',
  platform: 'darwin',
  browser: ['Safari', '17.0'],
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
};

// Setup Express routes
app.get('/', (req, res) => {
  const uptime = lastConnectTime ? Math.floor((Date.now() - lastConnectTime) / 1000) : 0;
  res.json({
    status: connectionState,
    retries: connectionRetries,
    maxRetries: MAX_RETRIES,
    hasQR: !!lastQRCode,
    qrRetries: qrRetryCount,
    lastError: lastDisconnectCode,
    version: VERSION,
    uptime: uptime,
    isReconnecting,
    totalUptime: connectionUptime
  });
});

app.get('/status', (req, res) => {
  res.json({
    state: connectionState,
    qrGenerated,
    retries: connectionRetries,
    qrRetries: qrRetryCount,
    lastError: lastDisconnectCode,
    environment: IS_CLOUD_ENV ? 'cloud' : 'local',
    timestamp: new Date().toISOString(),
    lastConnectTime: lastConnectTime ? new Date(lastConnectTime).toISOString() : null
  });
});

// Display QR code with enhanced error handling
function displayQRCode(qr) {
  LOGGER.info(`Generating QR code (Attempt ${qrRetryCount + 1}/${MAX_RETRIES})`);

  console.log('\n▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
  console.log('█                   SCAN QR CODE TO CONNECT                      █');
  console.log('▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀\n');

  try {
    // Generate QR with error handling
    qrcode.generate(qr, { small: true }, (err, qrout) => {
      if (err) {
        LOGGER.error('Error generating QR:', err);
        // Attempt fallback QR display
        if (sock) {
          sock.ev.emit('connection.update', { qr });
        }
        return;
      }

      console.log(qrout);
      LOGGER.info('QR code generated successfully');

      console.log('\n▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
      console.log(`█  Scan within ${QR_TIMEOUT/1000} seconds. Attempt ${qrRetryCount + 1} of ${MAX_RETRIES}   █`);
      console.log('▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀\n');
    });

    // Set QR timeout
    if (qrDisplayTimer) clearTimeout(qrDisplayTimer);
    qrDisplayTimer = setTimeout(() => {
      if (connectionState === 'awaiting_scan') {
        LOGGER.warn('QR code expired, initiating new QR generation');
        qrRetryCount++;
        if (qrRetryCount < MAX_RETRIES) {
          handleReconnection('QR timeout');
        } else {
          LOGGER.error('Max QR retry attempts reached, restarting process');
          process.exit(1); // Force restart in cloud environment
        }
      }
    }, QR_TIMEOUT);

  } catch (err) {
    LOGGER.error('Error in QR code generation:', err);
    // Log detailed error information
    LOGGER.error({
      error: err.message,
      stack: err.stack,
      qrLength: qr?.length,
      state: connectionState
    });

    // Attempt to recover
    if (sock) {
      LOGGER.info('Attempting fallback QR display');
      sock.ev.emit('connection.update', { qr });
    }
  }
}

// Initialize connection
async function initializeConnection() {
  try {
    // Clear all existing auth folders to prevent conflicts
    const authFolders = [
      './auth_info_baileys',
      './auth_info_terminal',
      './auth_info_safari',
      './auth_info_web'
    ];

    for (const folder of authFolders) {
      if (fs.existsSync(folder)) {
        LOGGER.info(`Cleaning up auth folder: ${folder}`);
        fs.rmSync(folder, { recursive: true, force: true });
      }
    }

    // Create fresh auth folder
    fs.mkdirSync(AUTH_FOLDER, { recursive: true });
    LOGGER.info('Fresh auth folder created');

    // Reset QR state
    qrRetryCount = 0;
    lastQRCode = null;
    if (qrDisplayTimer) clearTimeout(qrDisplayTimer);
  } catch (err) {
    LOGGER.error('Error initializing connection:', err);
    throw err;
  }
}

// Handle connection updates with improved error handling
async function handleConnectionUpdate(update) {
  const { connection, lastDisconnect, qr } = update;

  LOGGER.debug('Connection update:', {
    connection,
    state: connectionState,
    retries: connectionRetries,
    hasQR: !!qr,
    errorCode: lastDisconnect?.error?.output?.statusCode
  });

  if (qr) {
    qrGenerated = true;
    lastQRCode = qr;
    LOGGER.info(`QR Code received (Attempt ${qrRetryCount + 1}/${MAX_RETRIES})`);
    connectionState = 'awaiting_scan';
    displayQRCode(qr);
  }

  if (connection === 'close') {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const reason = lastDisconnect?.error?.message || 'Unknown';

    lastDisconnectCode = statusCode;
    connectionState = 'disconnected';
    lastConnectTime = null;

    LOGGER.info(`Connection closed (Code: ${statusCode}). Reason: ${reason}`);

    // Log detailed disconnect information
    LOGGER.debug('Disconnect details:', {
      statusCode,
      reason,
      error: lastDisconnect?.error,
      retries: connectionRetries,
      qrRetries: qrRetryCount
    });

    // Handle specific error cases
    if (statusCode === DisconnectReason.loggedOut || 
        (lastDisconnect?.error instanceof Boom && lastDisconnect.error.output.statusCode === 440)) {
      LOGGER.warn('Session expired or logged out, clearing auth state');
      connectionRetries = 0;
      qrRetryCount = 0; // Reset QR retries on logout
      handleReconnection('Session expired');
    } else if (statusCode === 405) {
      LOGGER.warn('405 error detected - adjusting connection parameters');
      if (connectionRetries < MAX_RETRIES) {
        connectionRetries++;
        handleReconnection('Rate limit (405)');
      } else {
        LOGGER.error('Max retries reached - restarting process');
        process.exit(1); // Force restart in cloud environment
      }
    } else {
      // Generic reconnection logic
      if (connectionRetries < MAX_RETRIES) {
        connectionRetries++;
        handleReconnection('Generic error');
      } else {
        LOGGER.error('Max retries reached - restarting process');
        process.exit(1); // Force restart in cloud environment
      }
    }
  } else if (connection === 'open') {
    connectionState = 'connected';
    lastQRCode = null;
    qrRetryCount = 0;
    connectionRetries = 0;
    lastConnectTime = Date.now();

    // Clear QR timeout
    if (qrDisplayTimer) {
      clearTimeout(qrDisplayTimer);
      qrDisplayTimer = null;
    }

    LOGGER.info('✅ SUCCESSFULLY CONNECTED TO WHATSAPP!');
    LOGGER.info(`📱 Connected as: ${sock.user?.id || 'Unknown'}`);

    try {
      // Send welcome message
      if (sock && sock.user) {
        await sock.sendMessage(sock.user.id, { 
          text: `🤖 *BLACKSKY-MD Bot Connected!*\n\n` +
                `_Connection Time: ${new Date().toLocaleString()}_\n` +
                `_Version: ${VERSION}_\n\n` +
                `Send *!help* to see available commands.` 
        });
        LOGGER.info('Welcome message sent');
      }
    } catch (err) {
      LOGGER.error('Error sending welcome message:', err);
    }
  }
}

// Start connection with enhanced error handling
async function startConnection() {
  try {
    // Update connection state
    connectionState = 'connecting';
    LOGGER.info(`Starting WhatsApp connection (Attempt ${connectionRetries + 1}/${MAX_RETRIES})...`);

    // Get auth state
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    // Get Baileys version
    const { version } = await fetchLatestBaileysVersion();
    LOGGER.info(`Using Baileys version: ${version.join('.')}`);

    // Create socket with optimized settings
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true, // Enable both QR display methods
      browser: [generateDeviceId(), ...SAFARI_FINGERPRINT.browser],
      browserDescription: [SAFARI_FINGERPRINT.device, SAFARI_FINGERPRINT.platform, VERSION],
      userAgent: SAFARI_FINGERPRINT.userAgent,
      connectTimeoutMs: 60000,
      qrTimeout: QR_TIMEOUT,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      emitOwnEvents: false,
      customUploadHosts: ['media-sin1-1.cdn.whatsapp.net'], // Use Singapore server
      syncFullHistory: false,
      markOnlineOnConnect: false,
      logger: LOGGER,
      // Cloud environment optimizations
      retryRequestDelayMs: IS_CLOUD_ENV ? 5000 : 2000,
      fireAndRetry: IS_CLOUD_ENV,
      maxRetries: IS_CLOUD_ENV ? 5 : 3,
      throwErrorOnTosBlock: true, // Detect ToS violations early
      agent: undefined, // Let system handle proxy
      fetchAgent: undefined, // Let system handle fetch
      msgRetryCounterCache: {
        setKey: () => { }, // No-op to avoid Redis requirements
        getKey: () => undefined,
      }
    });

    // Handle connection updates
    sock.ev.on('connection.update', handleConnectionUpdate);

    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds);

  } catch (err) {
    LOGGER.error('Error in connection:', err);
    connectionState = 'error';

    if (connectionRetries < MAX_RETRIES) {
      connectionRetries++;
      const delay = Math.min(Math.pow(2, connectionRetries) * 1000, 10000);
      LOGGER.info(`Retrying after error in ${delay/1000}s (Attempt ${connectionRetries}/${MAX_RETRIES})`);
      setTimeout(startConnection, delay);
    } else {
      LOGGER.error('Max retries reached after errors');
      process.exit(1); // Force restart in cloud environment
    }
  }
}

// Generate unique device ID
function generateDeviceId() {
  const randomString = Math.random().toString(36).substring(2, 7);
  const timestamp = Date.now().toString().slice(-6);
  return `BLACKSKY-MD-${timestamp}-${randomString}`;
}

// Start Express server first, then initialize connection
const server = app.listen(port, '0.0.0.0', () => {
  LOGGER.info(`Status monitor running on port ${port}`);

  // Initialize and start connection after server is ready
  initializeConnection().then(() => {
    startConnection();
  }).catch(err => {
    LOGGER.error('Failed to initialize:', err);
    process.exit(1);
  });
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  LOGGER.info('Shutting down...');
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (qrDisplayTimer) clearTimeout(qrDisplayTimer);
  if (sock) {
    sock.end();
  }
  server.close(() => {
    LOGGER.info('Server closed');
    process.exit(0);
  });
});

// Export connection state for monitoring
module.exports = {
  getConnectionState: () => ({
    state: connectionState,
    retries: connectionRetries,
    lastError: lastDisconnectCode,
    qrGenerated,
    hasQR: !!lastQRCode,
    uptime: lastConnectTime ? Math.floor((Date.now() - lastConnectTime) / 1000) : 0
  })
};