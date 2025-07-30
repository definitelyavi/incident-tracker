const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/', [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('unread_only').optional().isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const {
            page = 1,
            limit = 20,
            unread_only = false
        } = req.query;

        const offset = (page - 1) * limit;
        const userId = req.user.id;

        let whereCondition = 'WHERE user_id = $1';
        let queryParams = [userId];

        if (unread_only === 'true') {
            whereCondition += ' AND is_read = false';
        }

        const notificationsQuery = `
            SELECT 
                n.*,
                t.title as ticket_title,
                t.priority as ticket_priority
            FROM notifications n
            LEFT JOIN tickets t ON n.ticket_id = t.id
            ${whereCondition}
            ORDER BY n.created_at DESC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        queryParams.push(limit, offset);

        const notificationsResult = await db.query(notificationsQuery, queryParams);

        const countQuery = `
            SELECT COUNT(*) as total
            FROM notifications n
            ${whereCondition}
        `;

        const countResult = await db.query(countQuery, queryParams.slice(0, -2));
        const total = parseInt(countResult.rows[0].total);

        const unreadResult = await db.query(
            'SELECT COUNT(*) as unread FROM notifications WHERE user_id = $1 AND is_read = false',
            [userId]
        );
        const unreadCount = parseInt(unreadResult.rows[0].unread);

        res.json({
            notifications: notificationsResult.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            },
            unread_count: unreadCount
        });

    } catch (error) {
        logger.error('Get notifications error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve notifications'
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const notificationId = req.params.id;
        const userId = req.user.id;

        const result = await db.query(`
            SELECT 
                n.*,
                t.title as ticket_title,
                t.priority as ticket_priority,
                t.status as ticket_status
            FROM notifications n
            LEFT JOIN tickets t ON n.ticket_id = t.id
            WHERE n.id = $1 AND n.user_id = $2
        `, [notificationId, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Notification not found'
            });
        }

        res.json({ notification: result.rows[0] });

    } catch (error) {
        logger.error('Get notification error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve notification'
        });
    }
});

router.patch('/:id/read', async (req, res) => {
    try {
        const notificationId = req.params.id;
        const userId = req.user.id;

        const result = await db.query(`
            UPDATE notifications 
            SET is_read = true 
            WHERE id = $1 AND user_id = $2
            RETURNING *
        `, [notificationId, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Notification not found'
            });
        }

        res.json({
            message: 'Notification marked as read',
            notification: result.rows[0]
        });

    } catch (error) {
        logger.error('Mark notification as read error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to mark notification as read'
        });
    }
});

router.patch('/read-all', async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await db.query(`
            UPDATE notifications 
            SET is_read = true
            WHERE user_id = $1 AND is_read = false
            RETURNING id
        `, [userId]);

        res.json({
            message: `${result.rowCount} notifications marked as read`,
            updated_count: result.rowCount
        });

    } catch (error) {
        logger.error('Mark all notifications as read error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to mark all notifications as read'
        });
    }
});

router.post('/', requireRole(['admin']), [
    body('user_id').isInt().withMessage('Valid user ID required'),
    body('type').isLength({ min: 1 }).withMessage('Type is required'),
    body('title').isLength({ min: 1, max: 255 }).withMessage('Title is required and must be under 255 characters'),
    body('message').isLength({ min: 1 }).withMessage('Message is required'),
    body('ticket_id').optional().isInt()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const {
            user_id,
            ticket_id = null,
            type,
            title,
            message
        } = req.body;

        const userResult = await db.query(
            'SELECT id FROM users WHERE id = $1 AND is_active = true',
            [user_id]
        );

        if (userResult.rows.length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid user ID'
            });
        }

        if (ticket_id) {
            const ticketResult = await db.query(
                'SELECT id FROM tickets WHERE id = $1',
                [ticket_id]
            );

            if (ticketResult.rows.length === 0) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Invalid ticket ID'
                });
            }
        }

        const result = await db.query(`
            INSERT INTO notifications (user_id, ticket_id, type, title, message)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [user_id, ticket_id, type, title, message]);

        try {
            await db.insertLog({
                user_id: req.user.id,
                action: 'create',
                resource_type: 'notification',
                resource_id: result.rows[0].id,
                details: { recipient_id: user_id, type, title }
            });
        } catch (logError) {
            // Logging failed is non-critical
        }

        res.status(201).json({
            message: 'Notification created successfully',
            notification: result.rows[0]
        });

    } catch (error) {
        logger.error('Create notification error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to create notification'
        });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const notificationId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role;

        let whereCondition = 'WHERE id = $1';
        let queryParams = [notificationId];

        if (userRole !== 'admin') {
            whereCondition += ' AND user_id = $2';
            queryParams.push(userId);
        }

        const result = await db.query(`
            DELETE FROM notifications 
            ${whereCondition}
            RETURNING id, title, user_id
        `, queryParams);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Notification not found'
            });
        }

        res.json({
            message: 'Notification deleted successfully'
        });

    } catch (error) {
        logger.error('Delete notification error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete notification'
        });
    }
});

