const express = require('express');
const { query, validationResult } = require('express-validator');
const { db } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/', [
    query('q').notEmpty().withMessage('Search query is required'),
    query('type').optional().isIn(['tickets', 'users', 'all']),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('page').optional().isInt({ min: 1 })
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
            q: searchQuery,
            type = 'all',
            limit = 20,
            page = 1
        } = req.query;

        const userId = req.user.id;
        const userRole = req.user.role;
        const offset = (page - 1) * limit;

        let results = { tickets: [], users: [], total: 0 };

        if (type === 'tickets' || type === 'all') {
            const ticketResults = await searchTickets(searchQuery, userId, userRole, limit, offset);
            results.tickets = ticketResults.data;
            if (type === 'tickets') {
                results.total = ticketResults.total;
            }
        }

        if ((type === 'users' || type === 'all') && ['admin', 'agent'].includes(userRole)) {
            const userResults = await searchUsers(searchQuery, limit, offset);
            results.users = userResults.data;
            if (type === 'users') {
                results.total = userResults.total;
            }
        }

        if (type === 'all') {
            results.total = results.tickets.length + results.users.length;
        }

        try {
            await db.insertLog({
                user_id: userId,
                action: 'search',
                resource_type: type,
                details: {
                    query: searchQuery,
                    results_count: results.total
                }
            });
        } catch (logError) {
            // Logging failed is non-critical
        }

        res.json({
            query: searchQuery,
            type: type,
            results: results,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: results.total
            }
        });

    } catch (error) {
        logger.error('Search error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Search operation failed'
        });
    }
});

