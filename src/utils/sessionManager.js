const fs = require('fs').promises;
const logger = require('./logger');
const config = require('../config/config');
const path = require('path');

class SessionManager {
    constructor() {
        this.sessionsDir = path.join(process.cwd(), 'sessions');
        this.authDir = path.join(process.cwd(), 'auth_info');
        this.credentialsFile = path.join(this.authDir, 'creds.json');
        this.isHeroku = process.env.DYNO ? true : false;
        this.sessionId = process.env.SESSION_ID || 'default-session';
        
        // Create temp directories for Heroku if needed
        if (this.isHeroku) {
            this.sessionsDir = path.join('/tmp', 'whatsapp-sessions');
            this.authDir = path.join('/tmp', 'whatsapp-auth');
            this.credentialsFile = path.join(this.authDir, 'creds.json');
            logger.info('Running on Heroku, using temporary filesystem paths');
        }
    }

    async initialize() {
        try {
            // Ensure directories exist
            await fs.mkdir(this.sessionsDir, { recursive: true });
            await fs.mkdir(this.authDir, { recursive: true });

            if (this.isHeroku) {
                logger.info(`Initialized Heroku session with ID: ${this.sessionId}`);
                // On Heroku, we need to restore from a backup or regenerate session
                const backupExists = await this.restoreFromBackup();
                if (backupExists) {
                    logger.info('Successfully restored session from backup');
                } else {
                    logger.info('No session backup found, will generate new QR code');
                }
            } else {
                logger.info('Local session directories initialized');
            }
            
            return true;
        } catch (err) {
            logger.error('Failed to initialize session directories:', err);
            return false;
        }
    }

    async clearSession() {
        try {
            logger.info('Clearing session data...');

            // Backup before clearing if on Heroku
            if (this.isHeroku) {
                await this.backupCredentials();
            }

            // Clear auth directory
            await fs.rm(this.authDir, { recursive: true, force: true });
            await fs.mkdir(this.authDir, { recursive: true });

            // Clear sessions directory
            await fs.rm(this.sessionsDir, { recursive: true, force: true });
            await fs.mkdir(this.sessionsDir, { recursive: true });

            logger.info('Session data cleared successfully');
            return true;
        } catch (err) {
            logger.error('Error clearing session:', err);
            return false;
        }
    }

    async saveSession(id, data) {
        try {
            await fs.mkdir(this.sessionsDir, { recursive: true });

            // Remove sensitive data before saving
            const sanitizedData = this._sanitizeSessionData(data);

            // Compact JSON and save
            await fs.writeFile(
                path.join(this.sessionsDir, `${id}.json`),
                JSON.stringify(sanitizedData),
                'utf8'
            );

            logger.info(`Session saved: ${id}`);
            return true;
        } catch (err) {
            logger.error('Error saving session:', err);
            return false;
        }
    }

    async loadSession(id) {
        try {
            const data = await fs.readFile(
                path.join(this.sessionsDir, `${id}.json`),
                'utf8'
            );
            return JSON.parse(data);
        } catch (err) {
            logger.debug('No existing session found:', err.message);
            return null;
        }
    }

    async backupCredentials() {
        try {
            if (!await this._fileExists(this.credentialsFile)) {
                logger.error('Credentials file not found');
                return false;
            }

            const credsData = await fs.readFile(this.credentialsFile, 'utf8');
            const backupPath = path.join(this.sessionsDir, `creds_backup_${Date.now()}.json`);
            
            // Save backup file
            await fs.writeFile(backupPath, credsData, 'utf8');
            
            // For Heroku, also save a standard backup file that we can find later
            if (this.isHeroku) {
                const herokuBackupPath = path.join(this.sessionsDir, `${this.sessionId}_backup.json`);
                await fs.writeFile(herokuBackupPath, credsData, 'utf8');
                logger.info(`Heroku persistent backup saved as ${this.sessionId}_backup.json`);
                
                // If owner number is set, create a safety backup by sending to owner
                if (process.env.OWNER_NUMBER) {
                    try {
                        // TODO: Implement sending backup to owner via WhatsApp when needed
                        logger.info('Backup notification would be sent to owner');
                    } catch (backupErr) {
                        logger.error('Failed to send backup to owner:', backupErr);
                    }
                }
            }
            
            logger.info('Credentials backup created successfully');
            return true;
        } catch (err) {
            logger.error('Error backing up credentials:', err);
            return false;
        }
    }

    async emergencyCredsSave(state) {
        try {
            const timestamp = Date.now();
            const emergencyPath = path.join(this.sessionsDir, `emergency_creds_${timestamp}.json`);
            await fs.writeFile(emergencyPath, JSON.stringify(state), 'utf8');
            
            // For Heroku, also save with the session ID for easier recovery
            if (this.isHeroku) {
                const herokuEmergencyPath = path.join(this.sessionsDir, `${this.sessionId}_emergency.json`);
                await fs.writeFile(herokuEmergencyPath, JSON.stringify(state), 'utf8');
                logger.info(`Heroku emergency backup saved with session ID: ${this.sessionId}`);
            }
            
            logger.info('Emergency credentials save successful');
            return true;
        } catch (err) {
            logger.error('Emergency credentials save failed:', err);
            return false;
        }
    }

