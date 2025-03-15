/**
 * Safari-based WhatsApp Connection
 * Advanced connection system optimized for cloud environments like Replit/Heroku
 * Features automatic credential backup and enhanced error recovery
 * Version: 1.1.0
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { exec } = require('child_process');
const os = require('os');

// Configuration
const AUTH_FOLDER = './auth_info_safari';
const MAIN_AUTH_FOLDER = './auth_info_baileys';
const VERSION = '1.1.0';
const MAX_QR_RETRIES = 3;
const CREDENTIAL_BACKUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const BROWSER_FINGERPRINTS = [
  ['Safari', '17.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'],
  ['Chrome', '110.0.0.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'],
  ['Firefox', '115.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:115.0) Gecko/20100101 Firefox/115.0']
];

// Environment detection
const IS_CLOUD_ENV = process.env.REPLIT_ID || process.env.HEROKU_APP_ID || process.env.RENDER_SERVICE_ID;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Utility function to send typing indicator
async function showTypingIndicator(sock, jid, durationMs = 1000) {
  try {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate('composing', jid);
    
    // Wait for the specified duration
    await new Promise(resolve => setTimeout(resolve, durationMs));
    
    // Stop typing indicator
    await sock.sendPresenceUpdate('paused', jid);
    return true;
  } catch (err) {
    LOGGER.error(`Error showing typing indicator: ${err.message}`);
    return false;
  }
}

// Setup logger
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
const MAX_RETRIES = 5;
let reconnectTimer = null;
let qrGenerated = false;
let connectionState = 'disconnected';
let lastDisconnectCode = null;

// Safari fingerprint (popular with MD bots)
const SAFARI_FINGERPRINT = ['Safari', '17.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'];

// Make sure auth folder exists
function ensureAuthFolder() {
  if (!fs.existsSync(AUTH_FOLDER)) {
    LOGGER.info(`Creating auth folder: ${AUTH_FOLDER}`);
    fs.mkdirSync(AUTH_FOLDER, { recursive: true });
  }
}

// Clean auth state if needed
async function clearAuthState() {
  if (fs.existsSync(AUTH_FOLDER)) {
    LOGGER.info('Clearing auth state...');
    fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
    fs.mkdirSync(AUTH_FOLDER, { recursive: true });
  }
}

// Copy auth files to main auth folder with verification
async function copyAuthToMain() {
  try {
    const mainAuthFolder = './auth_info_baileys';
    if (!fs.existsSync(mainAuthFolder)) {
      fs.mkdirSync(mainAuthFolder, { recursive: true });
    }
    
    // Clear any existing files in the main folder
    const existingFiles = fs.readdirSync(mainAuthFolder);
    for (const file of existingFiles) {
      const filePath = path.join(mainAuthFolder, file);
      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
    }
    
    if (fs.existsSync(AUTH_FOLDER)) {
      // Get the list of source files
      const files = fs.readdirSync(AUTH_FOLDER);
      LOGGER.info(`Copying ${files.length} auth files to main folder...`);
      
      // Copy each file
      let copiedCount = 0;
      for (const file of files) {
        const srcPath = path.join(AUTH_FOLDER, file);
        const destPath = path.join(mainAuthFolder, file);
        if (fs.statSync(srcPath).isFile()) {
          fs.copyFileSync(srcPath, destPath);
          copiedCount++;
        }
      }
      
      // Verify the copy was successful
      const verifyFiles = fs.readdirSync(mainAuthFolder);
      LOGGER.info(`Auth files copied: ${copiedCount}/${files.length}, verified: ${verifyFiles.length} files present in target folder`);
      
      // Make sure essential files were copied
      const essentialFiles = ['creds.json'];
      for (const essential of essentialFiles) {
        const essentialPath = path.join(mainAuthFolder, essential);
        if (!fs.existsSync(essentialPath)) {
          LOGGER.warn(`Essential file ${essential} not found in target folder!`);
          
          // Try to copy it directly
          const srcEssential = path.join(AUTH_FOLDER, essential);
          if (fs.existsSync(srcEssential)) {
            fs.copyFileSync(srcEssential, essentialPath);
            LOGGER.info(`Re-copied essential file ${essential}`);
          } else {
            LOGGER.error(`Essential file ${essential} not found in source!`);
          }
        }
      }
      
      LOGGER.info('Auth files copied to main folder successfully');
      return true;
    }
    return false;
  } catch (error) {
    LOGGER.error('Error copying auth files:', error);
    return false;
  }
}

// Unique device ID generator
function generateDeviceId() {
  const randomString = Math.random().toString(36).substring(2, 7);
  const timestamp = Date.now().toString();
  return `BLACKSKY-SAFARI-${timestamp}-${randomString}`;
}

/**
 * Send credentials backup to the bot's own number
 * This is useful for Heroku deployment where credentials need to be restored
 */
