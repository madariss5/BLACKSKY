/**
 * Modern WhatsApp MD Bot Menu System
 */

const { languageManager } = require('../utils/language');
const config = require('../config/config');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

// Emoji mapping for categories
const categoryEmojis = {
    'owner': '👑',
    'basic': '🧩',
    'educational': '📚',
    'fun': '🎮',
    'group': '👥',
    'media': '📽️',
    'nsfw': '🔞',
    'reactions': '💫',
    'user': '👤',
    'utility': '🛠️',
    'group_new': '👥',
    'default': '📋'
};

// Pretty names for categories
const categoryNames = {
    'owner': 'Owner',
    'basic': 'Basic',
    'educational': 'Educational',
    'fun': 'Fun & Games',
    'group': 'Group Management',
    'media': 'Media Tools',
    'nsfw': 'NSFW',
    'reactions': 'Reactions',
    'user': 'User Profile',
    'utility': 'Utilities',
    'group_new': 'Group Advanced',
    'default': 'Misc'
};

// Decorative symbols
const symbols = {
    bullet: '•',
    arrow: '➤',
    star: '✦',
    line: '━━━━━━━━━━━━━━━━━'
};

/**
 * Load all available commands from command files
 */
async function loadAllCommands() {
    try {
        const commandsPath = path.join(__dirname);
        const commandFiles = await fs.readdir(commandsPath);
        const allCommands = {};
        let totalCommands = 0;

        // Process a command module to extract commands
        const processCommandModule = (moduleData, category) => {
            let commands = moduleData.commands || moduleData;
            let categoryName = moduleData.category || category;

            if (typeof commands !== 'object') return 0;

            const commandList = Object.keys(commands).filter(cmd => 
                typeof commands[cmd] === 'function' && cmd !== 'init'
            );

            if (commandList.length > 0) {
                if (!allCommands[categoryName]) {
                    allCommands[categoryName] = [];
                }
                allCommands[categoryName].push(...commandList);
                totalCommands += commandList.length;
            }

            return commandList.length;
        };

        // Load commands from JS files
        for (const file of commandFiles) {
            if (file.endsWith('.js') && !['index.js', 'menu.js'].includes(file)) {
                try {
                    const filePath = path.join(commandsPath, file);
                    const moduleData = require(filePath);
                    const category = file.replace('.js', '');
                    processCommandModule(moduleData, category);
                } catch (err) {
                    logger.error(`Error loading commands from ${file}:`, err);
                }
            }
        }

        logger.info(`Loaded ${totalCommands} commands from ${Object.keys(allCommands).length} categories`);
        return { allCommands, totalCommands };
    } catch (err) {
        logger.error('Error loading commands:', err);
        return { allCommands: {}, totalCommands: 0 };
    }
}

/**
 * Create menu header
 */
function createHeader(botName, totalCommands, uptime) {
    return `┏━━━❮ *${botName.toUpperCase()}* ❯━━━┓
┃
┃ *📊 Status:* Online ✅
┃ *⏰ Uptime:* ${uptime}
┃ *🔢 Commands:* ${totalCommands}
┃
┗━━━━━━━━━━━━━━━━━━━━┛

${symbols.line}`;
}

/**
 * Create category section
 */
function createCategorySection(category, commands, prefix) {
    const emoji = categoryEmojis[category] || categoryEmojis.default;
    const prettyName = categoryNames[category] || categoryNames.default;

    let section = `\n┌───「 *${emoji} ${prettyName.toUpperCase()}* 」───┐\n`;
    const sortedCommands = [...commands].sort();

    for (const cmd of sortedCommands) {
        section += `┃ ${symbols.bullet} \`${prefix}${cmd}\`\n`;
    }

    section += `└─────────${symbols.line}─────────┘\n`;
    return section;
}

