const express = require('express');
const { query, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Note: This implementation assumes you have a 'logs' table in PostgreSQL
// If you don't have logging in PostgreSQL yet, you may want to remove this entire file
// since the main app uses db.insertLog() calls but may not have a logs table

router.get('/', requireRole(['admin']), [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('action').optional().isString(),
    query('resource_type').optional().isString(),
    query('user_id').optional().isInt(),
    query('start_date').optional().isISO8601(),
    query('end_date').optional().isISO8601(),
    query('search').optional().isString()
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
            limit = 50,
            action,
            resource_type,
            user_id,
            start_date,
            end_date,
            search
        } = req.query;

        const offset = (page - 1) * limit;

        // Build WHERE clause
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        if (action) {
            whereConditions.push(`action = $${paramIndex++}`);
            queryParams.push(action);
        }

        if (resource_type) {
            whereConditions.push(`resource_type = ${paramIndex++}`);
            queryParams.push(resource_type);
        }

        if (user_id) {
            whereConditions.push(`user_id = ${paramIndex++}`);
            queryParams.push(user_id);
        }

        if (start_date) {
            whereConditions.push(`created_at >= ${paramIndex++}`);
            queryParams.push(start_date);
        }

        if (end_date) {
            whereConditions.push(`created_at <= ${paramIndex++}`);
            queryParams.push(end_date);
        }

        if (search) {
            whereConditions.push(`(description ILIKE ${paramIndex++} OR details::text ILIKE ${paramIndex++})`);
            queryParams.push(`%${search}%`, `%${search}%`);
            paramIndex++;
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Get logs with user names
        const logsQuery = `
            SELECT 
                l.*,
                u.name as user_name,
                COUNT(*) OVER() as total_count
            FROM logs l
            LEFT JOIN users u ON l.user_id = u.id
            ${whereClause}
            ORDER BY l.created_at DESC
            LIMIT ${paramIndex++} OFFSET ${paramIndex++}
        `;

        queryParams.push(limit, offset);

        const result = await db.query(logsQuery, queryParams);
        const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

        const logs = result.rows.map(row => {
            const { total_count, ...log } = row;
            return log;
        });

        res.json({
            logs: logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Get logs error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve logs'
        });
    }
});

router.get('/actions', requireRole(['admin']), async (req, res) => {
    try {
        const result = await db.query('SELECT DISTINCT action FROM logs ORDER BY action');
        const actions = result.rows.map(row => row.action);
        res.json({ actions });

    } catch (error) {
        logger.error('Get log actions error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve log actions'
        });
    }
});

router.get('/resource-types', requireRole(['admin']), async (req, res) => {
    try {
        const result = await db.query('SELECT DISTINCT resource_type FROM logs ORDER BY resource_type');
        const resourceTypes = result.rows.map(row => row.resource_type);
        res.json({ resource_types: resourceTypes });

    } catch (error) {
        logger.error('Get log resource types error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve log resource types'
        });
    }
});

router.get('/:id', requireRole(['admin']), async (req, res) => {
    try {
        const logId = req.params.id;

        const result = await db.query(`
            SELECT 
                l.*,
                u.name as user_name
            FROM logs l
            LEFT JOIN users u ON l.user_id = u.id
            WHERE l.id = $1
        `, [logId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Log entry not found'
            });
        }

        res.json({ log: result.rows[0] });

    } catch (error) {
        logger.error('Get log entry error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve log entry'
        });
    }
});

router.get('/user/:userId', requireRole(['admin']), [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const userId = parseInt(req.params.userId);
        const { page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;

        const userResult = await db.query(
            'SELECT name FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const logsQuery = `
            SELECT 
                l.*,
                COUNT(*) OVER() as total_count
            FROM logs l
            WHERE l.user_id = $1
            ORDER BY l.created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const result = await db.query(logsQuery, [userId, limit, offset]);
        const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

        const logs = result.rows.map(row => {
            const { total_count, ...log } = row;
            return { ...log, user_name: userResult.rows[0].name };
        });

        res.json({
            logs: logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            },
            user: {
                id: userId,
                name: userResult.rows[0].name
            }
        });

    } catch (error) {
        logger.error('Get user logs error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve user logs'
        });
    }
});

router.get('/resource/:type/:id', requireRole(['admin']), [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const resourceType = req.params.type;
        const resourceId = parseInt(req.params.id);
        const { page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;

        const logsQuery = `
            SELECT 
                l.*,
                u.name as user_name,
                COUNT(*) OVER() as total_count
            FROM logs l
            LEFT JOIN users u ON l.user_id = u.id
            WHERE l.resource_type = $1 AND l.resource_id = $2
            ORDER BY l.created_at DESC
            LIMIT $3 OFFSET $4
        `;

        const result = await db.query(logsQuery, [resourceType, resourceId, limit, offset]);
        const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

        const logs = result.rows.map(row => {
            const { total_count, ...log } = row;
            return log;
        });

        res.json({
            logs: logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            },
            resource: {
                type: resourceType,
                id: resourceId
            }
        });

    } catch (error) {
        logger.error('Get resource logs error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve resource logs'
        });
    }
});

router.post('/', requireRole(['admin']), async (req, res) => {
    try {
        const {
            user_id,
            action,
            resource_type,
            resource_id,
            description,
            details = {}
        } = req.body;

        if (!action || !resource_type) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Action and resource_type are required'
            });
        }

        const logEntry = {
            user_id: user_id || req.user.id,
            action,
            resource_type,
            resource_id: resource_id || null,
            description: description || `${action} ${resource_type}`,
            details,
            ip_address: req.ip,
            user_agent: req.get('User-Agent')
        };

        const result = await db.insertLog(logEntry);

        res.status(201).json({
            message: 'Log entry created successfully',
            log_id: result.insertedId || result.id
        });

    } catch (error) {
        logger.error('Create log entry error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to create log entry'
        });
    }
});

router.delete('/cleanup', requireRole(['admin']), [
    query('days').isInt({ min: 1, max: 365 }).withMessage('Days must be between 1 and 365')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const days = parseInt(req.query.days);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const result = await db.query(
            'DELETE FROM logs WHERE created_at < $1',
            [cutoffDate]
        );

        res.json({
            message: 'Log cleanup completed successfully',
            deleted_count: result.rowCount,
            cutoff_date: cutoffDate
        });

    } catch (error) {
        logger.error('Log cleanup error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to cleanup logs'
        });
    }
});

router.get('/stats/summary', requireRole(['admin']), async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) as total_logs,
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(DISTINCT action) as unique_actions,
                COUNT(DISTINCT resource_type) as unique_resource_types,
                MIN(created_at) as oldest_log,
                MAX(created_at) as newest_log
            FROM logs
        `;

        const result = await db.query(statsQuery);
        const stats = result.rows[0] || {
            total_logs: 0,
            unique_users: 0,
            unique_actions: 0,
            unique_resource_types: 0,
            oldest_log: null,
            newest_log: null
        };

        // Convert string counts to integers
        stats.total_logs = parseInt(stats.total_logs);
        stats.unique_users = parseInt(stats.unique_users);
        stats.unique_actions = parseInt(stats.unique_actions);
        stats.unique_resource_types = parseInt(stats.unique_resource_types);

        res.json({ stats });

    } catch (error) {
        logger.error('Get log statistics error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve log statistics'
        });
    }
});

module.exports = router;