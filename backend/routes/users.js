const express = require('express');
const bcrypt = require('bcryptjs');
const { body, query, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/', requireRole(['admin', 'agent']), [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('role').optional().isIn(['admin', 'agent', 'viewer']),
    query('active').optional().isBoolean(),
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
            role,
            active,
            search
        } = req.query;

        const offset = (page - 1) * limit;

        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        if (role) {
            whereConditions.push(`role = $${paramIndex++}`);
            queryParams.push(role);
        }

        if (active !== undefined) {
            whereConditions.push(`is_active = $${paramIndex++}`);
            queryParams.push(active === 'true');
        }

        if (search) {
            whereConditions.push(`(name ILIKE $${paramIndex++} OR email ILIKE $${paramIndex++})`);
            queryParams.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        const usersQuery = `
            SELECT 
                u.id,
                u.email,
                u.name,
                u.role,
                u.is_active,
                u.last_login,
                u.created_at,
                COUNT(t.id) as assigned_tickets,
                COUNT(CASE WHEN t.status = 'resolved' THEN 1 END) as resolved_tickets
            FROM users u
            LEFT JOIN tickets t ON u.id = t.assignee_id
            ${whereClause}
            GROUP BY u.id, u.email, u.name, u.role, u.is_active, u.last_login, u.created_at
            ORDER BY u.created_at DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;

        queryParams.push(limit, offset);
        const usersResult = await db.query(usersQuery, queryParams);

        const countQuery = `
            SELECT COUNT(*) as total
            FROM users u
            ${whereClause}
        `;

        const countResult = await db.query(countQuery, queryParams.slice(0, -2));
        const total = parseInt(countResult.rows[0].total);

        res.json({
            users: usersResult.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Get users error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve users'
        });
    }
});

router.get('/:id', requireRole(['admin', 'agent']), async (req, res) => {
    try {
        const userId = req.params.id;
        const requesterId = req.user.id;
        const requesterRole = req.user.role;

        if (requesterRole !== 'admin' && parseInt(userId) !== requesterId) {
            const result = await db.query(`
                SELECT id, name, email, role, is_active, created_at
                FROM users 
                WHERE id = $1
            `, [userId]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'User not found'
                });
            }

            return res.json({ user: result.rows[0] });
        }

        const result = await db.query(`
            SELECT 
                u.id,
                u.email,
                u.name,
                u.role,
                u.is_active,
                u.last_login,
                u.created_at,
                COUNT(t.id) as total_tickets,
                COUNT(CASE WHEN t.status = 'resolved' THEN 1 END) as resolved_tickets,
                COUNT(CASE WHEN t.status IN ('open', 'in-progress') THEN 1 END) as active_tickets
            FROM users u
            LEFT JOIN tickets t ON u.id = t.assignee_id
            WHERE u.id = $1
            GROUP BY u.id, u.email, u.name, u.role, u.is_active, u.last_login, u.created_at
        `, [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        res.json({ user: result.rows[0] });

    } catch (error) {
        logger.error('Get user error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve user'
        });
    }
});

router.post('/', requireRole(['admin']), [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('role').isIn(['admin', 'agent', 'viewer']).withMessage('Invalid role')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { email, password, name, role } = req.body;
        const createdBy = req.user.id;

        const existingUser = await db.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'Email already registered'
            });
        }

        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const result = await db.query(`
            INSERT INTO users (email, password_hash, name, role)
            VALUES ($1, $2, $3, $4)
            RETURNING id, email, name, role, is_active, created_at
        `, [email, passwordHash, name, role]);

        const newUser = result.rows[0];

        await db.insertLog({
            user_id: createdBy,
            action: 'create',
            resource_type: 'user',
            resource_id: newUser.id,
            details: { name, email, role }
        });

        res.status(201).json({
            message: 'User created successfully',
            user: newUser
        });

    } catch (error) {
        logger.error('Create user error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to create user'
        });
    }
});

router.put('/:id', requireRole(['admin']), [
    body('name').optional().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').optional().isEmail().normalizeEmail(),
    body('role').optional().isIn(['admin', 'agent', 'viewer']).withMessage('Invalid role')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const userId = req.params.id;
        const { name, email, role } = req.body;
        const requesterId = req.user.id;

        const userCheck = await db.query('SELECT id, name, email, role FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const currentUser = userCheck.rows[0];

        if (email && email !== currentUser.email) {
            const emailCheck = await db.query(
                'SELECT id FROM users WHERE email = $1 AND id != $2',
                [email, userId]
            );

            if (emailCheck.rows.length > 0) {
                return res.status(409).json({
                    error: 'Email Already Exists',
                    message: 'This email address is already registered to another user'
                });
            }
        }

        if (parseInt(userId) === requesterId && role && currentUser.role !== role) {
            return res.status(400).json({
                error: 'Forbidden',
                message: 'You cannot change your own role'
            });
        }

        const updateFields = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined) {
            updateFields.push(`name = $${paramIndex++}`);
            values.push(name);
        }

        if (email !== undefined) {
            updateFields.push(`email = $${paramIndex++}`);
            values.push(email);
        }

        if (role !== undefined) {
            updateFields.push(`role = $${paramIndex++}`);
            values.push(role);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'No fields to update'
            });
        }

        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(userId);

        const updateResult = await db.query(
            `UPDATE users 
             SET ${updateFields.join(', ')}
             WHERE id = $${paramIndex}
             RETURNING id, name, email, role, is_active, created_at, updated_at`,
            values
        );

        if (updateResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found during update'
            });
        }

        const updatedUser = updateResult.rows[0];

        try {
            await db.insertLog({
                user_id: requesterId,
                action: 'update',
                resource_type: 'user',
                resource_id: userId,
                details: {
                    old_data: { name: currentUser.name, email: currentUser.email, role: currentUser.role },
                    new_data: { name: name || currentUser.name, email: email || currentUser.email, role: role || currentUser.role }
                }
            });
        } catch (logError) {
            // Logging failed is non-critical
        }

        res.json({
            message: 'User updated successfully',
            user: updatedUser
        });

    } catch (error) {
        logger.error('Update user error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update user'
        });
    }
});

router.patch('/:id/status', requireRole(['admin']), async (req, res) => {
    try {
        const userId = req.params.id;
        const { is_active } = req.body;
        const requesterId = req.user.id;

        if (parseInt(userId) === requesterId) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Cannot change your own account status'
            });
        }

        const userResult = await db.query('SELECT name, email, role, is_active FROM users WHERE id = $1', [userId]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const user = userResult.rows[0];

        if (user.role === 'admin' && is_active === false) {
            return res.status(400).json({
                error: 'Forbidden',
                message: 'Admin users cannot be deactivated'
            });
        }

        const updateResult = await db.query(
            'UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            [is_active, userId]
        );

        if (updateResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        try {
            await db.insertLog({
                user_id: requesterId,
                action: is_active ? 'activate' : 'deactivate',
                resource_type: 'user',
                resource_id: userId,
                details: { 
                    name: user.name, 
                    email: user.email, 
                    role: user.role,
                    status_changed_to: is_active ? 'active' : 'inactive'
                }
            });
        } catch (logError) {
            // Logging failed is non-critical
        }

        const action = is_active ? 'activated' : 'deactivated';
        return res.json({
            message: `User "${user.name}" ${action} successfully`,
            user: updateResult.rows[0]
        });

    } catch (error) {
        logger.error('Update user status error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update user status'
        });
    }
});

router.delete('/:id', requireRole(['admin']), async (req, res) => {
    try {
        const userId = req.params.id;
        const requesterId = req.user.id;

        if (parseInt(userId) === requesterId) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Cannot delete your own account'
            });
        }

        const userResult = await db.query('SELECT name, email, role FROM users WHERE id = $1', [userId]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const user = userResult.rows[0];

        if (user.role === 'admin') {
            return res.status(400).json({
                error: 'Forbidden',
                message: 'You cannot delete Admin users'
            });
        }

        const assignedTickets = await db.query('SELECT COUNT(*) as count FROM tickets WHERE assignee_id = $1', [userId]);
        const reportedTickets = await db.query('SELECT COUNT(*) as count FROM tickets WHERE reporter_id = $1', [userId]);
        const commentsCount = await db.query('SELECT COUNT(*) as count FROM comments WHERE user_id = $1', [userId]);
        const historyCount = await db.query('SELECT COUNT(*) as count FROM ticket_history WHERE user_id = $1', [userId]);

        const totalReferences = parseInt(assignedTickets.rows[0].count) + 
                              parseInt(reportedTickets.rows[0].count) + 
                              parseInt(commentsCount.rows[0].count) + 
                              parseInt(historyCount.rows[0].count);

        if (totalReferences > 0) {
            const details = [];
            if (assignedTickets.rows[0].count > 0) details.push(`${assignedTickets.rows[0].count} assigned tickets`);
            if (reportedTickets.rows[0].count > 0) details.push(`${reportedTickets.rows[0].count} reported tickets`);
            if (commentsCount.rows[0].count > 0) details.push(`${commentsCount.rows[0].count} comments`);
            if (historyCount.rows[0].count > 0) details.push(`${historyCount.rows[0].count} audit trail entries`);

            return res.status(400).json({
                error: 'Cannot Delete User',
                message: `User "${user.name}" has historical data: ${details.join(', ')}. The audit trail must be preserved for compliance.`,
                suggestion: 'Use the deactivate button instead - this safely disables the account while preserving all historical data.',
                details: {
                    assigned_tickets: assignedTickets.rows[0].count,
                    reported_tickets: reportedTickets.rows[0].count,
                    comments: commentsCount.rows[0].count,
                    history_entries: historyCount.rows[0].count
                }
            });
        }

        await db.query('BEGIN');

        try {
            const deleteResult = await db.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
            
            if (deleteResult.rows.length === 0) {
                throw new Error('User not found during deletion');
            }

            await db.query('COMMIT');

            try {
                await db.insertLog({
                    user_id: requesterId,
                    action: 'delete',
                    resource_type: 'user',
                    resource_id: userId,
                    details: { name: user.name, email: user.email, role: user.role }
                });
            } catch (logError) {
                // Logging failed is non-critical
            }

            return res.json({
                message: `User "${user.name}" deleted successfully`
            });

        } catch (transactionError) {
            await db.query('ROLLBACK');
            
            if (transactionError.code === '23503') {
                return res.status(400).json({
                    error: 'Cannot Delete User',
                    message: `User "${user.name}" has database references that prevent deletion.`,
                    suggestion: 'Use the deactivate button to safely disable the account.',
                    technical_details: transactionError.constraint || transactionError.detail
                });
            }
            
            throw transactionError;
        }

    } catch (error) {
        logger.error('Delete user error:', error);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete user',
            details: error.message
        });
    }
});

router.patch('/:id/role', requireRole(['admin']), [
    body('role').isIn(['admin', 'agent', 'viewer']).withMessage('Invalid role')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const userId = req.params.id;
        const { role } = req.body;
        const requesterId = req.user.id;

        const currentResult = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
        if (currentResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const currentRole = currentResult.rows[0].role;

        const result = await db.query(`
            UPDATE users 
            SET role = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, name, email, role
        `, [role, userId]);

        await db.insertLog({
            user_id: requesterId,
            action: 'role_change',
            resource_type: 'user',
            resource_id: userId,
            details: { from: currentRole, to: role }
        });

        res.json({
            message: 'User role updated successfully',
            user: result.rows[0]
        });

    } catch (error) {
        logger.error('Update user role error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update user role'
        });
    }
});

router.get('/:id/performance', requireRole(['admin', 'agent']), async (req, res) => {
    try {
        const userId = req.params.id;

        const result = await db.query(`
            SELECT 
                COUNT(t.id) as total_assigned,
                COUNT(CASE WHEN t.status = 'resolved' THEN 1 END) as resolved,
                COUNT(CASE WHEN t.status IN ('open', 'in-progress') THEN 1 END) as active,
                AVG(CASE WHEN t.resolved_at IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/3600 
                END) as avg_resolution_hours,
                COUNT(CASE WHEN t.resolved_at <= t.sla_target THEN 1 END) as within_sla,
                COUNT(CASE WHEN t.sla_target IS NOT NULL THEN 1 END) as total_with_sla
            FROM tickets t
            WHERE t.assignee_id = $1
        `, [userId]);

        const stats = result.rows[0];

        const resolutionRate = stats.total_assigned > 0 
            ? Math.round((stats.resolved / stats.total_assigned) * 100) 
            : 0;

        const slaCompliance = stats.total_with_sla > 0 
            ? Math.round((stats.within_sla / stats.total_with_sla) * 100) 
            : 0;

        res.json({
            performance: {
                ...stats,
                resolution_rate: resolutionRate,
                sla_compliance: slaCompliance,
                avg_resolution_hours: Math.round(parseFloat(stats.avg_resolution_hours || 0) * 100) / 100
            }
        });

    } catch (error) {
        logger.error('Get user performance error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve user performance'
        });
    }
});

router.post('/reset-demo', requireRole(['admin']), async (req, res) => {
    try {
        await db.query('BEGIN');
        
        try {
            await db.query('DELETE FROM attachments');
            await db.query('DELETE FROM ticket_history');
            await db.query('DELETE FROM comments');
            await db.query('DELETE FROM notifications');
            await db.query('DELETE FROM tickets');
            
            const deletedUsersResult = await db.query('DELETE FROM users WHERE role != $1 RETURNING email', ['admin']);
            
            await db.query('ALTER SEQUENCE tickets_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE comments_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE notifications_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE attachments_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE ticket_history_id_seq RESTART WITH 1');
            
            await db.query('COMMIT');
            
            res.json({ 
                success: true, 
                message: 'All data cleared successfully',
                cleared: {
                    tickets: true,
                    comments: true,
                    notifications: true,
                    attachments: true,
                    ticket_history: true,
                    non_admin_users: deletedUsersResult.rows.length
                }
            });
            
        } catch (transactionError) {
            await db.query('ROLLBACK');
            throw transactionError;
        }
        
    } catch (error) {
        logger.error('Reset demo error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Reset failed',
            message: error.message 
        });
    }
});

module.exports = router;