/**
 * JID Helper Utility - Safe WhatsApp JID functions
 * Prevents "jid.endsWith is not a function" error
 */
const logger = require('./logger');
const mediaEffects = require('./mediaEffects');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

/**
 * Safely check if a JID is a group JID
 * @param {any} jid - JID to check
 * @returns {boolean} - Whether the JID is a group
 */
function isJidGroup(jid) {
    if (!jid) return false;
    
    try {
        const jidStr = String(jid || '');
        return jidStr.endsWith('@g.us');
    } catch (err) {
        logger.error('Error in isJidGroup:', err);
        return false;
    }
}

/**
 * Safely check if a JID is a user JID
 * @param {any} jid - JID to check
 * @returns {boolean} - Whether the JID is a user
 */
function isJidUser(jid) {
    if (!jid) return false;
    
    try {
        const jidStr = String(jid || '');
        return jidStr.endsWith('@s.whatsapp.net');
    } catch (err) {
        logger.error('Error in isJidUser:', err);
        return false;
    }
}

/**
 * Normalize a JID to ensure it's properly formatted
 * @param {any} jid - JID to normalize
 * @returns {string} - Normalized JID
 */
function normalizeJid(jid) {
    if (!jid) return '';
    
    try {
        let jidStr = String(jid || '');
        
        // Convert jid@c.us to jid@s.whatsapp.net
        if (jidStr.endsWith('@c.us')) {
            jidStr = jidStr.replace('@c.us', '@s.whatsapp.net');
        }
        
        return jidStr;
    } catch (err) {
        logger.error('Error in normalizeJid:', err);
        return '';
    }
}

/**
 * Ensure a JID is a string
 * @param {any} jid - The JID to stringify
 * @returns {string} - The JID as a string or empty string if invalid
 */
function ensureJidString(jid) {
    if (!jid) return '';
    
    try {
        return String(jid || '');
    } catch (err) {
        logger.error('Error in ensureJidString:', err);
        return '';
    }
}

/**
 * Extract user ID from JID
 * @param {any} jid - The JID to extract from
 * @returns {string} - User ID portion of the JID
 */
function extractUserIdFromJid(jid) {
    const jidStr = ensureJidString(jid);
    
    try {
        // Extract the part before @ symbol
        const match = jidStr.match(/([^@]+)@/);
        return match ? match[1] : '';
    } catch (err) {
        logger.error('Error in extractUserIdFromJid:', err);
        return '';
    }
}

/**
 * Format a JID for logging to prevent [object Object]
 * @param {any} jid - JID to format for log messages
 * @returns {string} - Formatted JID safe for logging
 */
function formatJidForLogging(jid) {
    if (!jid) return 'unknown';
    
    try {
        if (typeof jid === 'object') {
            // Extract from message object if available
            if (jid.key && jid.key.remoteJid) {
                return ensureJidString(jid.key.remoteJid);
            } else if (jid.remoteJid) {
                return ensureJidString(jid.remoteJid);
            } else {
                return 'object_jid';
            }
        } else {
            return ensureJidString(jid);
        }
    } catch (err) {
        logger.error('Error formatting JID for logging:', err);
        return 'invalid_jid';
    }
}

/**
 * Safe message sending with JID validation
 * @param {Object} sock - WhatsApp socket connection
 * @param {any} jid - JID to send to
 * @param {Object} content - Message content
 * @returns {Promise<Object|null>} - Message sending result or null if failed
 */
async function safeSendMessage(sock, jid, content) {
    try {
        // First check if sock is valid
        if (!sock || typeof sock.sendMessage !== 'function') {
            logger.error('Invalid socket object provided to safeSendMessage');
            return null;
        }
        
        // Handle case where jid comes from message.key.remoteJid
        let targetJid = jid;
        if (typeof jid === 'object' && jid !== null) {
            if (jid.remoteJid) {
                targetJid = jid.remoteJid;
            } else if (jid.key && jid.key.remoteJid) {
                targetJid = jid.key.remoteJid;
            }
        }
        
        const normalizedJid = normalizeJid(targetJid);
        
        if (!normalizedJid) {
            logger.error('Invalid JID provided for message sending:', targetJid);
            return null;
        }
        
        // Content validation
        if (!content || typeof content !== 'object') {
            logger.error('Invalid content provided to safeSendMessage');
            return null;
        }
        
        return await sock.sendMessage(normalizedJid, content);
    } catch (err) {
        logger.error('Error in safeSendMessage:', err);
        // Log more details to help with debugging
        logger.error('JID type:', typeof jid);
        if (jid && typeof jid === 'object') {
            logger.error('JID is object with keys:', Object.keys(jid));
        }
        return null;
    }
}

