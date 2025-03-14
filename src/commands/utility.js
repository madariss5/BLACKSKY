const logger = require('../utils/logger');
const config = require('../config/config');
const { languageManager } = require('../utils/language');
const axios = require('axios');

const utilityCommands = {
const { safeSendText, safeSendMessage, safeSendImage } = require('../utils/jidHelper');
    async weather(sock, sender, args) {
        try {
            const city = args.join(' ');
            if (!city) {
                await safeSendText(sock, sender, 'Please provide a city name' );
                return;
            }

            const API_KEY = process.env.OPENWEATHER_API_KEY;
            if (!API_KEY) {
                logger.error('OpenWeather API key not found');
                await safeSendText(sock, sender, 'Weather service is currently unavailable' );
                return;
            }

            const response = await axios.get(
                `http://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`
            );

            const weather = response.data;
            const message = `Weather in ${weather.name}:
🌡️ Temperature: ${weather.main.temp}°C
💧 Humidity: ${weather.main.humidity}%
🌪️ Wind: ${weather.wind.speed} m/s
☁️ Conditions: ${weather.weather[0].description}`;

            await safeSendText(sock, sender, message );
        } catch (err) {
            logger.error('Weather command error:', err);
            await safeSendText(sock, sender, 'Error fetching weather data. Please try again later.' );
        }
    },

    async translate(sock, sender, args) {
        try {
            const [from, to, ...text] = args;
            if (!from || !to || text.length === 0) {
                await safeSendText(sock, sender, 'Usage: !translate [from] [to] [text]\nExample: !translate en es Hello' 
                );
                return;
            }

            const API_KEY = process.env.TRANSLATION_API_KEY;
            if (!API_KEY) {
                logger.error('Translation API key not found');
                await safeSendText(sock, sender, 'Translation service is currently unavailable' );
                return;
            }

            // Using a mock translation for now - implement actual API later
            const translatedText = `Translated text will appear here (${from} -> ${to}): ${text.join(' ')}`;
            await safeSendText(sock, sender, translatedText );
        } catch (err) {
            logger.error('Translation error:', err);
            await safeSendText(sock, sender, 'Error during translation. Please try again later.' );
        }
    },

    async calculate(sock, sender, args) {
        try {
            const expression = args.join(' ');
            if (!expression) {
                await safeSendText(sock, sender, '⚠️ Please provide a mathematical expression\nExample: .calculate 2 + 2 * 3' );
                return;
            }

            // Enhanced sanitization and validation
            if (expression.length > 100) {
                await safeSendText(sock, sender, '❌ Expression too long. Maximum 100 characters allowed.' );
                return;
            }

            // Block dangerous expressions
            const blockedPatterns = [
                'require', 'import', 'eval', 'process', 'global',
                '__', 'constructor', 'prototype', 'window', 'document'
            ];

            if (blockedPatterns.some(pattern => expression.toLowerCase().includes(pattern))) {
                await safeSendText(sock, sender, '❌ Invalid expression. Only mathematical operations are allowed.' );
                return;
            }

            const sanitized = expression
                .replace(/[^0-9+\-*/(). ]/g, '')
                .replace(/\/{2,}/g, '/') 
                .replace(/\*{2,}/g, '*'); 

            if (sanitized.includes('..')) {
                throw new Error('Invalid expression');
            }

            // Use a safer evaluation method
            const result = new Function(`return ${sanitized}`)();

            if (isNaN(result) || !isFinite(result)) {
                await safeSendText(sock, sender, '❌ Invalid result. Please check your expression.' );
                return;
            }

            await sock.sendMessage(sender, { 
                text: `🧮 ${expression} = ${Number(result.toFixed(8))}` 
            });
        } catch (err) {
            logger.error('Calculate command error:', err);
            await safeSendText(sock, sender, '❌ Invalid expression. Please provide a valid mathematical expression.' 
            );
        }
    },

    async dictionary(sock, sender, args) {
        try {
            const word = args[0];
            if (!word) {
                await safeSendText(sock, sender, 'Please provide a word to look up' );
                return;
            }

            const API_KEY = process.env.DICTIONARY_API_KEY;
            if (!API_KEY) {
                logger.error('Dictionary API key not found');
                await safeSendText(sock, sender, 'Dictionary service is currently unavailable' );
                return;
            }

            // Mock dictionary response - implement actual API later
            const definition = `Definition for ${word} will appear here`;
            await safeSendText(sock, sender, definition );
        } catch (err) {
            logger.error('Dictionary lookup error:', err);
            await safeSendText(sock, sender, 'Error looking up word. Please try again later.' );
        }
    },
    async covid(sock, sender, args) {
        const country = args.join(' ') || 'World';
        // TODO: Implement COVID-19 statistics API integration
        await sock.sendMessage(sender, { text: `Getting COVID-19 stats for ${country}...` });
    },

    async currency(sock, sender, args) {
        const [amount, from, to] = args;
        if (!amount || !from || !to) {
            await safeSendText(sock, sender, 'Usage: !currency [amount] [from] [to]\nExample: !currency 100 USD EUR' 
            );
            return;
        }
        // TODO: Implement currency conversion
        await safeSendText(sock, sender, 'Converting currency...' );
    },

    async shortlink(sock, sender, args) {
        const url = args[0];
        if (!url) {
            await safeSendText(sock, sender, 'Please provide a URL to shorten' );
            return;
        }
        // TODO: Implement URL shortening
        await safeSendText(sock, sender, 'Shortening URL...' );
    },

    async wiki(sock, sender, args) {
        const query = args.join(' ');
        if (!query) {
            await safeSendText(sock, sender, 'Please provide a search term' );
            return;
        }
        // TODO: Implement Wikipedia API integration
        await sock.sendMessage(sender, { text: `Searching Wikipedia for: ${query}` });
    },

    async poll(sock, sender, args) {
        const [question, ...options] = args.join(' ').split('|').map(item => item.trim());
        if (!question || options.length < 2) {
            await safeSendText(sock, sender, 'Usage: !poll Question | Option1 | Option2 | ...' 
            );
            return;
        }
        const pollText = `📊 Poll: ${question}\n\n${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}`;
        await safeSendText(sock, sender, pollText );
    },

    async news(sock, sender, args) {
        const category = args[0] || 'general';
        // TODO: Implement news API integration
        await sock.sendMessage(sender, { text: `Getting ${category} news...` });
    },

    async timezone(sock, sender, args) {
        const location = args.join(' ');
        if (!location) {
            await safeSendText(sock, sender, 'Please provide a city or country' );
            return;
        }
        // TODO: Implement timezone API integration
        await sock.sendMessage(sender, { text: `Getting time for ${location}...` });
    },

    async encode(sock, sender, args) {
        try {
            const [type, ...text] = args;
            if (!type || text.length === 0) {
                await safeSendText(sock, sender, '⚠️ Usage: .encode [type] [text]\nTypes: base64, hex, binary\nExample: .encode base64 Hello World' 
                );
                return;
            }

            const input = text.join(' ');
            if (input.length > 1000) {
                await safeSendText(sock, sender, '❌ Text too long. Maximum 1000 characters allowed.' );
                return;
            }

            let result;
            switch (type.toLowerCase()) {
                case 'base64':
                    result = Buffer.from(input).toString('base64');
                    break;
                case 'hex':
                    result = Buffer.from(input).toString('hex');
                    break;
                case 'binary':
                    result = input.split('').map(char => 
                        char.charCodeAt(0).toString(2).padStart(8, '0')
                    ).join(' ');
                    break;
                default:
                    await safeSendText(sock, sender, '❌ Invalid encoding type. Available types: base64, hex, binary' 
                    );
                    return;
            }

            await safeSendText(sock, sender, `🔄 Encoded (${type):\n${result}` });
        } catch (err) {
            logger.error('Encode command error:', err);
            await safeSendText(sock, sender, '❌ Error encoding text. Please try again.' );
        }
    },

    async decode(sock, sender, args) {
        try {
            const [type, ...text] = args;
            if (!type || text.length === 0) {
                await safeSendText(sock, sender, '⚠️ Usage: .decode [type] [text]\nTypes: base64, hex, binary\nExample: .decode base64 SGVsbG8gV29ybGQ=' 
                );
                return;
            }

            const input = text.join(' ');
            if (input.length > 1000) {
                await safeSendText(sock, sender, '❌ Text too long. Maximum 1000 characters allowed.' );
                return;
            }

            let result;
            switch (type.toLowerCase()) {
                case 'base64':
                    if (!/^[A-Za-z0-9+/=]+$/.test(input)) {
                        throw new Error('Invalid base64 input');
                    }
                    result = Buffer.from(input, 'base64').toString();
                    break;
                case 'hex':
                    if (!/^[0-9A-Fa-f]+$/.test(input)) {
                        throw new Error('Invalid hex input');
                    }
                    result = Buffer.from(input, 'hex').toString();
                    break;
                case 'binary':
                    if (!/^[01\s]+$/.test(input)) {
                        throw new Error('Invalid binary input');
                    }
                    result = input.split(' ')
                        .map(bin => String.fromCharCode(parseInt(bin, 2)))
                        .join('');
                    break;
                default:
                    await safeSendText(sock, sender, '❌ Invalid decoding type. Available types: base64, hex, binary' 
                    );
                    return;
            }

            await sock.sendMessage(sender, { text: `🔄 Decoded: ${result}` });
        } catch (err) {
            logger.error('Decode command error:', err);
            await safeSendText(sock, sender, '❌ Invalid input for decoding. Please check your input format and try again.' 
            );
        }
    },

    async qrread(sock, sender) {
        // TODO: Implement QR code reading from image
        await safeSendText(sock, sender, 'QR code reading feature coming soon!' );
    },

    async wolfram(sock, sender, args) {
        const query = args.join(' ');
        if (!query) {
            await safeSendText(sock, sender, 'Please provide a query' );
            return;
        }
        // TODO: Implement Wolfram Alpha API integration
        await sock.sendMessage(sender, { text: `Querying Wolfram Alpha: ${query}` });
    },

    async github(sock, sender, args) {
        const query = args.join(' ');
        if (!query) {
            await safeSendText(sock, sender, 'Please provide a search term' );
            return;
        }
        // TODO: Implement GitHub API integration
        await sock.sendMessage(sender, { text: `Searching GitHub for: ${query}` });
    },

    async npm(sock, sender, args) {
        const packageName = args[0];
        if (!packageName) {
            await safeSendText(sock, sender, 'Please provide a package name' );
            return;
        }
        // TODO: Implement NPM API integration
        await sock.sendMessage(sender, { text: `Searching NPM for: ${packageName}` });
    },

    async ipinfo(sock, sender, args) {
        const ip = args[0] || 'self';
        // TODO: Implement IP information API integration
        await sock.sendMessage(sender, { text: `Getting information for IP: ${ip}` });
    },

    async whois(sock, sender, args) {
        const domain = args[0];
        if (!domain) {
            await safeSendText(sock, sender, 'Please provide a domain name' );
            return;
        }
        // TODO: Implement WHOIS lookup
        await sock.sendMessage(sender, { text: `Looking up WHOIS for: ${domain}` });
    },
    async ocr(sock, sender) {
        // TODO: Implement optical character recognition
        await safeSendText(sock, sender, 'OCR feature coming soon!' );
    },

    async qrgen(sock, sender, args) {
        const text = args.join(' ');
        if (!text) {
            await safeSendText(sock, sender, 'Please provide text to generate QR code' );
            return;
        }
        // TODO: Implement QR code generation
        await safeSendText(sock, sender, 'Generating QR code...' );
    },

    async screenshot(sock, sender, args) {
        const url = args[0];
        if (!url) {
            await safeSendText(sock, sender, 'Please provide a URL to screenshot' );
            return;
        }
        // TODO: Implement website screenshot
        await safeSendText(sock, sender, 'Taking screenshot...' );
    },

    async color(sock, sender, args) {
        const colorCode = args[0];
        if (!colorCode) {
            await safeSendText(sock, sender, 'Please provide a color code (hex/rgb)' );
            return;
        }
        // TODO: Implement color information
        await safeSendText(sock, sender, 'Getting color information...' );
    },

    async lyrics(sock, sender, args) {
        const song = args.join(' ');
        if (!song) {
            await safeSendText(sock, sender, 'Please provide a song name' );
            return;
        }
        // TODO: Implement lyrics search
        await safeSendText(sock, sender, 'Searching lyrics...' );
    },

    async movie(sock, sender, args) {
        const title = args.join(' ');
        if (!title) {
            await safeSendText(sock, sender, 'Please provide a movie title' );
            return;
        }
        // TODO: Implement movie information search
        await safeSendText(sock, sender, 'Searching movie info...' );
    },

    async anime(sock, sender, args) {
        const title = args.join(' ');
        if (!title) {
            await safeSendText(sock, sender, 'Please provide an anime title' );
            return;
        }
        // TODO: Implement anime information search
        await safeSendText(sock, sender, 'Searching anime info...' );
    },

    async spotify(sock, sender, args) {
        const track = args.join(' ');
        if (!track) {
            await safeSendText(sock, sender, 'Please provide a track name' );
            return;
        }
        // TODO: Implement Spotify track search
        await safeSendText(sock, sender, 'Searching Spotify...' );
    },

    async urban(sock, sender, args) {
        const term = args.join(' ');
        if (!term) {
            await safeSendText(sock, sender, 'Please provide a term to look up' );
            return;
        }
        // TODO: Implement Urban Dictionary lookup
        await safeSendText(sock, sender, 'Searching Urban Dictionary...' );
    },

    async crypto(sock, sender, args) {
        const coin = args[0]?.toLowerCase() || 'bitcoin';
        // TODO: Implement cryptocurrency price check
        await sock.sendMessage(sender, { text: `Getting ${coin} price...` });
    },

    async stocks(sock, sender, args) {
        const symbol = args[0]?.toUpperCase();
        if (!symbol) {
            await safeSendText(sock, sender, 'Please provide a stock symbol' );
            return;
        }
        // TODO: Implement stock price check
        await sock.sendMessage(sender, { text: `Getting ${symbol} stock price...` });
    },

    async reminder(sock, sender, args) {
        if (args.length < 2) {
            await safeSendText(sock, sender, 'Usage: !reminder [time] [message]\nExample: !reminder 30m Check laundry' 
            );
            return;
        }
        // TODO: Implement reminder system
        await safeSendText(sock, sender, 'Setting reminder...' );
    },

    async countdown(sock, sender, args) {
        const event = args.join(' ');
        if (!event) {
            await safeSendText(sock, sender, 'Please provide an event name and date' );
            return;
        }
        // TODO: Implement countdown timer
        await safeSendText(sock, sender, 'Starting countdown...' );
    },

    async poll2(sock, sender, args) {
        const [question, ...options] = args.join(' ').split('|');
        if (!question || options.length < 2) {
            await safeSendText(sock, sender, 'Usage: !poll Question | Option1 | Option2 | ...' 
            );
            return;
        }
        // TODO: Implement poll creation
        await safeSendText(sock, sender, 'Creating poll...' );
    },

    async todo(sock, sender, args) {
        const [action, ...item] = args;
        if (!action || !['add', 'remove', 'list'].includes(action)) {
            await safeSendText(sock, sender, 'Usage: !todo <add|remove|list> [item]' 
            );
            return;
        }
        // TODO: Implement todo list
        await safeSendText(sock, sender, 'Managing todo list...' );
    },

    async notes(sock, sender, args) {
        const [action, ...content] = args;
        if (!action || !['add', 'view', 'delete'].includes(action)) {
            await safeSendText(sock, sender, 'Usage: !notes <add|view|delete> [content]' 
            );
            return;
        }
        // TODO: Implement notes system
        await safeSendText(sock, sender, 'Managing notes...' );
    },

    async reverse(sock, sender, args) {
        try {
            const text = args.join(' ');
            if (!text) {
                await safeSendText(sock, sender, '⚠️ Please provide text to reverse' );
                return;
            }

            const reversed = text.split('').reverse().join('');
            await sock.sendMessage(sender, { text: `🔄 ${reversed}` });
        } catch (err) {
            logger.error('Reverse command error:', err);
            await safeSendText(sock, sender, '❌ Error reversing text' );
        }
    },

    async mock(sock, sender, args) {
        try {
            const text = args.join(' ');
            if (!text) {
                await safeSendText(sock, sender, '⚠️ Please provide text to mock' );
                return;
            }

            const mocked = text
                .toLowerCase()
                .split('')
                .map((char, i) => i % 2 === 0 ? char : char.toUpperCase())
                .join('');

            await sock.sendMessage(sender, { text: `🔡 ${mocked}` });
        } catch (err) {
            logger.error('Mock command error:', err);
            await safeSendText(sock, sender, '❌ Error mocking text' );
        }
    },

    async roll(sock, sender, args) {
        try {
            const sides = parseInt(args[0]) || 6;
            if (sides < 2 || sides > 100) {
                await safeSendText(sock, sender, '⚠️ Please specify a number of sides between 2 and 100' 
                );
                return;
            }

            const result = Math.floor(Math.random() * sides) + 1;
            await sock.sendMessage(sender, { 
                text: `🎲 You rolled a ${result} (d${sides})` 
            });
        } catch (err) {
            logger.error('Roll command error:', err);
            await safeSendText(sock, sender, '❌ Error rolling dice' );
        }
    },

    async flip(sock, sender) {
        try {
            const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
            const emoji = result === 'Heads' ? '🪙' : '💫';
            await sock.sendMessage(sender, { 
                text: `${emoji} Coin flip: ${result}!` 
            });
        } catch (err) {
            logger.error('Flip command error:', err);
            await safeSendText(sock, sender, '❌ Error flipping coin' );
        }
    },

    async choose(sock, sender, args) {
        try {
            const options = args.join(' ').split('|').map(opt => opt.trim()).filter(Boolean);
            if (options.length < 2) {
                await safeSendText(sock, sender, '⚠️ Please provide at least 2 options separated by |\nExample: .choose pizza | burger | salad' 
                );
                return;
            }

            const choice = options[Math.floor(Math.random() * options.length)];
            await sock.sendMessage(sender, { 
                text: `🎯 I choose: ${choice}\n\nOptions were:\n${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}` 
            });
        } catch (err) {
            logger.error('Choose command error:', err);
            await safeSendText(sock, sender, '❌ Error making a choice' );
        }
    },

    async wordcount(sock, sender, args) {
        try {
            const text = args.join(' ');
            if (!text) {
                await safeSendText(sock, sender, '⚠️ Please provide text to count' );
                return;
            }

            const words = text.trim().split(/\s+/).length;
            const chars = text.length;
            const chars_no_space = text.replace(/\s+/g, '').length;

            const message = `📊 Word Count:
• Words: ${words}
• Characters (with spaces): ${chars}
• Characters (no spaces): ${chars_no_space}`;

            await safeSendText(sock, sender, message );
        } catch (err) {
            logger.error('Word count command error:', err);
            await safeSendText(sock, sender, '❌ Error counting words' );
        }
    },

    async random(sock, sender, args) {
        try {
            let [min = 1, max = 100] = args.map(Number);

            if (isNaN(min) || isNaN(max) || min >= max || min < -1000000 || max > 1000000) {
                await safeSendText(sock, sender, '⚠️ Please provide valid numbers between -1000000 and 1000000\nExample: .random 1 100' 
                );
                return;
            }

            min = Math.ceil(min);
            max = Math.floor(max);
            [min, max] = [Math.min(min, max), Math.max(min, max)];

            const result = Math.floor(Math.random() * (max - min + 1)) + min;
            await sock.sendMessage(sender, { 
                text: `🎲 Random number between ${min} and ${max}: ${result}` 
            });
        } catch (err) {
            logger.error('Random command error:', err);
            await safeSendText(sock, sender, '❌ Error generating random number' );
        }
    },

    async time(sock, sender) {
        try {
            const now = new Date();
            const timeString = now.toLocaleTimeString();
            const dateString = now.toLocaleDateString();
            const utc = now.toUTCString();
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

            const message = `🕒 Current Time Information:
• Local Time: ${timeString}
• Date: ${dateString}
• UTC: ${utc}
• Timezone: ${timezone}
• Unix Timestamp: ${Math.floor(now.getTime() / 1000)}
• Week Day: ${now.toLocaleDateString('en-US', { weekday: 'long' })}
• Week Number: ${Math.ceil((((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + 1) / 7)}`;

            await safeSendText(sock, sender, message );
        } catch (err) {
            logger.error('Time command error:', err);
            await safeSendText(sock, sender, '❌ Error getting current time' );
        }
    },

    async case(sock, sender, args) {
        try {
            const [type, ...text] = args;
            if (!type || !text.length) {
                await safeSendText(sock, sender, '⚠️ Usage: .case <upper|lower> [text]' 
                );
                return;
            }

            const input = text.join(' ');
            let result;

            switch (type.toLowerCase()) {
                case 'upper':
                    result = input.toUpperCase();
                    break;
                case 'lower':
                    result = input.toLowerCase();
                    break;
                default:
                    await safeSendText(sock, sender, '❌ Invalid case type. Use "upper" or "lower"' );
                    return;
            }

            await sock.sendMessage(sender, { text: `🔡 ${result}` });
        } catch (err) {
            logger.error('Case command error:', err);
            await safeSendText(sock, sender, '❌ Error converting case' );
        }
    },
    
    async language(sock, sender, args) {
        try {
            // Import required modules
            const userDatabase = require('../utils/userDatabase');
            
            // If no arguments, show available languages
            if (!args.length) {
                const availableLangs = languageManager.getAvailableLanguages();
                const userProfile = userDatabase.getUserProfile(sender);
                const currentLang = userProfile ? userProfile.language || 'en' : 'en';
                
                console.log(`Current user ${sender} profile:`, userProfile);
                console.log(`Current language for user ${sender}: ${currentLang}`);
                
                await sock.sendMessage(sender, { 
                    text: `🌐 *Language Settings*\n\n` +
                          `Current language: ${currentLang}\n` +
                          `Available languages: ${availableLangs.join(', ')}\n\n` +
                          `To change your language, use:\n.language [code]` 
                });
                return;
            }
            
            // Get the requested language
            const lang = args[0].toLowerCase();
            console.log(`User ${sender} requested language change to: ${lang}`);
            
            // Check if language is supported
            if (!languageManager.isLanguageSupported(lang)) {
                const availableLangs = languageManager.getAvailableLanguages().join(', ');
                console.log(`Language ${lang} is not supported. Available: ${availableLangs}`);
                await sock.sendMessage(sender, { 
                    text: `❌ Language '${lang}' is not supported.\nAvailable languages: ${availableLangs}` 
                });
                return;
            }
            
            // Update user's preferred language in the database
            let profile = userDatabase.getUserProfile(sender);
            console.log(`Current profile before update:`, profile);
            
            if (!profile) {
                profile = { id: sender, language: lang };
                console.log(`Creating new profile for user ${sender} with language ${lang}`);
            } else {
                profile.language = lang;
                console.log(`Updating existing profile for user ${sender} with language ${lang}`);
            }
            
            userDatabase.updateUserProfile(sender, profile);
            console.log(`Profile after update:`, userDatabase.getUserProfile(sender));
            
            // Get the translated response from the language manager
            // This will automatically use the selected language
            const translatedMessage = languageManager.getText('system.language_changed', lang);
            
            // Add checkmark emoji and use translated message
            let responseText = `✅ ${translatedMessage}`;
            
            // Log translation retrieval information
            console.log(`Retrieved translation for 'system.language_changed' in language ${lang}: "${translatedMessage}"`);
            
            // If the translation failed (returned the key itself), use hardcoded fallback
            if (translatedMessage === 'system.language_changed') {
                console.warn(`Translation not found for key 'system.language_changed' in language ${lang}`);
                if (lang === 'de') {
                    responseText = "✅ Sprache wurde zu Deutsch geändert";
                } else if (lang === 'en') {
                    responseText = "✅ Language has been changed to English";
                } else {
                    responseText = `✅ Language changed to ${lang}`;
                }
                console.log(`Using fallback message: "${responseText}"`);
            }
            
            await safeSendText(sock, sender, responseText );
            console.log(`User ${sender} changed language to: ${lang}`);
        } catch (err) {
            console.error('Language command error:', err);
            await safeSendText(sock, sender, '❌ Error changing language. Please try again.' );
        }
    }

};

module.exports = {
    commands: utilityCommands,
    category: 'utility',
    async init() {
        try {
            logger.info('Initializing utility commands...');
            return true;
        } catch (error) {
            logger.error('Failed to initialize utility commands:', error);
            return false;
        }
    }
};