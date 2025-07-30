const nodemailer = require('nodemailer');
const { db } = require('../config/database');
const logger = require('../utils/logger');

class EmailService {
    constructor() {
        this.transporter = null;
        this.settings = {
            enabled: false,
            smtp_host: '',
            smtp_port: 587,
            smtp_user: '',
            smtp_password: '',
            from_email: '',
            smtp_secure: false
        };
        
        // Don't initialize immediately - wait for database to be ready
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            await this.getEmailSettings();
            if (this.settings.enabled) {
                await this.initializeTransporter();
            }
            this.initialized = true;
            logger.info('Email service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize email service:', error);
            // Don't throw - service should work without email
        }
    }

    async getEmailSettings() {
        try {
            const result = await db.query('SELECT value FROM settings WHERE key = $1', ['email_notifications']);
            
            if (result.rows.length > 0) {
                // Handle JSONB format from your database
                const emailConfig = result.rows[0].value;
                
                this.settings = {
                    enabled: emailConfig.enabled || false,
                    smtp_host: emailConfig.smtp_host || '',
                    smtp_port: emailConfig.smtp_port || 587,
                    smtp_user: emailConfig.smtp_user || '',
                    smtp_password: emailConfig.smtp_password || '',
                    from_email: emailConfig.from_email || '',
                    smtp_secure: emailConfig.smtp_secure || false
                };
            }
        } catch (error) {
            logger.error('Failed to get email settings:', error);
            // Use default settings (disabled)
        }
    }

    async initializeTransporter() {
        if (!this.settings.enabled || !this.settings.smtp_host) {
            logger.info('Email notifications disabled or not configured');
            return;
        }

        try {
            this.transporter = nodemailer.createTransporter({
                host: this.settings.smtp_host,
                port: this.settings.smtp_port,
                secure: this.settings.smtp_secure,
                auth: this.settings.smtp_user ? {
                    user: this.settings.smtp_user,
                    pass: this.settings.smtp_password
                } : null
            });

            // Test the connection
            await this.transporter.verify();
            logger.info('Email transporter initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize email transporter:', error);
            this.transporter = null;
        }
    }

    async sendEmail(to, subject, text, html = null) {
        // Initialize if not already done
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.transporter || !this.settings.enabled) {
            logger.info('Email service not available, skipping email send');
            return false;
        }

        try {
            const mailOptions = {
                from: this.settings.from_email || this.settings.smtp_user,
                to,
                subject,
                text,
                html: html || text
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Email sent successfully to ${to}`, { messageId: result.messageId });
            return true;
        } catch (error) {
            logger.error('Failed to send email:', error);
            return false;
        }
    }

    async sendTicketNotification(ticket, user, type) {
        if (!this.settings.enabled) return false;

        const subject = this.getNotificationSubject(ticket, type);
        const text = this.getNotificationText(ticket, user, type);

        return await this.sendEmail(user.email, subject, text);
    }

    getNotificationSubject(ticket, type) {
        const subjects = {
            'created': `New Ticket: ${ticket.title}`,
            'assigned': `Ticket Assigned: ${ticket.title}`,
            'updated': `Ticket Updated: ${ticket.title}`,
            'resolved': `Ticket Resolved: ${ticket.title}`,
            'closed': `Ticket Closed: ${ticket.title}`,
            'comment': `New Comment: ${ticket.title}`
        };

        return subjects[type] || `Ticket Notification: ${ticket.title}`;
    }

    getNotificationText(ticket, user, type) {
        return `
Hello ${user.name},

This is a notification regarding ticket #${ticket.id}: ${ticket.title}

Status: ${ticket.status}
Priority: ${ticket.priority}
Category: ${ticket.category}

Description: ${ticket.description}

You can view the full ticket details in the incident tracker system.

Best regards,
Incident Tracker System
        `.trim();
    }
}

// Export a singleton instance
module.exports = new EmailService();