async function sendCredsBackup(sock) {
  try {
    // Get the bot's own JID
    const ownJid = sock.user.id;
    LOGGER.info(`Preparing to send credentials backup to ${ownJid.replace(/@.+/, '@...')}`);
    
    // Path to creds.json file
    const credsPath = path.join(AUTH_FOLDER, 'creds.json');
    
    // Verify creds file exists and has content
    if (!fs.existsSync(credsPath)) {
      LOGGER.error('Cannot send credentials backup: creds.json not found');
      return false;
    }
    
    const credsSize = fs.statSync(credsPath).size;
    if (credsSize === 0) {
      LOGGER.error('Cannot send credentials backup: creds.json is empty');
      return false;
    }
    
    // Read the file as a buffer
    const credsBuffer = fs.readFileSync(credsPath);
    
    // Send the credentials file
    await sock.sendMessage(ownJid, {
      document: credsBuffer,
      fileName: 'creds.json',
      mimetype: 'application/json',
      caption: '🔐 *WhatsApp Credentials Backup*\n\nThis file is needed for Heroku deployment. Keep it safe and do not share it with anyone.'
    });
    
    LOGGER.info('Credentials backup sent successfully');
    
    // Also backup the session files that are crucial for reconnection
    const sessionFiles = fs.readdirSync(AUTH_FOLDER).filter(file => file.startsWith('session-'));
    if (sessionFiles.length > 0) {
      // Create a temporary zip file with all session files
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      
      for (const file of sessionFiles) {
        const filePath = path.join(AUTH_FOLDER, file);
        zip.addLocalFile(filePath);
      }
      
      // Generate zip buffer
      const zipBuffer = zip.toBuffer();
      
      // Send the session backup
      await sock.sendMessage(ownJid, {
        document: zipBuffer,
        fileName: 'session_backup.zip',
        mimetype: 'application/zip',
        caption: '📁 *WhatsApp Session Backup*\n\nAdditional session files for complete restoration.'
      });
      
      LOGGER.info('Session backup sent successfully');
    }
    
    return true;
  } catch (error) {
    LOGGER.error('Error sending credentials backup:', error);
    return false;
  }
}