router.get('/settings/preferences', async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await db.query(`
            SELECT value 
            FROM settings 
            WHERE key = 'user_notification_preferences'
        `);

        let preferences = {
            email_notifications: true,
            slack_notifications: true,
            ticket_assigned: true,
            ticket_updated: true,
            ticket_commented: true,
            sla_warnings: true
        };

        if (result.rows.length > 0) {
            const globalPrefs = result.rows[0].value;
            if (globalPrefs.users && globalPrefs.users[userId]) {
                preferences = { ...preferences, ...globalPrefs.users[userId] };
            }
        }

        res.json({ preferences });

    } catch (error) {
        logger.error('Get notification preferences error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve notification preferences'
        });
    }
});

router.put('/settings/preferences', [
    body('email_notifications').optional().isBoolean(),
    body('slack_notifications').optional().isBoolean(),
    body('ticket_assigned').optional().isBoolean(),
    body('ticket_updated').optional().isBoolean(),
    body('ticket_commented').optional().isBoolean(),
    body('sla_warnings').optional().isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const userId = req.user.id;
        const newPreferences = req.body;

        const result = await db.query(`
            SELECT value 
            FROM settings 
            WHERE key = 'user_notification_preferences'
        `);

        let currentSettings = { users: {} };
        if (result.rows.length > 0) {
            currentSettings = result.rows[0].value;
        }

        if (!currentSettings.users) {
            currentSettings.users = {};
        }

        currentSettings.users[userId] = {
            ...currentSettings.users[userId],
            ...newPreferences
        };

        if (result.rows.length > 0) {
            await db.query(`
                UPDATE settings 
                SET value = $1, updated_at = NOW()
                WHERE key = 'user_notification_preferences'
            `, [JSON.stringify(currentSettings)]);
        } else {
            await db.query(`
                INSERT INTO settings (key, value, description)
                VALUES ('user_notification_preferences', $1, 'User-specific notification preferences')
            `, [JSON.stringify(currentSettings)]);
        }

        res.json({
            message: 'Notification preferences updated successfully',
            preferences: currentSettings.users[userId]
        });

    } catch (error) {
        logger.error('Update notification preferences error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update notification preferences'
        });
    }
});

router.post('/test', requireRole(['admin']), [
    body('user_id').isInt().withMessage('Valid user ID required'),
    body('type').optional().isIn(['email', 'slack', 'both']).withMessage('Invalid notification type')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { user_id, type = 'both' } = req.body;

        const userResult = await db.query(
            'SELECT name, email FROM users WHERE id = $1 AND is_active = true',
            [user_id]
        );

        if (userResult.rows.length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid user ID'
            });
        }

        const user = userResult.rows[0];

        const notificationResult = await db.query(`
            INSERT INTO notifications (user_id, type, title, message)
            VALUES ($1, 'test', 'Test Notification', 'This is a test notification sent by an administrator.')
            RETURNING *
        `, [user_id]);

        await db.query(`
            UPDATE notifications 
            SET email_sent = $1, slack_sent = $2
            WHERE id = $3
        `, [
            type === 'email' || type === 'both',
            type === 'slack' || type === 'both',
            notificationResult.rows[0].id
        ]);

        res.json({
            message: 'Test notification sent successfully',
            notification: notificationResult.rows[0],
            sent_to: user.name
        });

    } catch (error) {
        logger.error('Send test notification error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to send test notification'
        });
    }
});

module.exports = router;