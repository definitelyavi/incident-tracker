const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { requireRole, requireOwnership, canAccessTicket } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

async function createNotification(userId, ticketId, type, title, message) {
    try {
        const result = await db.query(`
            INSERT INTO notifications (user_id, ticket_id, type, title, message)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [userId, ticketId, type, title, message]);
        
        return result.rows[0];
    } catch (error) {
        logger.error('Failed to create notification:', error);
        throw error;
    }
}

router.get('/:id/comments', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role;

        const hasAccess = await canAccessTicket(userId, userRole, ticketId);
        if (!hasAccess) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied to this ticket'
            });
        }

        const result = await db.query(`
            SELECT 
                c.*,
                u.name as user_name
            FROM comments c
            LEFT JOIN users u ON c.user_id = u.id
            WHERE c.ticket_id = $1
            ORDER BY c.created_at ASC
        `, [ticketId]);

        res.json({
            comments: result.rows,
            total: result.rows.length
        });

    } catch (error) {
        logger.error('Get comments error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve comments'
        });
    }
});

router.post('/:id/comments', [
    body('comment').isLength({ min: 1, max: 2000 }).withMessage('Comment is required (max 2000 characters)').trim(),
    body('is_internal').optional().isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const ticketId = req.params.id;
        const { comment, is_internal = false } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role;

        const hasAccess = await canAccessTicket(userId, userRole, ticketId);
        if (!hasAccess) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied to this ticket'
            });
        }

        const ticketResult = await db.query('SELECT id, title, assignee_id FROM tickets WHERE id = $1', [ticketId]);
        if (ticketResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Ticket not found'
            });
        }

        const ticket = ticketResult.rows[0];

        const result = await db.query(`
            INSERT INTO comments (ticket_id, user_id, comment, is_internal)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [ticketId, userId, comment, is_internal]);

        const commentResult = await db.query(`
            SELECT 
                c.*,
                u.name as user_name
            FROM comments c
            LEFT JOIN users u ON c.user_id = u.id
            WHERE c.id = $1
        `, [result.rows[0].id]);

        const newComment = commentResult.rows[0];

        if (!is_internal && ticket.assignee_id && ticket.assignee_id !== userId) {
            try {
                await createNotification(
                    ticket.assignee_id,
                    ticketId,
                    'ticket_commented',
                    'New Comment',
                    `New comment added to ticket "${ticket.title}"`
                );
            } catch (notificationError) {
                logger.error('Failed to create comment notification:', notificationError);
            }
        }

        try {
            await db.insertLog({
                user_id: userId,
                action: 'create',
                resource_type: 'comment',
                resource_id: newComment.id,
                details: { 
                    ticket_id: ticketId,
                    is_internal: is_internal,
                    comment_length: comment.length
                }
            });
        } catch (logError) {
            // Logging failed is non-critical
        }

        res.status(201).json({
            message: 'Comment added successfully',
            comment: newComment
        });

    } catch (error) {
        logger.error('Add comment error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to add comment'
        });
    }
});