// Handle connection status changes
async function handleConnectionUpdate(update) {
  const { connection, lastDisconnect, qr } = update;
  
  if (qr) {
    qrGenerated = true;
    console.log('────────────────────────────────────────');
    console.log('🔄 SCAN THIS QR CODE WITH YOUR PHONE:');
    console.log('────────────────────────────────────────');
    
    // Display QR in terminal (better for cloud environments)
    const qrcode = require('qrcode-terminal');
    qrcode.generate(qr, { small: true });
    
    console.log('────────────────────────────────────────');
    console.log('📱 Waiting for QR code scan...');
    console.log('────────────────────────────────────────');
  }
  
  if (connection === 'close') {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const reason = lastDisconnect?.error?.message || 'Unknown';
    
    // Save for potential diagnosis
    lastDisconnectCode = statusCode;
    connectionState = 'disconnected';
    
    LOGGER.info(`Connection closed (Code: ${statusCode}). Reason: ${reason}`);
    
    if (statusCode === DisconnectReason.loggedOut) {
      LOGGER.warn('Device logged out, clearing auth state');
      await clearAuthState();
      connectionRetries = 0;
      startConnection();
    } else if (statusCode === 405) {
      LOGGER.warn('405 error detected - WhatsApp blocking cloud environment');
      
      // Try new attempt with same browser but different device ID
      if (connectionRetries < MAX_RETRIES) {
        connectionRetries++;
        const delay = Math.min(Math.pow(2, connectionRetries) * 1000, 10000);
        LOGGER.info(`Retrying with new device ID in ${delay/1000}s (Attempt ${connectionRetries}/${MAX_RETRIES})`);
        
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(startConnection, delay);
      } else {
        LOGGER.error('Max retries reached, please try alternative connection method');
        LOGGER.info('Try using local-connect.js on your computer, then upload auth files');
      }
    } else {
      // Generic reconnection logic
      if (connectionRetries < MAX_RETRIES) {
        connectionRetries++;
        const delay = Math.min(Math.pow(2, connectionRetries) * 1000, 10000);
        LOGGER.info(`Reconnecting in ${delay/1000}s (Attempt ${connectionRetries}/${MAX_RETRIES})`);
        
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(startConnection, delay);
      } else {
        LOGGER.error('Max retries reached, connection attempts failed');
      }
    }
  } else if (connection === 'open') {
    connectionState = 'connected';
    LOGGER.info('✅ SUCCESSFULLY CONNECTED TO WHATSAPP!');
    LOGGER.info(`📱 Connected as: ${sock.user?.id || 'Unknown'}`);
    
    // Reset retry counter on successful connection
    connectionRetries = 0;
    
    // Copy auth files to main auth folder
    await copyAuthToMain();
    
    // Send a welcome message and credentials backup to yourself
    try {
      if (sock && sock.user) {
        // First send welcome message
        await sock.sendMessage(sock.user.id, { 
          text: `🤖 *BLACKSKY-MD Bot Connected!*\n\n_Connection Time: ${new Date().toLocaleString()}_\n_Version: ${VERSION}_\n\nSend *!help* to see available commands.` 
        });
        LOGGER.info('Welcome message sent');
        
        // Then send creds.json file as a backup for Heroku deployment
        await sendCredsBackup(sock);
        
        // Set up periodic credential backup for Heroku deployment
        // This ensures your credentials are always available even if Heroku restarts
        if (process.env.HEROKU_APP_ID || IS_CLOUD_ENV) {
          LOGGER.info('Setting up periodic credential backup for cloud environment');
          
          // Clear any existing backup timer
          if (global.credentialBackupTimer) {
            clearInterval(global.credentialBackupTimer);
          }
          
          // Set up new periodic backup (every 24 hours by default)
          global.credentialBackupTimer = setInterval(async () => {
            LOGGER.info('Running scheduled credential backup...');
            try {
              if (sock && sock.user && sock.user.id) {
                await sendCredsBackup(sock);
                LOGGER.info('Scheduled credential backup completed successfully');
              }
            } catch (backupErr) {
              LOGGER.error('Error in scheduled credential backup:', backupErr);
            }
          }, CREDENTIAL_BACKUP_INTERVAL);
          
          LOGGER.info(`Credential backup scheduled every ${CREDENTIAL_BACKUP_INTERVAL / (1000 * 60 * 60)} hours`);
        }
      }
    } catch (err) {
      LOGGER.error('Error sending welcome message:', err);
    }
  }
}

