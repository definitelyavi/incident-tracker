const axios = require('axios');
const { db } = require('../config/database');
const logger = require('../utils/logger');

class SlackService {
    constructor() {
        this.settings = {
            enabled: false,
            webhook_url: '',
            channel: '#incidents'
        };
        
        // Don't initialize immediately - wait for database to be ready
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            await this.getSlackSettings();
            this.initialized = true;
            logger.info('Slack service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize Slack service:', error);
            // Don't throw - service should work without Slack
        }
    }

    async getSlackSettings() {
        try {
            const result = await db.query('SELECT value FROM settings WHERE key = $1', ['slack_integration']);
            
            if (result.rows.length > 0) {
                // Handle JSONB format from your database
                const slackConfig = result.rows[0].value;
                
                this.settings = {
                    enabled: slackConfig.enabled || false,
                    webhook_url: slackConfig.webhook_url || '',
                    channel: slackConfig.channel || '#incidents'
                };
            }
        } catch (error) {
            logger.error('Failed to get Slack settings:', error);
            // Use default settings (disabled)
        }
    }

    async sendMessage(message, channel = null) {
        // Initialize if not already done
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.settings.enabled || !this.settings.webhook_url) {
            logger.info('Slack integration not available, skipping message send');
            return false;
        }

        try {
            const payload = {
                channel: channel || this.settings.channel,
                text: message,
                username: 'Incident Tracker',
                icon_emoji: ':warning:'
            };

            await axios.post(this.settings.webhook_url, payload);
            logger.info('Slack message sent successfully');
            return true;
        } catch (error) {
            logger.error('Failed to send Slack message:', error);
            return false;
        }
    }

    async sendTicketNotification(ticket, user, type) {
        if (!this.settings.enabled) return false;

        const message = this.formatTicketMessage(ticket, user, type);
        return await this.sendMessage(message);
    }

    formatTicketMessage(ticket, user, type) {
        const emoji = this.getTypeEmoji(type);
        const priorityEmoji = this.getPriorityEmoji(ticket.priority);
        
        return `${emoji} *Ticket ${type.toUpperCase()}* ${priorityEmoji}
*Ticket #${ticket.id}:* ${ticket.title}
*Status:* ${ticket.status}
*Priority:* ${ticket.priority}
*Category:* ${ticket.category}
*Assigned to:* ${user ? user.name : 'Unassigned'}
*Description:* ${ticket.description.length > 100 ? ticket.description.substring(0, 100) + '...' : ticket.description}`;
    }

    getTypeEmoji(type) {
        const emojis = {
            'created': ':new:',
            'assigned': ':point_right:',
            'updated': ':pencil2:',
            'resolved': ':white_check_mark:',
            'closed': ':lock:',
            'comment': ':speech_balloon:'
        };
        return emojis[type] || ':information_source:';
    }

    getPriorityEmoji(priority) {
        const emojis = {
            'critical': ':rotating_light:',
            'high': ':red_circle:',
            'medium': ':yellow_circle:',
            'low': ':green_circle:'
        };
        return emojis[priority] || ':white_circle:';
    }

    async sendAlert(title, message, severity = 'info') {
        const emoji = severity === 'critical' ? ':rotating_light:' : ':warning:';
        const formattedMessage = `${emoji} *${title}*\n${message}`;
        
        return await this.sendMessage(formattedMessage);
    }
}

// Export a singleton instance
module.exports = new SlackService();