    async _fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    _sanitizeSessionData(data) {
        // Deep clone the data
        const sanitized = JSON.parse(JSON.stringify(data));

        // Remove sensitive fields
        delete sanitized.encKey;
        delete sanitized.macKey;

        return sanitized;
    }

    async createBackupSchedule() {
        try {
            // Initial backup
            await this.backupCredentials();
            logger.info('Initial session backup created');

            // Schedule regular backups
            setInterval(async () => {
                const success = await this.backupCredentials();
                if (!success) {
                    logger.warn('Scheduled backup failed');
                }
            }, 3600000); // Every hour

            logger.info('Backup schedule created successfully');
            return true;
        } catch (err) {
            logger.error('Error creating backup schedule:', err);
            return false;
        }
    }

    async handleCredentialsBackup(message) {
        try {
            if (!message?.text) {
                logger.debug('Skipping non-text message in handleCredentialsBackup');
                return false;
            }

            let data;
            try {
                data = JSON.parse(message.text);
            } catch (err) {
                logger.debug('Message is not a valid JSON in handleCredentialsBackup');
                return false;
            }

            if (data.type !== 'BOT_CREDENTIALS_BACKUP') {
                logger.debug('Message is not a credentials backup');
                return false;
            }

            logger.info('Processing credentials backup message...');

            // Decode and verify the backup
            const decodedCreds = Buffer.from(data.data, 'base64').toString();
            const checksum = require('crypto')
                .createHash('sha256')
                .update(decodedCreds)
                .digest('hex');

            if (checksum !== data.checksum) {
                logger.error('Backup checksum verification failed');
                return false;
            }

            // Parse the decoded credentials and ensure it's in one line without spaces
            const credentials = JSON.parse(decodedCreds);

            // Save backup with timestamp and ensure it's in one line without spaces
            await this.saveSession(this.sessionId + "_backup", credentials);

            logger.info(`Credentials backup saved successfully. Timestamp: ${data.timestamp}`);
            return true;
        } catch (err) {
            logger.error('Error in handleCredentialsBackup:', err);
            return false;
        }
    }

    async restoreFromBackup() {
        try {
            let backup = null;
            
            // For Heroku, try to find a session-specific backup first
            if (this.isHeroku) {
                try {
                    const herokuBackupPath = path.join(this.sessionsDir, `${this.sessionId}_backup.json`);
                    logger.info(`Attempting to restore from Heroku backup: ${herokuBackupPath}`);
                    const backupData = await fs.readFile(herokuBackupPath, 'utf8');
                    backup = JSON.parse(backupData);
                    logger.info(`Found Heroku-specific backup for session: ${this.sessionId}`);
                } catch (herokuErr) {
                    logger.warn(`No Heroku backup found for session: ${this.sessionId}`);
                    
                    // Try emergency backup
                    try {
                        const emergencyPath = path.join(this.sessionsDir, `${this.sessionId}_emergency.json`);
                        const emergencyData = await fs.readFile(emergencyPath, 'utf8');
                        backup = JSON.parse(emergencyData);
                        logger.info(`Restored from emergency backup for session: ${this.sessionId}`);
                    } catch (emergencyErr) {
                        logger.warn('No emergency backup found either');
                    }
                }
            }
            
            // If no Heroku-specific backup, try the regular backup
            if (!backup) {
                try {
                    backup = await this.loadSession(this.sessionId);
                    if (backup) {
                        logger.info(`Restored from regular backup for session: ${this.sessionId}`);
                    }
                } catch (legacyErr) {
                    logger.warn('No regular backup found');
                }
            }
            
            // If still no backup, try to find any backup file
            if (!backup) {
                try {
                    const files = await fs.readdir(this.sessionsDir);
                    const backupFiles = files.filter(file => file.includes('backup') || file.includes('emergency'));
                    
                    if (backupFiles.length > 0) {
                        // Sort to get the latest backup
                        backupFiles.sort().reverse();
                        const latestBackup = path.join(this.sessionsDir, backupFiles[0]);
                        const backupData = await fs.readFile(latestBackup, 'utf8');
                        backup = JSON.parse(backupData);
                        logger.info(`Restored from latest available backup: ${backupFiles[0]}`);
                    }
                } catch (anyErr) {
                    logger.error('Error searching for backup files:', anyErr);
                }
            }
            
            if (!backup) {
                logger.warn('No backup found, will need to generate new QR code');
                return false;
            }
            
            // Write back to credentials file in one line without spaces
            await fs.writeFile(
                this.credentialsFile,
                JSON.stringify(backup).replace(/\s+/g, ''),
                'utf8'
            );
            
            logger.info('Credentials restored from backup successfully');
            return true;
        } catch (err) {
            logger.error('Error restoring credentials:', err);
            return false;
        }
    }
}

const sessionManager = new SessionManager();
module.exports = { sessionManager };