/**
 * Ultra Minimal Message Handler
 * Designed for maximum reliability with zero dependencies
 * Now with full command loading capability
 */

// Import command modules
let commandModules;
try {
    commandModules = require('../commands/index').commands;
    console.log(`Loaded ${Object.keys(commandModules).length} commands from command modules`);
} catch (err) {
    console.error('Failed to load command modules:', err);
    commandModules = {}; // Fallback to empty object
}

// Commands map with fallback basic commands
const commands = new Map();

// Process all imported commands
try {
    Object.entries(commandModules).forEach(([name, func]) => {
        if (typeof func === 'function' && name !== 'init') {
            commands.set(name, async (sock, message) => {
                try {
                    // Extract args from message
                    const content = message.message.conversation || 
                                  message.message.extendedTextMessage?.text || '';
                    
                    // Parse arguments
                    const args = content.slice(1).trim().split(' ').slice(1);
                    
                    // Call the command with proper arguments
                    await func(sock, message, args);
                } catch (err) {
                    console.error(`Error executing command ${name}:`, err);
                }
            });
        }
    });
    console.log(`Successfully mapped ${commands.size} commands`);
} catch (loadErr) {
    console.error('Error processing command modules:', loadErr);
}

// Add essential fallback commands in case the imports fail
// These will only be added if they don't already exist

// Add ping command
if (!commands.has('ping')) {
    commands.set('ping', async (sock, message) => {
        try {
            if (!message.key?.remoteJid) return;
            const sender = message.key.remoteJid;
            await sock.sendMessage(sender, { text: '🏓 Pong! Bot is online.' });
        } catch (err) {
            console.error('Error in ping command:', err);
        }
    });
}

// Add help command
if (!commands.has('help')) {
    commands.set('help', async (sock, message) => {
        try {
            if (!message.key?.remoteJid) return;
            const sender = message.key.remoteJid;
            
            const commandsList = Array.from(commands.keys()).slice(0, 20).join(', ');
            
            const helpText = `*🤖 WhatsApp Bot Commands*\n\n` +
                            `Available commands: ${commands.size}\n` +
                            `Examples: ${commandsList}${commands.size > 20 ? '...' : ''}\n\n` +
                            `Use !commandname to execute a command\n` +
                            `Use !menu for a better organized list`;
            
            await sock.sendMessage(sender, { text: helpText });
        } catch (err) {
            console.error('Error in help command:', err);
        }
    });
}

// Add status command
if (!commands.has('status')) {
    commands.set('status', async (sock, message) => {
        try {
            if (!message.key?.remoteJid) return;
            const sender = message.key.remoteJid;
            
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);
            
            const statusText = `*📊 Bot Status*\n\n` +
                              `🟢 *Status:* Online\n` +
                              `⏱️ *Uptime:* ${hours}h ${minutes}m ${seconds}s\n` +
                              `🧩 *Commands:* ${commands.size}\n`;
            
            await sock.sendMessage(sender, { text: statusText });
        } catch (err) {
            console.error('Error in status command:', err);
        }
    });
}

// Add about command
if (!commands.has('about')) {
    commands.set('about', async (sock, message) => {
        try {
            if (!message.key?.remoteJid) return;
            const sender = message.key.remoteJid;
            
            const aboutText = `*🤖 BLACKSKY-MD Bot*\n\n` +
                             `A reliable WhatsApp bot with multi-level fallback system.\n\n` +
                             `*Version:* 1.0.0\n` +
                             `*Framework:* @whiskeysockets/baileys\n` +
                             `*Commands:* ${commands.size}\n\n` +
                             `Type *!help* for available commands.`;
            
            await sock.sendMessage(sender, { text: aboutText });
        } catch (err) {
            console.error('Error in about command:', err);
        }
    });
}

/**
 * Process messages
 */
async function messageHandler(sock, message) {
    try {
        // Very basic validation
        if (!message.message || !message.key?.remoteJid) return;
        
        // Get text content
        const content = message.message.conversation || 
                      message.message.extendedTextMessage?.text;
        
        console.log('Ultra minimal handler received message:', content);
        
        if (!content || !content.startsWith('!')) return;
        
        console.log('Processing command:', content);
        
        // Extract command
        const command = content.slice(1).trim().split(' ')[0].toLowerCase();
        
        console.log('Extracted command:', command, 'Available commands:', Array.from(commands.keys()));
        
        // Run command if it exists
        if (commands.has(command)) {
            console.log('Executing command:', command);
            await commands.get(command)(sock, message);
        } else {
            console.log('Command not found:', command);
        }
    } catch (err) {
        console.error('Error in ultra minimal handler:', err);
    }
}

/**
 * Initialize all command modules
 */
async function init() {
    console.log('Ultra minimal handler initializing...');
    
    try {
        // Try to initialize command modules
        if (require('../commands/index').initializeModules) {
            console.log('Initializing all command modules...');
            try {
                // We don't have the sock object at this point, so we pass null
                // The actual commands will get the sock object when they're called
                await require('../commands/index').initializeModules(null);
                console.log('Command modules initialized successfully');
            } catch (initErr) {
                console.error('Error initializing command modules:', initErr);
            }
        }
    } catch (err) {
        console.warn('Could not initialize command modules (this is fine for backup handler):', err.message);
    }
    
    console.log(`Ultra minimal handler initialized with ${commands.size} commands`);
    return true;
}

// Export the handler
module.exports = {
    messageHandler,
    init,
    commands
};