// Menu command handlers
const menuCommands = {
    async menu(sock, message, args) {
        try {
            const sender = message.key.remoteJid;
            const prefix = config.bot.prefix;
            const { allCommands, totalCommands } = await loadAllCommands();

            // Check if specific category requested
            const category = args[0]?.toLowerCase();

            if (category && allCommands[category]) {
                const header = createHeader(config.bot.name, allCommands[category].length, "Active");
                const menuText = header + createCategorySection(category, allCommands[category], prefix);
                await sock.sendMessage(sender, { text: menuText });
                return;
            }

            // Show category summary
            let menuText = createHeader(config.bot.name, totalCommands, "Active");
            menuText += "\n┏━━━❮ *📂 CATEGORIES* ❯━━━┓\n";

            for (const [cat, commands] of Object.entries(allCommands)) {
                const emoji = categoryEmojis[cat] || categoryEmojis.default;
                const prettyName = categoryNames[cat] || categoryNames.default;
                menuText += `┃ ${emoji} *${prettyName}* (${commands.length})\n`;
            }

            menuText += "┗━━━━━━━━━━━━━━━━━━━━┛\n\n";
            menuText += `Use \`${prefix}menu [category]\` to view commands in a specific category`;

            await sock.sendMessage(sender, { text: menuText });
        } catch (err) {
            logger.error('Menu command error:', err);
            await sock.sendMessage(message.key.remoteJid, { 
                text: '❌ Error generating menu. Please try again.' 
            });
        }
    },

    async list(sock, message, args) {
        try {
            const sender = message.key.remoteJid;
            const prefix = config.bot.prefix;
            const { allCommands, totalCommands } = await loadAllCommands();

            // Check if specific category requested
            const category = args[0]?.toLowerCase();

            if (category && allCommands[category]) {
                const emoji = categoryEmojis[category] || categoryEmojis.default;
                const prettyName = categoryNames[category] || categoryNames.default;
                let listText = `*${emoji} ${prettyName} Commands*\n${symbols.line}\n`;

                allCommands[category].sort().forEach(cmd => {
                    listText += `${symbols.bullet} \`${prefix}${cmd}\`\n`;
                });

                listText += `\n_Total: ${allCommands[category].length} commands_`;
                await sock.sendMessage(sender, { text: listText });
                return;
            }

            // List all categories
            let listText = "*📂 Available Categories*\n" + symbols.line + "\n";
            for (const [cat, commands] of Object.entries(allCommands)) {
                const emoji = categoryEmojis[cat] || categoryEmojis.default;
                const prettyName = categoryNames[cat] || categoryNames.default;
                listText += `${emoji} *${prettyName}* - ${commands.length} commands\n`;
            }

            listText += `\n_Total: ${totalCommands} commands_\n`;
            listText += `\nUse \`${prefix}list [category]\` to see commands in a category`;

            await sock.sendMessage(sender, { text: listText });
        } catch (err) {
            logger.error('List command error:', err);
            await sock.sendMessage(message.key.remoteJid, { 
                text: '❌ Error listing commands. Please try again.' 
            });
        }
    },
    async help(sock, message, args) {
            try {
                const sender = message.key.remoteJid;
                const prefix = config.bot.prefix;
                const commandName = args[0]?.toLowerCase();
                
                if (!commandName) {
                    // No specific command requested, show general help with modern styling
                    const helpText = `┏━━━❮ *📚 COMMAND HELP* ❯━━━┓
┃
┃ ${symbols.arrow} Get command details:
┃   \`${prefix}help [command]\`
┃
┃ ${symbols.arrow} Browse commands:
┃   \`${prefix}menu\` - All categories
┃   \`${prefix}list\` - All categories
┃   \`${prefix}list [category]\` - Specific category
┃
┃ ${symbols.sparkle} *Examples:*
┃   \`${prefix}help sticker\`
┃   \`${prefix}list media\`
┃
┗━━━━━━━━━━━━━━━━━━━━┛`;
                    
                    await sock.sendMessage(sender, { text: helpText });
                    return;
                }
                
                // Try to find the command in all modules
                const commandsPath = path.join(__dirname);
                const commandFiles = await fs.readdir(commandsPath);
                let foundCommand = null;
                let foundIn = null;
                
                for (const file of commandFiles) {
                    if (file.endsWith('.js') && file !== 'index.js') {
                        try {
                            const moduleData = require(`./${file}`);
                            let commandsObject;
                            
                            if (moduleData.commands) {
                                commandsObject = moduleData.commands;
                                if (commandsObject[commandName] && typeof commandsObject[commandName] === 'function') {
                                    foundCommand = commandsObject[commandName];
                                    foundIn = moduleData.category || file.replace('.js', '');
                                    break;
                                }
                            } else {
                                commandsObject = moduleData;
                                if (commandsObject[commandName] && typeof commandsObject[commandName] === 'function') {
                                    foundCommand = commandsObject[commandName];
                                    foundIn = file.replace('.js', '');
                                    break;
                                }
                            }
                        } catch (err) {
                            logger.error(`Error checking command in ${file}:`, err);
                        }
                    }
                }
                
                if (foundCommand) {
                    // Get the appropriate category emoji
                    const emoji = categoryEmojis[foundIn] || categoryEmojis.default;
                    
                    // Find command configuration for more details if available
                    let configInfo = "No additional information available.";
                    try {
                        const configPath = path.join(__dirname, '../config/commands', `${foundIn}.json`);
                        const configData = await fs.readFile(configPath, 'utf8');
                        const configs = JSON.parse(configData);
                        
                        const cmdConfig = configs.find(cmd => cmd.name === commandName);
                        if (cmdConfig) {
                            configInfo = cmdConfig.description || configInfo;
                        }
                    } catch (err) {
                        // Config file might not exist, that's ok
                    }
                    
                    const helpText = `┏━━━❮ *${emoji} COMMAND INFO* ❯━━━┓
┃
┃ *${symbols.sparkle} Command:* \`${prefix}${commandName}\`
┃ *${symbols.diamond} Category:* ${categoryNames[foundIn] || foundIn}
┃
┃ *${symbols.arrow} Description:* 
┃   ${configInfo}
┃
┃ *${symbols.check} Usage:* 
┃   \`${prefix}${commandName}\`
┃
┗━━━━━━━━━━━━━━━━━━━━┛`;
                    
                    await sock.sendMessage(sender, { text: helpText });
                } else {
                    await sock.sendMessage(sender, { 
                        text: `❌ Command "${commandName}" not found. Use \`${prefix}menu\` to see available commands.` 
                    });
                }
                
            } catch (err) {
                logger.error('Help command error:', err);
                await sock.sendMessage(message.key.remoteJid, { 
                    text: '❌ Error providing help. Please try again.' 
                });
            }
        }
};

module.exports = {
    commands: menuCommands,
    category: 'basic',
    async init() {
        try {
            logger.info('Initializing menu system...');
            const { totalCommands } = await loadAllCommands();
            logger.info(`Menu system initialized with ${totalCommands} total commands`);
            return true;
        } catch (err) {
            logger.error('Failed to initialize menu system:', err);
            return false;
        }
    }
};