const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { 
    generateTokens, 
    verifyRefreshToken, 
    authenticateToken 
} = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/setup-demo', async (req, res) => {
    try {
        const demoPassword = 'password123';
        const hashedPassword = await bcrypt.hash(demoPassword, 12);
        
        await db.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [
            'admin@test.com', 'agent@test.com', 'viewer@test.com'
        ]);
        
        await db.query(`
            INSERT INTO users (email, password_hash, name, role, is_active, created_at, updated_at) 
            VALUES 
                ($1, $2, $3, $4, $5, NOW(), NOW()),
                ($6, $7, $8, $9, $10, NOW(), NOW()),
                ($11, $12, $13, $14, $15, NOW(), NOW())
        `, [
            'admin@test.com', hashedPassword, 'Demo Admin', 'admin', true,
            'agent@test.com', hashedPassword, 'Demo Agent', 'agent', true,
            'viewer@test.com', hashedPassword, 'Demo Viewer', 'viewer', true
        ]);
        
        res.json({
            success: true,
            message: 'Demo users created successfully',
            credentials: {
                admin: 'admin@test.com / password123',
                agent: 'agent@test.com / password123',
                viewer: 'viewer@test.com / password123'
            }
        });
        
    } catch (error) {
        logger.error('Demo setup error:', error);
        res.status(500).json({
            error: 'Demo setup failed',
            message: error.message
        });
    }
});

router.post('/setup-demo', async (req, res) => {
    try {
        const demoPassword = 'password123';
        const hashedPassword = await bcrypt.hash(demoPassword, 12);
        
        await db.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [
            'admin@test.com', 'agent@test.com', 'viewer@test.com'
        ]);
        
        await db.query(`
            INSERT INTO users (email, password_hash, name, role, is_active, created_at, updated_at) 
            VALUES 
                ($1, $2, $3, $4, $5, NOW(), NOW()),
                ($6, $7, $8, $9, $10, NOW(), NOW()),
                ($11, $12, $13, $14, $15, NOW(), NOW())
        `, [
            'admin@test.com', hashedPassword, 'Demo Admin', 'admin', true,
            'agent@test.com', hashedPassword, 'Demo Agent', 'agent', true,
            'viewer@test.com', hashedPassword, 'Demo Viewer', 'viewer', true
        ]);
        
        res.json({
            success: true,
            message: 'Demo users created successfully',
            credentials: {
                admin: 'admin@test.com / password123',
                agent: 'agent@test.com / password123',
                viewer: 'viewer@test.com / password123'
            }
        });
        
    } catch (error) {
        logger.error('Demo setup error:', error);
        res.status(500).json({
            error: 'Demo setup failed',
            message: error.message
        });
    }
});

router.get('/hash-password', async (req, res) => {
    try {
        const hash = await bcrypt.hash('password123', 12);
        res.json({ 
            password: 'password123',
            hash: hash 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/demo-status', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT email, name, role, is_active 
            FROM users 
            WHERE email IN ('admin@test.com', 'agent@test.com', 'viewer@test.com')
            ORDER BY 
                CASE role 
                    WHEN 'admin' THEN 1 
                    WHEN 'agent' THEN 2 
                    WHEN 'viewer' THEN 3 
                END
        `);
        
        const demoUsers = result.rows;
        const isReady = demoUsers.length >= 1;
        
        res.json({
            ready: isReady,
            users: demoUsers,
            credentials: {
                admin: 'admin@test.com / password123',
                agent: 'agent@test.com / password123', 
                viewer: 'viewer@test.com / password123'
            }
        });
        
    } catch (error) {
        logger.error('Demo status error:', error);
        res.status(500).json({
            error: 'Failed to check demo status',
            message: error.message
        });
    }
});

router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 1 }).withMessage('Password is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { email, password } = req.body;

        const result = await db.query(
            'SELECT id, email, password_hash, name, role, is_active FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid email or password'
            });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Account is deactivated'
            });
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid email or password'
            });
        }

        const { accessToken, refreshToken } = generateTokens(user.id);

        await db.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
        );

        res.json({
            message: 'Login successful',
            token: accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role
            }
        });

    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Login failed'
        });
    }
});

router.post('/register', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
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

        const { email, password, name, role = 'viewer' } = req.body;

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

        const result = await db.query(
            'INSERT INTO users (email, password_hash, name, role, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id, email, name, role',
            [email, passwordHash, name, role, true]
        );

        const newUser = result.rows[0];

        const { accessToken, refreshToken } = generateTokens(newUser.id);

        res.status(201).json({
            message: 'Registration successful',
            token: accessToken,
            refreshToken,
            user: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name,
                role: newUser.role
            }
        });

    } catch (error) {
        logger.error('Registration error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Registration failed'
        });
    }
});

router.post('/refresh', [
    body('refreshToken').isLength({ min: 1 }).withMessage('Refresh token is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { refreshToken } = req.body;

        const decoded = verifyRefreshToken(refreshToken);
        
        if (decoded.type !== 'refresh') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid token type'
            });
        }

        const result = await db.query(
            'SELECT id, email, name, role, is_active FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (result.rows.length === 0 || !result.rows[0].is_active) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User not found or inactive'
            });
        }

        const user = result.rows[0];

        const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id);

        res.json({
            message: 'Token refreshed successfully',
            token: accessToken,
            refreshToken: newRefreshToken
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid or expired refresh token'
            });
        }

        logger.error('Token refresh error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Token refresh failed'
        });
    }
});

router.get('/me', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, email, name, role, created_at, last_login FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        res.json({
            user: result.rows[0]
        });

    } catch (error) {
        logger.error('Get current user error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get user information'
        });
    }
});

router.post('/logout', authenticateToken, async (req, res) => {
    try {
        res.json({
            message: 'Logged out successfully'
        });

    } catch (error) {
        logger.error('Logout error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Logout failed'
        });
    }
});

module.exports = router;