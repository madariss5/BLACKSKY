const { languageManager } = require('../utils/language');
const config = require('../config/config');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');
const { commandLoader } = require('../utils/commandLoader');
const moment = require('moment');

// Fancy border styles
const borders = {
    thin: {
        top: '╭',
        topRight: '╮',
        right: '│',
        bottomRight: '╯',
        bottom: '╰',
        bottomLeft: '╰',
        left: '│',
        topLeft: '╭'
    },
    thick: {
        top: '┏',
        topRight: '┓',
        right: '┃',
        bottomRight: '┛',
        bottom: '┗',
        bottomLeft: '┗',
        left: '┃',
        topLeft: '┏'
    },
    double: {
        top: '╔',
        topRight: '╗',
        right: '║',
        bottomRight: '╝',
        bottom: '╚',
        bottomLeft: '╚',
        left: '║',
        topLeft: '╔'
    }
};

// Theme colors using emoji
const themes = {
    primary: '🟢',
    secondary: '🔵',
    success: '✅',
    info: 'ℹ️',
    warning: '⚠️',
    danger: '❌',
    light: '⚪',
    dark: '⚫'
};

// Function to create a styled section
function createSection(title, content, style = 'thin', padding = 2) {
    const b = borders[style];
    const paddingStr = ' '.repeat(padding);
    const titlePadded = title ? ` ${title} ` : '';
    
    let result = `${b.top}${'━'.repeat(titlePadded.length)}${b.topRight}\n`;
    result += `${b.left}${titlePadded}${b.right}\n`;
    
    if (Array.isArray(content)) {
        for (const line of content) {
            result += `${b.left}${paddingStr}${line}${b.right}\n`;
        }
    } else {
        result += `${b.left}${paddingStr}${content}${b.right}\n`;
    }
    
    result += `${b.bottom}${'━'.repeat(titlePadded.length + padding * 2)}${b.bottomRight}`;
    return result;
}

// Function to generate a decorative header
function generateHeader(text) {
    const stars = '✦'.repeat(Math.floor((30 - text.length) / 2));
    return `${stars} *${text}* ${stars}`;
}

// Function to create a fancy line
function fancyLine(length = 40, char = '•') {
    return char.repeat(length);
}

// Function to group commands into columns
function formatCommandsInColumns(commands, prefix, columns = 3) {
    if (!commands || commands.length === 0) return [];
    
    const result = [];
    let line = '';
    let count = 0;
    
    for (const cmd of commands) {
        const cmdText = `${prefix}${cmd}`;
        
        if (count % columns === 0) {
            if (line) result.push(line);
            line = cmdText.padEnd(20, ' ');
        } else {
            line += cmdText.padEnd(20, ' ');
        }
        
        count++;
    }
    
    if (line) result.push(line);
    return result;
}