/**
 * Safe text message sending with JID validation
 * @param {Object} sock - WhatsApp socket connection
 * @param {any} jid - JID to send to
 * @param {string} text - Text message
 * @returns {Promise<Object|null>} - Message sending result or null if failed
 */
async function safeSendText(sock, jid, text) {
    return await safeSendMessage(sock, jid, { text });
}

/**
 * Safe image message sending with JID validation
 * @param {Object} sock - WhatsApp socket connection
 * @param {any} jid - JID to send to
 * @param {string|Buffer} image - Image URL or buffer
 * @param {string} caption - Optional caption
 * @returns {Promise<Object|null>} - Message sending result or null if failed
 */
async function safeSendImage(sock, jid, image, caption = '') {
    const content = {
        image: typeof image === 'string' ? { url: image } : image,
        caption
    };
    
    return await safeSendMessage(sock, jid, content);
}

/**
 * Safe sticker message sending with JID validation
 * @param {Object} sock - WhatsApp socket connection
 * @param {any} jid - JID to send to
 * @param {Buffer} sticker - Sticker buffer
 * @param {Object} options - Additional options (mimetype, etc.)
 * @returns {Promise<Object|null>} - Message sending result or null if failed
 */
async function safeSendSticker(sock, jid, sticker, options = {}) {
    const content = {
        sticker,
        ...options
    };
    
    return await safeSendMessage(sock, jid, content);
}

/**
 * Safe animated GIF sending with multiple fallback methods
 * @param {Object} sock - WhatsApp socket connection
 * @param {any} jid - JID to send to
 * @param {Buffer|string} gif - GIF buffer or path to GIF file
 * @param {string} caption - Caption text for the GIF
 * @param {Object} options - Additional options
 * @returns {Promise<Object|null>} - Message sending result or null if failed
 */