// Set up message handler with enhanced reliability
function setupMessageHandler() {
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    LOGGER.info(`Received message event of type: ${type} with ${messages.length} messages`);
    
    for (const message of messages) {
      try {
        // Skip messages from self
        if (message.key.fromMe) {
          LOGGER.info('Skipping message from self');
          continue;
        }
        
        // Check if message is valid
        if (!message.message) {
          LOGGER.info('Received message without content, skipping');
          continue;
        }
        
        // Extract JID and message content with safer extraction
        const remoteJid = message.key.remoteJid;
        if (!remoteJid) {
          LOGGER.warn('Message missing remoteJid, skipping');
          continue;
        }
        
        // Track message receipt for analytics
        LOGGER.debug(`Message received from ${remoteJid.replace(/@.+/, '@...')} with ID: ${message.key.id}`);
        
        // Send read receipt to improve user experience
        await sock.readMessages([message.key]);
        
        // Safely extract message text
        const messageText = message.message?.conversation || 
                           message.message?.extendedTextMessage?.text || 
                           message.message?.imageMessage?.caption ||
                           '';
                        
        // Log incoming message with safe JID formatting
        const formattedJid = remoteJid.replace(/@.+/, '@...');
        LOGGER.info(`New message from ${formattedJid}: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`);
        
        // Handle commands
        if (messageText.startsWith('!')) {
          const command = messageText.slice(1).trim().split(' ')[0].toLowerCase();
          const args = messageText.slice(1).trim().split(' ').slice(1);
          
          LOGGER.info(`Processing command: ${command} with args: ${args.join(' ')}`);
          
          // Basic command handler
          switch(command) {
            case 'ping':
              // Show typing indicator and send response
              await showTypingIndicator(sock, remoteJid, 1000);
              await sock.sendMessage(remoteJid, { text: 'Pong! 🏓 Bot is working properly.' });
              LOGGER.info('Responded to ping command');
              break;
              
            case 'help':
              // Show typing indicator for a longer help message
              await showTypingIndicator(sock, remoteJid, 2000);
              
              // Send help message
              await sock.sendMessage(remoteJid, { 
                text: `📋 *BLACKSKY-MD Commands*\n\n` +
                      `!ping - Check if bot is online\n` +
                      `!info - Show bot information\n` +
                      `!help - Show this help message\n` +
                      `!test - Test the bot's response\n` +
                      `!backup - Create credentials backup for Heroku deployment`
              });
              
              LOGGER.info('Responded to help command');
              break;
              
            case 'info':
              // Show typing indicator for info message (takes a bit to calculate)
              await showTypingIndicator(sock, remoteJid, 1500);
              
              // Calculate uptime for display
              const uptime = process.uptime();
              const uptimeStr = Math.floor(uptime / 3600) + 'h ' + 
                               Math.floor((uptime % 3600) / 60) + 'm ' + 
                               Math.floor(uptime % 60) + 's';
              
              // Send info message
              await sock.sendMessage(remoteJid, { 
                text: `🤖 *Bot Information*\n\n` +
                      `• *Name:* BLACKSKY-MD\n` +
                      `• *Status:* Online\n` +
                      `• *Uptime:* ${uptimeStr}\n` +
                      `• *Version:* ${VERSION}\n` +
                      `• *Connection:* Safari\n` +
                      `• *Environment:* ${IS_CLOUD_ENV ? 'Cloud' : 'Local'}\n` +
                      `• *Connected:* ${new Date(Date.now()).toLocaleString()}\n` +
                      `• *User ID:* ${sock.user.id.split('@')[0]}\n` +
                      `• *Heroku Ready:* ✅`
              });
              
              LOGGER.info('Responded to info command');
              break;
              
            case 'test':
              // Show typing indicator
              await showTypingIndicator(sock, remoteJid, 800);
              
              // Send test message
              await sock.sendMessage(remoteJid, { text: '✅ Test successful! The bot is working correctly.' });
              LOGGER.info('Responded to test command');
              break;
              
            case 'backup':
              LOGGER.info('Manual backup requested by user');
              
              // Show typing indicator while processing request
              await showTypingIndicator(sock, remoteJid, 1000);
              
              // Initial backup message with status
              await sock.sendMessage(remoteJid, { text: '🔄 Creating a credentials backup for Heroku deployment...' });
              
              // Check if user is requesting backup to their own number
              const isOwn = remoteJid === sock.user.id;
              
              if (isOwn) {
                // Show typing indicator for processing backup
                await showTypingIndicator(sock, remoteJid, 2000);
                
                // Send backup directly
                const backupSuccess = await sendCredsBackup(sock);
                if (backupSuccess) {
                  await sock.sendMessage(remoteJid, { 
                    text: '✅ Credentials backup complete! You can use these files for Heroku deployment.' 
                  });
                } else {
                  await sock.sendMessage(remoteJid, { 
                    text: '❌ Error creating credentials backup. Please try again later or check logs.' 
                  });
                }
              } else {
                // Send to user's number and owner number
                try {
                  // Notify the owner about the request
                  await showTypingIndicator(sock, sock.user.id, 1000);
                  await sock.sendMessage(sock.user.id, {
                    text: `🔔 User ${remoteJid.replace(/@.+/, '')} requested a credentials backup.`
                  });
                  
                  // Process backup request
                  const backupSuccess = await sendCredsBackup(sock);
                  
                  // Notify the user
                  await sock.sendMessage(remoteJid, { 
                    text: '✅ Credentials backup sent to bot owner. Only the bot owner can receive the actual credential files for security reasons.' 
                  });
                } catch (backupErr) {
                  LOGGER.error('Error in manual backup process:', backupErr);
                  await sock.sendMessage(remoteJid, { 
                    text: '❌ Error creating credentials backup. Please try again later.' 
                  });
                }
              }
              break;
              
            default:
              // Show typing indicator for unknown command
              await showTypingIndicator(sock, remoteJid, 500);
              
              // Send unknown command message
              await sock.sendMessage(remoteJid, { 
                text: `⚠️ Unknown command: ${command}\nType !help to see available commands.` 
              });
              LOGGER.info(`Responded to unknown command: ${command}`);
              break;
          }
        }
      } catch (err) {
        LOGGER.error(`Error processing message: ${err.message}`);
        // Try to notify the user about the error if possible
        try {
          if (message.key.remoteJid) {
            await sock.sendMessage(message.key.remoteJid, { 
              text: '❌ Sorry, there was an error processing your message. Please try again.' 
            });
          }
        } catch (notifyErr) {
          LOGGER.error(`Error sending error notification: ${notifyErr.message}`);
        }
      }
    }
  });
  
  // Also register for group events
  sock.ev.on('groups.update', async (updates) => {
    LOGGER.info(`Received group update: ${JSON.stringify(updates)}`);
  });
  
  sock.ev.on('group-participants.update', async (update) => {
    LOGGER.info(`Group participants update in ${update.id}: ${update.action} for ${update.participants.length} participants`);
  });
}

