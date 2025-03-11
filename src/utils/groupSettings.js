const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');

/**
 * Get settings for a specific group
 * @param {string} jid Group JID
 * @returns {Promise<Object>} Group settings
 */
async function getGroupSettings(jid) {
    const filePath = path.join(__dirname, '../../data/groups', `${jid}.json`);
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            // Return default settings if file doesn't exist
            return {
                warnings: {},
                antispam: false,
                antilink: false,
                antitoxic: false,
                antiraid: false,
                raidThreshold: 5,
                polls: {},
                scheduled: [],
                features: {
                    leveling: true,
                    welcome: true,
                    goodbye: true,
                    nsfw: false,
                    games: true,
                    economy: true,
                    reactions: true,
                    media: true
                }
            };
        }
        logger.error(`Failed to read group settings for ${jid}:`, err);
        throw err;
    }
}

/**
 * Save settings for a specific group
 * @param {string} jid Group JID
 * @param {Object} settings Group settings
 */
async function saveGroupSettings(jid, settings) {
    const filePath = path.join(__dirname, '../../data/groups', `${jid}.json`);
    try {
        await fs.writeFile(filePath, JSON.stringify(settings, null, 2));
    } catch (err) {
        logger.error(`Failed to save group settings for ${jid}:`, err);
        throw err;
    }
}

/**
 * Validate group settings object
 * @param {Object} settings Group settings
 * @returns {boolean} Whether settings are valid
 */
function validateGroupSettings(settings) {
    // Check if required properties exist and have correct types
    if (!settings || typeof settings !== 'object') return false;
    
    const requiredProps = {
        warnings: 'object',
        antispam: 'boolean',
        antilink: 'boolean',
        antitoxic: 'boolean',
        antiraid: 'boolean',
        raidThreshold: 'number',
        polls: 'object',
        scheduled: 'object',
        features: 'object'
    };

    return Object.entries(requiredProps).every(([prop, type]) => 
        settings.hasOwnProperty(prop) && typeof settings[prop] === type
    );
}

/**
 * Check if a feature is enabled for a group
 * @param {string} jid Group JID
 * @param {string} feature Feature name (e.g., 'leveling', 'nsfw')
 * @returns {Promise<boolean>} Whether feature is enabled
 */
async function isFeatureEnabled(jid, feature) {
    try {
        const settings = await getGroupSettings(jid);
        
        // If features object doesn't exist yet, add it with defaults
        if (!settings.features) {
            settings.features = {
                leveling: true,
                welcome: true,
                goodbye: true,
                nsfw: false,
                games: true,
                economy: true,
                reactions: true,
                media: true
            };
            await saveGroupSettings(jid, settings);
        }
        
        // If this specific feature doesn't exist, default to true for most features
        // except nsfw which defaults to false
        if (settings.features[feature] === undefined) {
            settings.features[feature] = (feature !== 'nsfw');
            await saveGroupSettings(jid, settings);
        }
        
        return settings.features[feature];
    } catch (err) {
        logger.error(`Error checking if feature ${feature} is enabled for group ${jid}:`, err);
        // Default to true for most features, false for nsfw
        return feature !== 'nsfw';
    }
}

/**
 * Set whether a feature is enabled for a group
 * @param {string} jid Group JID
 * @param {string} feature Feature name
 * @param {boolean} enabled Whether feature should be enabled
 * @returns {Promise<boolean>} Whether operation was successful
 */
async function setFeatureEnabled(jid, feature, enabled) {
    try {
        const settings = await getGroupSettings(jid);
        
        // Ensure features object exists
        if (!settings.features) {
            settings.features = {
                leveling: true,
                welcome: true,
                goodbye: true,
                nsfw: false,
                games: true,
                economy: true,
                reactions: true,
                media: true
            };
        }
        
        // Update feature setting
        settings.features[feature] = enabled;
        await saveGroupSettings(jid, settings);
        return true;
    } catch (err) {
        logger.error(`Error setting feature ${feature} to ${enabled} for group ${jid}:`, err);
        return false;
    }
}

/**
 * Get all feature settings for a group
 * @param {string} jid Group JID
 * @returns {Promise<Object>} Feature settings
 */
async function getFeatureSettings(jid) {
    try {
        const settings = await getGroupSettings(jid);
        
        // Ensure features object exists
        if (!settings.features) {
            settings.features = {
                leveling: true,
                welcome: true,
                goodbye: true,
                nsfw: false,
                games: true,
                economy: true,
                reactions: true,
                media: true
            };
            await saveGroupSettings(jid, settings);
        }
        
        return settings.features;
    } catch (err) {
        logger.error(`Error getting feature settings for group ${jid}:`, err);
        return {
            leveling: true,
            welcome: true,
            goodbye: true,
            nsfw: false,
            games: true,
            economy: true,
            reactions: true,
            media: true
        };
    }
}

module.exports = {
    getGroupSettings,
    saveGroupSettings,
    validateGroupSettings,
    isFeatureEnabled,
    setFeatureEnabled,
    getFeatureSettings
};