async function safeSendAnimatedGif(sock, jid, gif, caption = '', options = {}) {
    try {
        // First check if sock is valid
        if (!sock || typeof sock.sendMessage !== 'function') {
            logger.error('Invalid socket object provided to safeSendAnimatedGif');
            return null;
        }
        
        // Handle case where jid comes from message.key.remoteJid
        let targetJid = jid;
        if (typeof jid === 'object' && jid !== null) {
            if (jid.remoteJid) {
                targetJid = jid.remoteJid;
            } else if (jid.key && jid.key.remoteJid) {
                targetJid = jid.key.remoteJid;
            }
        }
        
        const normalizedJid = normalizeJid(targetJid);
        
        if (!normalizedJid) {
            logger.error('Invalid JID provided for GIF sending:', targetJid);
            return null;
        }

        // Convert path to buffer if needed
        let buffer = gif;
        let originalSize = 0;
        const fs = require('fs');
        
        if (typeof gif === 'string') {
            try {
                // Log the file size before reading
                if (fs.existsSync(gif)) {
                    const stats = fs.statSync(gif);
                    originalSize = stats.size;
                    logger.info(`GIF file size: ${(originalSize / 1024).toFixed(2)} KB at ${gif}`);
                    
                    // Check if file is too large (>2MB) for reliable sending
                    if (originalSize > 2 * 1024 * 1024) {
                        logger.warn(`GIF file is large (${(originalSize / 1024 / 1024).toFixed(2)}MB), may have compatibility issues`);
                    }
                }
                
                buffer = fs.readFileSync(gif);
            } catch (err) {
                logger.error(`Failed to read GIF file: ${err.message}`);
                return null;
            }
        } else if (Buffer.isBuffer(buffer)) {
            originalSize = buffer.length;
            logger.info(`GIF buffer size: ${(originalSize / 1024).toFixed(2)} KB`);
        }

        // CRITICAL FIX: Always ensure that GIF is properly sent as an animated video
        try {
            const tempDir = await mediaEffects.ensureTempDir();
            const tempGifPath = path.join(tempDir, `temp-${Date.now()}.gif`);
            const mp4Path = path.join(tempDir, `temp-${Date.now()}.mp4`);
            
            // Write buffer to file for processing
            fs.writeFileSync(tempGifPath, buffer);
            
            // Convert GIF to MP4 with specific settings to ensure animation works
            await new Promise((resolve, reject) => {
                ffmpeg(tempGifPath)
                    .outputOptions([
                        '-movflags faststart',
                        '-pix_fmt yuv420p',
                        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                        '-b:v', '2M',     // Higher bitrate for better quality
                        '-r', '30',        // Higher framerate for smoother animation
                        '-shortest',       // Finish encoding when shortest input stream ends
                        '-an',             // No audio
                        '-f', 'mp4'        // Force MP4 format
                    ])
                    .output(mp4Path)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });
            
            // Read the MP4 file
            const mp4Buffer = fs.readFileSync(mp4Path);
            logger.info(`MP4 conversion successful, size: ${(mp4Buffer.length/1024).toFixed(2)} KB`);
            
            // CRITICAL: Send with specific options for animation support
            // We're in the safeSendMessage implementation, so we use sock.sendMessage directly here
            // to avoid infinite recursion
            const result = await sock.sendMessage(normalizedJid, {
                video: mp4Buffer,
                caption,
                gifPlayback: true,      // This is critical for GIF animation
                ptt: false,             // Not voice note
                seconds: 0,             // No expiration
                viewOnce: false,        // Not view-once content
                mediaType: 2,           // 2 = video type
                mimetype: 'video/mp4',  // Correct MIME type
                ...options
            });
            
            logger.info(`✅ Successfully sent GIF as animated MP4!`);
            
            // Clean up the temporary files
            try {
                fs.unlinkSync(tempGifPath);
                fs.unlinkSync(mp4Path);
            } catch (cleanupError) {
                logger.warn(`Failed to clean up temp files: ${cleanupError.message}`);
            }
            
            return result;
        } catch (mainError) {
            logger.error(`Main MP4 conversion method failed: ${mainError.message}`);
            
            // Fallback method: Try as direct document with GIF MIME type
            try {
                logger.info(`Attempting fallback: Sending as GIF document`);
                
                // We're in the safeSendMessage implementation, so we use sock.sendMessage directly here
                // to avoid infinite recursion (fallback method)
                const result = await sock.sendMessage(normalizedJid, {
                    document: buffer,
                    mimetype: 'image/gif',
                    fileName: `animation-${Date.now()}.gif`,
                    caption: `${caption} (animated GIF)`,
                    ...options
                });
                
                logger.info(`Successfully sent as GIF document!`);
                return result;
            } catch (docError) {
                logger.warn(`Document fallback failed: ${docError.message}`);
                
                // Last resort: Try as static image if everything else fails
                try {
                    logger.warn(`All animation methods failed, using static image fallback`);
                    // We're in the safeSendMessage implementation, so we use sock.sendMessage directly here
                    // to avoid infinite recursion (last resort method)
                    const result = await sock.sendMessage(normalizedJid, {
                        image: buffer,
                        caption: `${caption} (static fallback - animation failed)`,
                        ...options
                    });
                    logger.info(`Sent as static image (fallback)!`);
                    return result;
                } catch (imageError) {
                    logger.error(`All methods failed: ${imageError.message}`);
                    return null;
                }
            }
        }
    } catch (error) {
        logger.error(`Error in safeSendAnimatedGif: ${error.message}`);
        return null;
    }
}

module.exports = {
    isJidGroup,
    isJidUser,
    normalizeJid,
    ensureJidString,
    extractUserIdFromJid,
    formatJidForLogging,
    safeSendMessage,
    safeSendText,
    safeSendImage,
    safeSendSticker,
    safeSendAnimatedGif
};