// Start connection
async function startConnection() {
  try {
    // Make sure auth folder exists
    ensureAuthFolder();
    
    // Update connection state
    connectionState = 'connecting';
    LOGGER.info(`Starting WhatsApp connection (Attempt ${connectionRetries + 1}/${MAX_RETRIES})...`);
    
    // Get auth state
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    
    // Get Baileys version
    const { version } = await fetchLatestBaileysVersion();
    LOGGER.info(`Using Baileys version: ${version.join('.')}`);
    
    // Create socket
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true, // Also print in terminal for backup
      logger: LOGGER,
      connectTimeoutMs: 60000,
      browser: [generateDeviceId(), ...SAFARI_FINGERPRINT.slice(0, 2)],
      userAgent: SAFARI_FINGERPRINT[2],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      keepAliveIntervalMs: 10000,
      emitOwnEvents: false,
      defaultQueryTimeoutMs: 60000,
      qrTimeout: 60000,
      /* Advanced options to help with cloud restrictions */
      retryRequestDelayMs: 250,
      fireInitQueries: true,
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
      generateHighQualityLinkPreview: false, // Saves resources
      patchMessageBeforeSending: (message) => {
        // Adjust message properties to avoid restrictions
        const requiresPatch = !!(
          message.buttonsMessage ||
          message.templateMessage ||
          message.listMessage
        );
        
        if (requiresPatch) {
          // Convert to compatible format
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {}
                },
                ...message
              }
            }
          };
        }
        
        return message;
      }
    });
    
    // Handle connection updates
    sock.ev.on('connection.update', handleConnectionUpdate);
    
    // Save credentials on update
    sock.ev.on('creds.update', saveCreds);
    
    // Setup message handler
    setupMessageHandler();
    
  } catch (error) {
    LOGGER.error('Error starting connection:', error);
    connectionState = 'error';
    
    // Retry on error
    if (connectionRetries < MAX_RETRIES) {
      connectionRetries++;
      const delay = Math.min(Math.pow(2, connectionRetries) * 1000, 10000);
      LOGGER.info(`Retrying in ${delay/1000}s due to error (Attempt ${connectionRetries}/${MAX_RETRIES})`);
      
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(startConnection, delay);
    }
  }
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  clearTimeout(reconnectTimer);
  process.exit(0);
});

// Start the application
console.log('╔═══════════════════════════════════════╗');
console.log('║     🤖 BLACKSKY-MD BOT LAUNCHER      ║');
console.log('║      Safari Connection Edition        ║');
console.log('╚═══════════════════════════════════════╝');
startConnection();