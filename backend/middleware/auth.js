const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';

// Main authentication middleware
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Access token required'
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Get user from database
        const result = await db.query(
            'SELECT id, email, name, role, is_active FROM users WHERE id = $1 AND is_active = true',
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            logger.warn('Authentication failed - user not found', { 
                userId: decoded.userId,
                ip: req.ip 
            });
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User not found or inactive'
            });
        }

        req.user = result.rows[0];
        next();

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            logger.warn('Authentication failed - invalid token', { 
                ip: req.ip,
                endpoint: req.path 
            });
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid token'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            logger.warn('Authentication failed - token expired', { 
                ip: req.ip,
                endpoint: req.path 
            });
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Token expired'
            });
        }

        logger.error('Authentication error', { 
            error: error.message,
            stack: error.stack,
            ip: req.ip,
            endpoint: req.path 
        });
        return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Authentication failed'
        });
    }
};

// Role-based authorization middleware
const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required'
            });
        }

        const userRole = req.user.role;
        const hasPermission = Array.isArray(allowedRoles) 
            ? allowedRoles.includes(userRole)
            : allowedRoles === userRole;

        if (!hasPermission) {
            logger.warn('Authorization failed - insufficient permissions', {
                userId: req.user.id,
                userRole: userRole,
                requiredRoles: allowedRoles,
                endpoint: req.path,
                method: req.method
            });
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Insufficient permissions'
            });
        }

        next();
    };
};

// Resource ownership middleware
const requireOwnership = (resourceType) => {
    return async (req, res, next) => {
        try {
            const resourceId = req.params.id;
            const userId = req.user.id;
            const userRole = req.user.role;

            // Admins can access everything
            if (userRole === 'admin') {
                return next();
            }

            let query;
            let params = [resourceId];

            switch (resourceType) {
                case 'ticket':
                    query = 'SELECT reporter_id, assignee_id FROM tickets WHERE id = $1';
                    break;
                case 'user':
                    // Users can only modify their own profile
                    if (parseInt(resourceId) === userId) {
                        return next();
                    }
                    logger.warn('Access denied - user profile ownership check failed', {
                        userId: userId,
                        targetUserId: resourceId
                    });
                    return res.status(403).json({
                        error: 'Forbidden',
                        message: 'Can only access your own profile'
                    });
                case 'comment':
                    query = 'SELECT user_id FROM comments WHERE id = $1';
                    break;
                default:
                    return res.status(400).json({
                        error: 'Bad Request',
                        message: 'Invalid resource type'
                    });
            }

            const result = await db.query(query, params);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: `${resourceType} not found`
                });
            }

            const resource = result.rows[0];
            let hasAccess = false;

            switch (resourceType) {
                case 'ticket':
                    hasAccess = resource.reporter_id === userId || 
                               resource.assignee_id === userId ||
                               userRole === 'agent';
                    break;
                case 'comment':
                    hasAccess = resource.user_id === userId;
                    break;
            }

            if (!hasAccess) {
                logger.warn('Access denied - resource ownership check failed', {
                    userId: userId,
                    resourceType: resourceType,
                    resourceId: resourceId,
                    userRole: userRole
                });
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Access denied to this resource'
                });
            }

            next();

        } catch (error) {
            logger.error('Ownership check error', { 
                error: error.message,
                resourceType: resourceType,
                resourceId: req.params.id,
                userId: req.user?.id 
            });
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Authorization check failed'
            });
        }
    };
};

// Optional authentication middleware
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return next();
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        
        const result = await db.query(
            'SELECT id, email, name, role, is_active FROM users WHERE id = $1 AND is_active = true',
            [decoded.userId]
        );

        if (result.rows.length > 0) {
            req.user = result.rows[0];
        }

        next();

    } catch (error) {
        // Ignore auth errors for optional auth
        next();
    }
};

// JWT token generation helpers
const generateTokens = (userId) => {
    const accessToken = jwt.sign(
        { userId, type: 'access' },
        JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    const refreshToken = jwt.sign(
        { userId, type: 'refresh' },
        JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    return { accessToken, refreshToken };
};

const verifyRefreshToken = (token) => {
    return jwt.verify(token, JWT_REFRESH_SECRET);
};

// Check if user can access ticket
const canAccessTicket = async (userId, userRole, ticketId) => {
    if (userRole === 'admin') return true;

    try {
        const result = await db.query(
            'SELECT reporter_id, assignee_id FROM tickets WHERE id = $1',
            [ticketId]
        );

        if (result.rows.length === 0) return false;

        const ticket = result.rows[0];
        return ticket.reporter_id === userId || 
               ticket.assignee_id === userId || 
               userRole === 'agent';
    } catch (error) {
        logger.error('Error checking ticket access', { 
            error: error.message,
            userId: userId,
            ticketId: ticketId 
        });
        return false;
    }
};

module.exports = {
    authenticateToken,
    requireRole,
    requireOwnership,
    optionalAuth,
    generateTokens,
    verifyRefreshToken,
    canAccessTicket
};