router.get('/tickets', [
    query('q').optional().isString(),
    query('status').optional().isString(),
    query('priority').optional().isString(),
    query('category').optional().isString(),
    query('assignee_id').optional().isInt(),
    query('reporter_id').optional().isInt(),
    query('start_date').optional().isISO8601(),
    query('end_date').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('page').optional().isInt({ min: 1 }),
    query('sort').optional().isIn(['created_at', 'updated_at', 'priority', 'status']),
    query('order').optional().isIn(['asc', 'desc'])
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
            q: searchQuery,
            status,
            priority,
            category,
            assignee_id,
            reporter_id,
            start_date,
            end_date,
            limit = 20,
            page = 1,
            sort = 'created_at',
            order = 'desc'
        } = req.query;

        const userId = req.user.id;
        const userRole = req.user.role;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        if (userRole === 'viewer') {
            whereConditions.push(`(t.reporter_id = $${paramIndex++})`);
            queryParams.push(userId);
        } else if (userRole === 'agent') {
            whereConditions.push(`(t.assignee_id = $${paramIndex++} OR t.reporter_id = $${paramIndex++})`);
            queryParams.push(userId, userId);
        }

        if (searchQuery) {
            whereConditions.push(`(
                t.title ILIKE $${paramIndex} OR 
                t.description ILIKE $${paramIndex} OR
                t.id::text = $${paramIndex + 1}
            )`);
            queryParams.push(`%${searchQuery}%`, searchQuery);
            paramIndex += 2;
        }

        if (status) {
            whereConditions.push(`t.status = $${paramIndex++}`);
            queryParams.push(status);
        }

        if (priority) {
            whereConditions.push(`t.priority = $${paramIndex++}`);
            queryParams.push(priority);
        }

        if (category) {
            whereConditions.push(`t.category = $${paramIndex++}`);
            queryParams.push(category);
        }

        if (assignee_id) {
            whereConditions.push(`t.assignee_id = $${paramIndex++}`);
            queryParams.push(assignee_id);
        }

        if (reporter_id) {
            whereConditions.push(`t.reporter_id = $${paramIndex++}`);
            queryParams.push(reporter_id);
        }

        if (start_date) {
            whereConditions.push(`t.created_at >= $${paramIndex++}`);
            queryParams.push(start_date);
        }

        if (end_date) {
            whereConditions.push(`t.created_at <= $${paramIndex++}`);
            queryParams.push(end_date);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
        const orderClause = `ORDER BY t.${sort} ${order.toUpperCase()}`;

        const ticketsQuery = `
            SELECT 
                t.*,
                reporter.name as reporter_name,
                reporter.email as reporter_email,
                assignee.name as assignee_name,
                assignee.email as assignee_email,
                COUNT(*) OVER() as total_count
            FROM tickets t
            LEFT JOIN users reporter ON t.reporter_id = reporter.id
            LEFT JOIN users assignee ON t.assignee_id = assignee.id
            ${whereClause}
            ${orderClause}
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(limit, offset);

        const result = await db.query(ticketsQuery, queryParams);
        const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

        const tickets = result.rows.map(row => {
            const { total_count, ...ticket } = row;
            return ticket;
        });

        res.json({
            tickets: tickets,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            },
            filters: {
                q: searchQuery,
                status,
                priority,
                category,
                assignee_id,
                reporter_id,
                start_date,
                end_date
            }
        });

    } catch (error) {
        logger.error('Advanced ticket search error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Ticket search failed'
        });
    }
});

router.get('/suggestions', [
    query('q').notEmpty().withMessage('Search query is required'),
    query('type').optional().isIn(['tickets', 'users', 'categories'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { q: searchQuery, type = 'tickets' } = req.query;
        const userRole = req.user.role;

        let suggestions = [];

        if (type === 'tickets') {
            const titleQuery = `
                SELECT DISTINCT title 
                FROM tickets 
                WHERE title ILIKE $1 
                LIMIT 5
            `;
            const titleResult = await db.query(titleQuery, [`%${searchQuery}%`]);
            suggestions = titleResult.rows.map(row => ({
                type: 'ticket_title',
                value: row.title
            }));
        } else if (type === 'users' && ['admin', 'agent'].includes(userRole)) {
            const userQuery = `
                SELECT DISTINCT name 
                FROM users 
                WHERE name ILIKE $1 AND is_active = true
                LIMIT 5
            `;
            const userResult = await db.query(userQuery, [`%${searchQuery}%`]);
            suggestions = userResult.rows.map(row => ({
                type: 'user_name',
                value: row.name
            }));
        } else if (type === 'categories') {
            const categoryQuery = `
                SELECT DISTINCT category 
                FROM tickets 
                WHERE category ILIKE $1 
                LIMIT 5
            `;
            const categoryResult = await db.query(categoryQuery, [`%${searchQuery}%`]);
            suggestions = categoryResult.rows.map(row => ({
                type: 'category',
                value: row.category
            }));
        }

        res.json({ suggestions });

    } catch (error) {
        logger.error('Search suggestions error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get search suggestions'
        });
    }
});

async function searchTickets(searchQuery, userId, userRole, limit, offset) {
    try {
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        if (userRole === 'viewer') {
            whereConditions.push(`(t.reporter_id = $${paramIndex++})`);
            queryParams.push(userId);
        } else if (userRole === 'agent') {
            whereConditions.push(`(t.assignee_id = $${paramIndex++} OR t.reporter_id = $${paramIndex++})`);
            queryParams.push(userId, userId);
        }

        whereConditions.push(`(
            t.title ILIKE $${paramIndex} OR 
            t.description ILIKE $${paramIndex} OR
            t.id::text = $${paramIndex + 1}
        )`);
        queryParams.push(`%${searchQuery}%`, searchQuery);
        paramIndex += 2;

        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

        const query = `
            SELECT 
                t.*,
                reporter.name as reporter_name,
                assignee.name as assignee_name,
                COUNT(*) OVER() as total_count
            FROM tickets t
            LEFT JOIN users reporter ON t.reporter_id = reporter.id
            LEFT JOIN users assignee ON t.assignee_id = assignee.id
            ${whereClause}
            ORDER BY t.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(limit, offset);

        const result = await db.query(query, queryParams);
        const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

        return {
            data: result.rows.map(row => {
                const { total_count, ...ticket } = row;
                return ticket;
            }),
            total: total
        };

    } catch (error) {
        logger.error('Search tickets helper error:', error);
        return { data: [], total: 0 };
    }
}

async function searchUsers(searchQuery, limit, offset) {
    try {
        const query = `
            SELECT 
                u.id,
                u.name,
                u.email,
                u.role,
                u.is_active,
                u.created_at,
                COUNT(t.id) as ticket_count,
                COUNT(*) OVER() as total_count
            FROM users u
            LEFT JOIN tickets t ON u.id = t.assignee_id
            WHERE (u.name ILIKE $1 OR u.email ILIKE $1) AND u.is_active = true
            GROUP BY u.id, u.name, u.email, u.role, u.is_active, u.created_at
            ORDER BY u.name
            LIMIT $2 OFFSET $3
        `;

        const result = await db.query(query, [`%${searchQuery}%`, limit, offset]);
        const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

        return {
            data: result.rows.map(row => {
                const { total_count, ...user } = row;
                return user;
            }),
            total: total
        };

    } catch (error) {
        logger.error('Search users helper error:', error);
        return { data: [], total: 0 };
    }
}

module.exports = router;