router.get('/', [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(['open', 'in-progress', 'resolved', 'closed']),
    query('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    query('assignee').optional().isInt(),
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
            limit = 20,
            status,
            priority,
            assignee,
            search
        } = req.query;

        const offset = (page - 1) * limit;
        const userId = req.user.id;
        const userRole = req.user.role;

        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        if (userRole === 'viewer') {
            whereConditions.push(`t.reporter_id = $${paramIndex++}`);
            queryParams.push(userId);
        } else if (userRole === 'agent') {
            whereConditions.push(`(t.reporter_id = $${paramIndex++} OR t.assignee_id = $${paramIndex++})`);
            queryParams.push(userId, userId);
        }

        if (status) {
            whereConditions.push(`t.status = $${paramIndex++}`);
            queryParams.push(status);
        }

        if (priority) {
            whereConditions.push(`t.priority = $${paramIndex++}`);
            queryParams.push(priority);
        }

        if (assignee) {
            whereConditions.push(`t.assignee_id = $${paramIndex++}`);
            queryParams.push(assignee);
        }

        if (search) {
            whereConditions.push(`(t.title ILIKE $${paramIndex++} OR t.description ILIKE $${paramIndex++})`);
            queryParams.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        const ticketsQuery = `
            SELECT 
                t.*,
                reporter.name as reporter_name,
                assignee.name as assignee_name,
                COUNT(c.id) as comment_count
            FROM tickets t
            LEFT JOIN users reporter ON t.reporter_id = reporter.id
            LEFT JOIN users assignee ON t.assignee_id = assignee.id
            LEFT JOIN comments c ON t.id = c.ticket_id
            ${whereClause}
            GROUP BY t.id, reporter.name, assignee.name
            ORDER BY t.created_at DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;

        queryParams.push(limit, offset);
        const ticketsResult = await db.query(ticketsQuery, queryParams);

        const countQuery = `
            SELECT COUNT(DISTINCT t.id) as total
            FROM tickets t
            ${whereClause}
        `;

        const countResult = await db.query(countQuery, queryParams.slice(0, -2));
        const total = parseInt(countResult.rows[0].total);

        res.json({
            tickets: ticketsResult.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Get tickets error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve tickets'
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role;

        const hasAccess = await canAccessTicket(userId, userRole, ticketId);
        if (!hasAccess) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied to this ticket'
            });
        }

        const result = await db.query(`
            SELECT 
                t.*,
                reporter.name as reporter_name,
                reporter.email as reporter_email,
                assignee.name as assignee_name,
                assignee.email as assignee_email
            FROM tickets t
            LEFT JOIN users reporter ON t.reporter_id = reporter.id
            LEFT JOIN users assignee ON t.assignee_id = assignee.id
            WHERE t.id = $1
        `, [ticketId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Ticket not found'
            });
        }

        res.json({ ticket: result.rows[0] });

    } catch (error) {
        logger.error('Get ticket error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve ticket'
        });
    }
});

router.post('/', [
    body('title').isLength({ min: 1, max: 255 }).withMessage('Title is required (max 255 characters)').trim(),
    body('description').isLength({ min: 1, max: 2000 }).withMessage('Description is required (max 2000 characters)').trim(),
    body('priority').isIn(['low', 'medium', 'high', 'critical']),
    body('category').isIn(['hardware', 'software', 'network', 'security', 'other']),
    body('assignee_id').optional().isInt()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { title, description, priority, category, assignee_id } = req.body;
        const reporterId = req.user.id;

        if (assignee_id) {
            const assigneeResult = await db.query(
                'SELECT role FROM users WHERE id = $1 AND is_active = true',
                [assignee_id]
            );

            if (assigneeResult.rows.length === 0) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Invalid assignee'
                });
            }

            const assigneeRole = assigneeResult.rows[0].role;
            if (!['admin', 'agent'].includes(assigneeRole)) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Can only assign to admin or agent users'
                });
            }
        }

        const slaResult = await db.query(
            'SELECT resolution_time_hours FROM sla_configs WHERE priority = $1 AND is_active = true',
            [priority]
        );

        let slaTarget = null;
        if (slaResult.rows.length > 0) {
            const hours = slaResult.rows[0].resolution_time_hours;
            slaTarget = new Date(Date.now() + hours * 60 * 60 * 1000);
        }

        const result = await db.query(`
            INSERT INTO tickets (title, description, priority, category, reporter_id, assignee_id, sla_target)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [title, description, priority, category, reporterId, assignee_id || null, slaTarget]);

        const ticket = result.rows[0];

        try {
            await createNotification(
                reporterId,
                ticket.id,
                'ticket_created',
                'Ticket Created',
                `Your ticket "${title}" has been created successfully`
            );

            if (assignee_id && assignee_id !== reporterId) {
                await createNotification(
                    assignee_id,
                    ticket.id,
                    'ticket_assigned',
                    'Ticket Assigned',
                    `You have been assigned ticket "${title}"`
                );
            }
        } catch (notificationError) {
            logger.error('Failed to create ticket notifications:', notificationError);
        }

        try {
            await db.insertLog({
                user_id: reporterId,
                action: 'create',
                resource_type: 'ticket',
                resource_id: ticket.id,
                details: { title, priority, category }
            });
        } catch (logError) {
            // Logging failed is non-critical
        }

        res.status(201).json({
            message: 'Ticket created successfully',
            ticket
        });

    } catch (error) {
        logger.error('Create ticket error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to create ticket'
        });
    }
});