const menuCommands = {
    async menu(sock, message, args) {
        try {
            const sender = message.key.remoteJid;
            const username = message.pushName || 'User';
            const currentTime = moment().format('HH:mm:ss');
            const currentDate = moment().format('DD/MM/YYYY');
            const uptime = process.uptime();
            const uptimeStr = moment.duration(uptime, 'seconds').humanize();
            
            // Check if category was specified or if "long" mode was requested
            const category = args[0]?.toLowerCase();
            const isLongMode = category === "long" || args.includes("long");
            
            // Get all commands from all files
            const allCommands = {};
            const categories = {
                'owner': '👑 Owner Commands',
                'basic': '⚙️ General',
                'educational': '📚 Educational',
                'fun': '🎮 Fun',
                'group': '👥 Group',
                'media': '📸 Media',
                'nsfw': '🔞 NSFW',
                'reactions': '💫 Reactions',
                'user': '👤 User',
                'utility': '🛠️ Utility'
            };
            
            // Load commands from files
            const commandsPath = path.join(__dirname);
            const commandFiles = await fs.readdir(commandsPath);
            
            for (const file of commandFiles) {
                if (file.endsWith('.js') && file !== 'index.js' && file !== 'menu.js') {
                    try {
                        // Try to load using modern format (module.exports.commands)
                        const moduleData = require(`./${file}`);
                        let commandsObject;
                        let categoryName = file.replace('.js', '');
                        
                        if (moduleData.commands) {
                            // Modern format: { commands: {...}, category: '...', init: ... }
                            commandsObject = moduleData.commands;
                            if (moduleData.category) {
                                categoryName = moduleData.category;
                                logger.info(`Using category "${categoryName}" from module ${file}`);
                            }
                        } else {
                            // Legacy format: direct export of commands object
                            commandsObject = moduleData;
                            logger.warn(`Module ${file} using legacy format without explicit category`);
                        }
                        
                        const commandNames = Object.keys(commandsObject).filter(cmd => 
                            cmd !== 'init' && typeof commandsObject[cmd] === 'function'
                        );
                        
                        if (commandNames.length > 0) {
                            // If this category already exists, merge commands instead of overwriting
                            if (allCommands[categoryName]) {
                                allCommands[categoryName] = [...allCommands[categoryName], ...commandNames];
                                logger.info(`Added ${commandNames.length} commands to existing category "${categoryName}" from ${file}`);
                            } else {
                                allCommands[categoryName] = commandNames;
                                logger.info(`Created new category "${categoryName}" with ${commandNames.length} commands from ${file}`);
                            }
                        }
                    } catch (err) {
                        logger.error(`Error loading commands from ${file}:`, err);
                    }
                }
            }
            
            // If a specific category was requested (and it's not "long")
            if (category && categories[category] && !isLongMode) {
                // Display only the requested category
                const commands = allCommands[category] || [];
                
                if (commands.length === 0) {
                    await sock.sendMessage(sender, {
                        text: `❌ No commands found in category "${category}"`
                    });
                    return;
                }
                
                // Create header for category
                let menuText = `┏━━⟪ *${config.bot.name}* ⟫━━┓\n\n`;
                menuText += `${generateHeader(categories[category])}\n\n`;
                
                // Format commands in a grid
                const formattedCommands = formatCommandsInColumns(commands, config.bot.prefix, 2);
                menuText += formattedCommands.join('\n');
                
                menuText += `\n\n┗━━⟪ *${commands.length} Commands* ⟫━━┛`;
                
                await sock.sendMessage(sender, {
                    text: menuText,
                    quoted: message
                });
                return;
            }
            
            // If long mode was requested, show detailed list of all commands
            if (isLongMode) {
                // Create a comprehensive list of all commands
                let longMenuText = `┏━━⟪ *${config.bot.name} - ALL COMMANDS* ⟫━━┓\n\n`;
                longMenuText += `${themes.info} *User:* ${username}\n`;
                longMenuText += `${themes.info} *Time:* ${currentTime}\n`;
                longMenuText += `${themes.info} *Date:* ${currentDate}\n`;
                longMenuText += `${themes.info} *Uptime:* ${uptimeStr}\n\n`;
                
                // Bot info
                longMenuText += `${generateHeader('BOT INFO')}\n\n`;
                longMenuText += `${themes.primary} *Bot Name:* ${config.bot.name}\n`;
                longMenuText += `${themes.primary} *Version:* ${config.bot.version}\n`;
                longMenuText += `${themes.primary} *Prefix:* ${config.bot.prefix}\n`;
                longMenuText += `${themes.primary} *Language:* ${config.bot.language}\n\n`;
                
                let totalCommands = 0;
                
                // List all categories with their commands
                for (const [cat, commands] of Object.entries(allCommands)) {
                    if (categories[cat] && commands.length > 0) {
                        longMenuText += `${fancyLine(40, '•')}\n`;
                        longMenuText += `${generateHeader(categories[cat])}\n\n`;
                        
                        // List each command on its own line with description if available
                        for (const cmd of commands.sort()) {
                            longMenuText += `${themes.light} ${config.bot.prefix}${cmd}\n`;
                            totalCommands++;
                        }
                        
                        longMenuText += `\n`;
                    }
                }
                
                // Footer
                longMenuText += `${fancyLine(40, '•')}\n`;
                longMenuText += `${themes.info} Total Commands: ${totalCommands}\n`;
                longMenuText += `${themes.info} Use ${config.bot.prefix}help <command> for details\n`;
                longMenuText += `${fancyLine(40, '•')}\n\n`;
                
                // Signature
                longMenuText += `┗━━⟪ *${config.bot.name} ${config.bot.version}* ⟫━━┛`;
                
                await sock.sendMessage(sender, {
                    text: longMenuText,
                    quoted: message
                });
                return;
            }
            
            // Main menu header (default view)
            let menuText = `┏━━━━━━━━━━━━━━━━━━━┓\n`;
            menuText += `┃  *${config.bot.name}*  ┃\n`;
            menuText += `┗━━━━━━━━━━━━━━━━━━━┛\n\n`;
            
            // User info and time
            menuText += `${themes.info} *User:* ${username}\n`;
            menuText += `${themes.info} *Time:* ${currentTime}\n`;
            menuText += `${themes.info} *Date:* ${currentDate}\n`;
            menuText += `${themes.info} *Uptime:* ${uptimeStr}\n\n`;
            
            // Bot info
            menuText += `${generateHeader('BOT INFO')}\n\n`;
            menuText += `${themes.primary} *Bot Name:* ${config.bot.name}\n`;
            menuText += `${themes.primary} *Version:* ${config.bot.version}\n`;
            menuText += `${themes.primary} *Prefix:* ${config.bot.prefix}\n`;
            menuText += `${themes.primary} *Language:* ${config.bot.language}\n\n`;
            
            // Command categories
            menuText += `${generateHeader('COMMAND CATEGORIES')}\n\n`;
            
            // List all categories with command count
            let totalCommands = 0;
            for (const [cat, commands] of Object.entries(allCommands)) {
                if (categories[cat] && commands.length > 0) {
                    menuText += `${themes.secondary} *${categories[cat]}*\n`;
                    menuText += `  └ ${commands.length} commands\n`;
                    menuText += `  └ Type: ${config.bot.prefix}menu ${cat}\n\n`;
                    totalCommands += commands.length;
                }
            }
            
            // Special menu options
            menuText += `${generateHeader('SPECIAL MENU OPTIONS')}\n\n`;
            menuText += `${themes.primary} *${config.bot.prefix}menu long*\n`;
            menuText += `  └ Show all commands in detail\n\n`;
            
            // Footer
            menuText += `${fancyLine(40, '•')}\n`;
            menuText += `${themes.info} Total Commands: ${totalCommands}\n`;
            menuText += `${themes.info} Use ${config.bot.prefix}help <command> for details\n`;
            menuText += `${fancyLine(40, '•')}\n\n`;
            
            // Signature
            menuText += `┏━━━━━━━━━━━━━━━━━━━┓\n`;
            menuText += `┃    Powered by ${config.bot.name}   ┃\n`;
            menuText += `┗━━━━━━━━━━━━━━━━━━━┛`;
            
            await sock.sendMessage(sender, {
                text: menuText,
                quoted: message
            });
            
        } catch (err) {
            logger.error('Error in menu command:', err);
            throw err;
        }
    },

    async help(sock, message, args) {
        try {
            const commandName = args[0];
            const sender = message.key.remoteJid;
            const username = message.pushName || 'User';

            if (!commandName) {
                // Pretty help message with instructions
                let helpText = `┏━━⟪ *HELP MENU* ⟫━━┓\n\n`;
                helpText += `Hello ${username}! 👋\n\n`;
                helpText += `${themes.info} To see all commands:\n`;
                helpText += `  └ Type ${config.bot.prefix}menu\n\n`;
                helpText += `${themes.info} To see commands by category:\n`;
                helpText += `  └ Type ${config.bot.prefix}menu <category>\n\n`;
                helpText += `${themes.info} To get help for a specific command:\n`;
                helpText += `  └ Type ${config.bot.prefix}help <command>\n\n`;
                helpText += `┗━━⟪ *${config.bot.name}* ⟫━━┛`;
                
                await sock.sendMessage(sender, {
                    text: helpText,
                    quoted: message
                });
                return;
            }

            // Find the command in all command files
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
                            // Modern format: { commands: {...}, category: '...', init: ... }
                            commandsObject = moduleData.commands;
                            if (commandsObject[commandName] && typeof commandsObject[commandName] === 'function') {
                                foundCommand = commandsObject[commandName];
                                // Use the category from the module if available
                                foundIn = moduleData.category || file.replace('.js', '');
                                logger.info(`Found command "${commandName}" in category "${foundIn}"`);
                                break;
                            }
                        } else {
                            // Legacy format: direct export of commands object
                            commandsObject = moduleData;
                            if (commandsObject[commandName] && typeof commandsObject[commandName] === 'function') {
                                foundCommand = commandsObject[commandName];
                                foundIn = file.replace('.js', '');
                                logger.info(`Found command "${commandName}" in legacy module "${file}"`);
                                break;
                            }
                        }
                    } catch (loadErr) {
                        logger.error(`Error loading ${file} for help command:`, loadErr);
                    }
                }
            }

            if (foundCommand) {
                const cmdConfig = foundCommand.config || {};
                
                // Beautifully formatted help message
                let helpText = `┏━━⟪ *COMMAND INFO* ⟫━━┓\n\n`;
                helpText += `${themes.primary} *Command:* ${commandName}\n`;
                helpText += `${themes.secondary} *Category:* ${foundIn}\n`;
                helpText += `${themes.info} *Description:* ${cmdConfig.description || 'No description available'}\n\n`;
                
                // Usage section
                helpText += `${generateHeader('USAGE')}\n\n`;
                helpText += `${themes.success} ${cmdConfig.usage || `${config.bot.prefix}${commandName}`}\n\n`;
                
                // Examples section if available
                if (cmdConfig.examples && cmdConfig.examples.length > 0) {
                    helpText += `${generateHeader('EXAMPLES')}\n\n`;
                    cmdConfig.examples.forEach((example, index) => {
                        helpText += `${themes.light} ${index + 1}. ${example}\n`;
                    });
                    helpText += '\n';
                }
                
                // Permissions if available
                if (cmdConfig.permissions && cmdConfig.permissions.length > 0) {
                    helpText += `${generateHeader('PERMISSIONS')}\n\n`;
                    helpText += `${themes.warning} Required: ${cmdConfig.permissions.join(', ')}\n\n`;
                }
                
                // Footer
                helpText += `┗━━⟪ *${config.bot.name}* ⟫━━┛`;

                await sock.sendMessage(sender, { 
                    text: helpText,
                    quoted: message
                });
            } else {
                // Error message when command not found
                let errorText = `┏━━⟪ *COMMAND NOT FOUND* ⟫━━┓\n\n`;
                errorText += `${themes.danger} Command "${commandName}" not found.\n\n`;
                errorText += `${themes.info} Use ${config.bot.prefix}menu to see all available commands.\n\n`;
                errorText += `┗━━⟪ *${config.bot.name}* ⟫━━┛`;
                
                await sock.sendMessage(sender, {
                    text: errorText,
                    quoted: message
                });
            }

        } catch (err) {
            logger.error('Error in help command:', err);
            throw err;
        }
    }
};

module.exports = {
    commands: menuCommands,
    category: 'menu',
    async init() {
        try {
            logger.moduleInit('Menu');
            logger.moduleSuccess('Menu');
            return true;
        } catch (err) {
            logger.error('Menu module initialization error:', err);
            return false;
        }
    }
};