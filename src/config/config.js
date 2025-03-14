const config = {
    // Bot Owner Info
    owner: {
        name: process.env.OWNER_NAME || 'Bot Owner',  
        // ============================================
        // Number format: Country code + number (no spaces/symbols)
        // Example: 4915561048015
        // ============================================
        number: process.env.OWNER_NUMBER ? 
            process.env.OWNER_NUMBER.replace(/[^0-9]/g, '') : 
            '4915561048015',
        email: process.env.OWNER_EMAIL || '',
    },

    // Session Configuration
    session: {
        id: process.env.SESSION_ID || 'whatsapp-bot',
        authDir: './auth_info_qr',
        backupDir: './sessions',
    },

    // Bot Configuration
    bot: {
        name: process.env.BOT_NAME || '𝔹𝕃𝔸ℂ𝕂𝕊𝕂𝕐-𝕄𝔻',
        version: process.env.BOT_VERSION || '1.0.0',
        prefix: process.env.BOT_PREFIX || '!', // Changed default to ! to match owner commands
        language: process.env.BOT_LANGUAGE || 'en',
        debug: process.env.NODE_ENV !== 'production',
    },

    // Server Configuration
    server: {
        port: process.env.PORT || 5000,
        host: '0.0.0.0',
    },

    // API Keys
    // ============================================
    // Um API-Keys zu konfigurieren:
    // 1. Erstellen Sie eine .env Datei im Hauptverzeichnis
    // 2. Fügen Sie die API-Keys im Format API_NAME=api_key_wert hinzu
    // 3. Oder fügen Sie direkt hier Ihren API-Key ein (nicht empfohlen für öffentliche Repositorys)
    // ============================================
    apis: {
        // Wetter-API (https://openweathermap.org/api)
        openweather: process.env.OPENWEATHERMAP_API_KEY || '',
        
        // Google-APIs (https://console.cloud.google.com/)
        google: process.env.GOOGLE_API_KEY || '',
        googleSearch: process.env.GOOGLE_SEARCH_API_KEY || '',
        googleTranslate: process.env.GOOGLE_TRANSLATE_API_KEY || '',
        googleMaps: process.env.GOOGLE_MAPS_API_KEY || '',
        youtube: process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || '',
        
        // Bild-Verarbeitung APIs
        removebg: process.env.REMOVEBG_API_KEY || '', // (https://www.remove.bg/api)
        imageEnhance: process.env.IMAGE_ENHANCE_API_KEY || '',
        
        // Wissens-APIs
        wolfram: process.env.WOLFRAM_APP_ID || '', // (https://products.wolframalpha.com/api/)
        dictionary: process.env.DICTIONARY_API_KEY || '',
        
        // News & Informations-APIs
        news: process.env.NEWS_API_KEY || '', // (https://newsapi.org/)
        weather: process.env.WEATHER_API_KEY || process.env.OPENWEATHERMAP_API_KEY || '',
        
        // Musik-APIs
        spotify: {
            clientId: process.env.SPOTIFY_CLIENT_ID || '',
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
        },
        
        // Währungen & Finanzen
        currencyConverter: process.env.CURRENCY_API_KEY || '',
        financialData: process.env.FINANCIAL_API_KEY || '',
        
        // Text & Sprach-APIs
        rapidapi: process.env.RAPIDAPI_KEY || '',
        
        // Übersetzen
        deepl: process.env.DEEPL_API_KEY || '',
        
        // Social Media APIs
        twitter: {
            apiKey: process.env.TWITTER_API_KEY || '',
            apiSecret: process.env.TWITTER_API_SECRET || '',
            bearerToken: process.env.TWITTER_BEARER_TOKEN || '',
        },
        
        // Anime & Manga APIs
        anilist: process.env.ANILIST_API_KEY || '',
        
        // Gaming APIs
        steam: process.env.STEAM_API_KEY || '',
        
        // Chat & KI APIs
        openai: process.env.OPENAI_API_KEY || '',
        
        // Film & TV
        tmdb: process.env.TMDB_API_KEY || '', // The Movie Database (https://www.themoviedb.org/documentation/api)
        
        // Eigene APIs hinzufügen
        // custom1: process.env.CUSTOM1_API_KEY || '',
        // custom2: process.env.CUSTOM2_API_KEY || '',
        
        // Hilfsmethode zum dynamischen Abrufen von API-Keys
        getKey: function(name) {
            // Versuche zuerst, den Key direkt zu finden
            if (this[name] !== undefined) return this[name];
            
            // Durchsuche verschachtelte Objekte
            for (const key in this) {
                if (typeof this[key] === 'object' && this[key] !== null) {
                    if (this[key][name] !== undefined) return this[key][name];
                }
            }
            
            // Falls der Key nicht gefunden wurde, kehre einen leeren String zurück
            return '';
        }
    },

    // Validation function for required environment variables
    validateConfig: () => {
        const missingVars = [];
        const warnings = [];
        const recommendedApis = [
            'OPENWEATHERMAP_API_KEY',
            'GOOGLE_API_KEY',
            'YOUTUBE_API_KEY', 
            'NEWS_API_KEY',
            'SPOTIFY_CLIENT_ID', 
            'SPOTIFY_CLIENT_SECRET'
        ];

        // Check required variables
        if (!process.env.OWNER_NUMBER) {
            console.warn('⚠️ OWNER_NUMBER not set in environment. Using default from config.js');
            console.warn('Format: Country code + number without any special characters');
            console.warn('Example: For +1 (234) 567-8900, set OWNER_NUMBER=12345678900');
        }
        if (!process.env.SESSION_ID) missingVars.push('SESSION_ID');

        // Additional validation for owner number format
        if (process.env.OWNER_NUMBER) {
            const cleanNumber = process.env.OWNER_NUMBER.replace(/[^0-9]/g, '');
            if (!cleanNumber.match(/^\d+$/)) {
                missingVars.push('OWNER_NUMBER (invalid format)');
                console.error('Invalid OWNER_NUMBER format. Please provide only numbers including country code (e.g., 12345678900)');
            }
        }

        // Check recommended API keys
        recommendedApis.forEach(api => {
            if (!process.env[api]) {
                warnings.push(api);
            }
        });

        // Log warnings for missing recommended API keys
        if (warnings.length > 0) {
            console.warn('⚠️ Some recommended API keys are missing:');
            warnings.forEach(api => {
                console.warn(`   - ${api}: Required for certain features`);
            });
            console.warn('You can set these in your .env file to enable full functionality.');
            console.warn('Format: API_NAME=your_api_key_here');
        }

        // Provide API setup guidance
        console.info('ℹ️ API Key Configuration Guide:');
        console.info('1. Create a .env file in the main directory');
        console.info('2. Add your API keys in the format: API_NAME=your_api_key');
        console.info('3. For example:');
        console.info('   OPENWEATHERMAP_API_KEY=abcdef123456');
        console.info('   GOOGLE_API_KEY=xyz987654321');
        console.info('4. You can also directly edit the apis section in src/config/config.js');
        console.info('5. Do not share your .env file or commit it to public repositories');

        // Show available API slots
        console.info('📌 Available API slots:');
        console.info('- Weather: OPENWEATHERMAP_API_KEY');
        console.info('- Google Services: GOOGLE_API_KEY, GOOGLE_TRANSLATE_API_KEY, etc.');
        console.info('- YouTube: YOUTUBE_API_KEY');
        console.info('- Music: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET');
        console.info('- News: NEWS_API_KEY');
        console.info('- AI: OPENAI_API_KEY');
        console.info('- And many more as listed in the apis section of config.js');

        return {
            isValid: missingVars.length === 0,
            missingVars,
            warnings
        };
    },
    settings: {
        autoRead: true,
        autoTyping: true,
        autoRecord: false,
        backupInterval: 6 * 60 * 60 * 1000, // 6 hours
        keepAlive: process.env.NODE_ENV === 'production',
        retryOnDisconnect: true,
        maxRetries: 5,
        retryDelay: 5000,
        logLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        preventSleep: process.env.NODE_ENV === 'production',
        connectionTimeout: 60000, // 1 minute
        queryTimeout: 60000, // 1 minute
        reconnectInterval: 5000 // 5 seconds
    }
};

module.exports = config;