router.put('/:id', requireOwnership('ticket'), [
    body('title').optional().isLength({ min: 1, max: 255 }).withMessage('Title must be less than 255 characters').trim(),
    body('description').optional().isLength({ min: 1, max: 2000 }).withMessage('Description must be less than 2000 characters').trim(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('category').optional().isIn(['hardware', 'software', 'network', 'security', 'other']),
    body('status').optional().isIn(['open', 'in-progress', 'resolved', 'closed']),
    body('assignee_id').optional().isInt()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const ticketId = req.params.id;
        const updates = req.body;
        const userId = req.user.id;

        const currentTicket = await db.query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
        if (currentTicket.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Ticket not found'
            });
        }

        const ticket = currentTicket.rows[0];

        const updateFields = [];
        const values = [];
        let paramIndex = 1;

        Object.entries(updates).forEach(([key, value]) => {
            if (value !== undefined) {
                updateFields.push(`${key} = $${paramIndex++}`);
                values.push(value);
            }
        });

        if (updateFields.length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'No valid fields to update'
            });
        }

        if (updates.status === 'resolved' && ticket.status !== 'resolved') {
            updateFields.push(`resolved_at = NOW()`);
        }

        values.push(ticketId);

        const result = await db.query(`
            UPDATE tickets 
            SET ${updateFields.join(', ')}, updated_at = NOW()
            WHERE id = $${paramIndex}
            RETURNING *
        `, values);

        try {
            if (updates.status === 'resolved' && ticket.status !== 'resolved') {
                if (ticket.reporter_id) {
                    await createNotification(
                        ticket.reporter_id,
                        ticketId,
                        'ticket_resolved',
                        'Ticket Resolved',
                        `Your ticket "${ticket.title}" has been resolved`
                    );
                }
                if (ticket.assignee_id && ticket.assignee_id !== ticket.reporter_id) {
                    await createNotification(
                        ticket.assignee_id,
                        ticketId,
                        'ticket_resolved',
                        'Ticket Resolved',
                        `Ticket "${ticket.title}" has been marked as resolved`
                    );
                }
            } else if (updates.assignee_id && updates.assignee_id !== ticket.assignee_id) {
                if (updates.assignee_id) {
                    await createNotification(
                        updates.assignee_id,
                        ticketId,
                        'ticket_assigned',
                        'Ticket Assigned',
                        `You have been assigned ticket "${ticket.title}"`
                    );
                }
            } else if (Object.keys(updates).length > 0) {
                const notifyUsers = new Set();
                if (ticket.reporter_id) notifyUsers.add(ticket.reporter_id);
                if (ticket.assignee_id) notifyUsers.add(ticket.assignee_id);
                
                notifyUsers.delete(userId);
                
                for (const notifyUserId of notifyUsers) {
                    await createNotification(
                        notifyUserId,
                        ticketId,
                        'ticket_updated',
                        'Ticket Updated',
                        `Ticket "${ticket.title}" has been updated`
                    );
                }
            }
        } catch (notificationError) {
            logger.error('Failed to create update notifications:', notificationError);
        }

        try {
            await db.insertLog({
                user_id: userId,
                action: 'update',
                resource_type: 'ticket',
                resource_id: ticketId,
                details: { 
                    updated_fields: Object.keys(updates),
                    old_values: Object.keys(updates).reduce((acc, key) => {
                        acc[key] = ticket[key];
                        return acc;
                    }, {}),
                    new_values: updates
                }
            });
        } catch (logError) {
            // Logging failed is non-critical
        }

        res.json({
            message: 'Ticket updated successfully',
            ticket: result.rows[0]
        });

    } catch (error) {
        logger.error('Update ticket error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update ticket'
        });
    }
});

router.delete('/:id', requireRole(['admin']), async (req, res) => {
    try {
        const ticketId = req.params.id;
        const userId = req.user.id;

        const result = await db.query('DELETE FROM tickets WHERE id = $1 RETURNING title', [ticketId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Ticket not found'
            });
        }

        try {
            await db.insertLog({
                user_id: userId,
                action: 'delete',
                resource_type: 'ticket',
                resource_id: ticketId,
                details: { title: result.rows[0].title }
            });
        } catch (logError) {
            // Logging failed is non-critical
        }

        res.json({
            message: 'Ticket deleted successfully'
        });

    } catch (error) {
        logger.error('Delete ticket error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete ticket'
        });
    }
});

router.patch('/:id/assign', requireRole(['admin', 'agent']), [
    body('assignee_id').isInt().withMessage('Valid assignee ID required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const ticketId = req.params.id;
        const { assignee_id } = req.body;
        const userId = req.user.id;

        const ticketResult = await db.query('SELECT title, assignee_id FROM tickets WHERE id = $1', [ticketId]);
        if (ticketResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Ticket not found'
            });
        }

        const ticket = ticketResult.rows[0];

        const assigneeResult = await db.query(
            'SELECT name, role FROM users WHERE id = $1 AND is_active = true',
            [assignee_id]
        );

        if (assigneeResult.rows.length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid assignee'
            });
        }

        const assignee = assigneeResult.rows[0];
        if (!['admin', 'agent'].includes(assignee.role)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Can only assign to admin or agent users'
            });
        }

        const result = await db.query(`
            UPDATE tickets 
            SET assignee_id = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING *
        `, [assignee_id, ticketId]);

        try {
            if (assignee_id !== ticket.assignee_id) {
                await createNotification(
                    assignee_id,
                    ticketId,
                    'ticket_assigned',
                    'Ticket Assigned',
                    `You have been assigned ticket "${ticket.title}"`
                );
            }
        } catch (notificationError) {
            logger.error('Failed to create assignment notification:', notificationError);
        }

        try {
            await db.insertLog({
                user_id: userId,
                action: 'assign',
                resource_type: 'ticket',
                resource_id: ticketId,
                details: { assignee_name: assignee.name, assignee_id }
            });
        } catch (logError) {
            // Logging failed is non-critical
        }

        res.json({
            message: 'Ticket assigned successfully',
            ticket: result.rows[0]
        });

    } catch (error) {
        logger.error('Assign ticket error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to assign ticket'
        });
    }
});

router.patch('/:id/status', requireOwnership('ticket'), [
    body('status').isIn(['open', 'in-progress', 'resolved', 'closed'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const ticketId = req.params.id;
        const { status } = req.body;
        const userId = req.user.id;

        const currentResult = await db.query('SELECT status, title, reporter_id, assignee_id FROM tickets WHERE id = $1', [ticketId]);
        if (currentResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Ticket not found'
            });
        }

        const ticket = currentResult.rows[0];
        const currentStatus = ticket.status;

        let updateQuery = 'UPDATE tickets SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *';
        let queryParams = [status, ticketId];

        if (status === 'resolved' && currentStatus !== 'resolved') {
            updateQuery = 'UPDATE tickets SET status = $1, resolved_at = NOW(), updated_at = NOW() WHERE id = $2 RETURNING *';
        }

        const result = await db.query(updateQuery, queryParams);

        try {
            if (status === 'resolved' && currentStatus !== 'resolved') {
                const notifyUsers = new Set();
                if (ticket.reporter_id) notifyUsers.add(ticket.reporter_id);
                if (ticket.assignee_id) notifyUsers.add(ticket.assignee_id);
                
                notifyUsers.delete(userId);
                
                for (const notifyUserId of notifyUsers) {
                    await createNotification(
                        notifyUserId,
                        ticketId,
                        'ticket_resolved',
                        'Ticket Resolved',
                        `Ticket "${ticket.title}" has been resolved`
                    );
                }
            }
        } catch (notificationError) {
            logger.error('Failed to create status change notification:', notificationError);
        }

        try {
            await db.insertLog({
                user_id: userId,
                action: 'status_change',
                resource_type: 'ticket',
                resource_id: ticketId,
                details: { from: currentStatus, to: status }
            });
        } catch (logError) {
            // Logging failed is non-critical
        }

        res.json({
            message: 'Ticket status updated successfully',
            ticket: result.rows[0]
        });

    } catch (error) {
        logger.error('Update ticket status error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update ticket status'
        });
    }
});

router.patch('/bulk-update', requireRole(['admin', 'agent']), [
    body('ticket_ids').isArray({ min: 1 }).withMessage('At least one ticket ID required'),
    body('updates').isObject().withMessage('Updates object required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { ticket_ids, updates } = req.body;
        const userId = req.user.id;

        const result = await db.transaction(async (client) => {
            const updateFields = [];
            const values = [];
            let paramIndex = 1;

            Object.entries(updates).forEach(([key, value]) => {
                if (value !== undefined) {
                    updateFields.push(`${key} = $${paramIndex++}`);
                    values.push(value);
                }
            });

            if (updateFields.length === 0) {
                throw new Error('No valid fields to update');
            }

            values.push(ticket_ids);

            const updateResult = await client.query(`
                UPDATE tickets 
                SET ${updateFields.join(', ')}, updated_at = NOW()
                WHERE id = ANY($${paramIndex})
                RETURNING id, title
            `, values);

            for (const ticket of updateResult.rows) {
                try {
                    await db.insertLog({
                        user_id: userId,
                        action: 'bulk_update',
                        resource_type: 'ticket',
                        resource_id: ticket.id,
                        details: { updated_fields: Object.keys(updates), updates }
                    });
                } catch (logError) {
                    // Logging failed is non-critical
                }
            }

            return updateResult.rows;
        });

        res.json({
            message: `${result.length} tickets updated successfully`,
            updated_tickets: result
        });

    } catch (error) {
        logger.error('Bulk update tickets error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update tickets'
        });
    }
});

module.exports = router;