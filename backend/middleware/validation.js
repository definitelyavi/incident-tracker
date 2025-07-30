const { body, param, query, validationResult } = require('express-validator');
const logger = require('../utils/logger');

// Common validation rules
const commonValidations = {
    id: param('id').isInt({ min: 1 }).withMessage('Invalid ID format'),
    
    email: body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Valid email address required'),
    
    password: body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    
    name: body('name')
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be 2-100 characters')
        .matches(/^[a-zA-Z\s\-'\.]+$/)
        .withMessage('Name contains invalid characters'),
    
    role: body('role')
        .isIn(['admin', 'agent', 'viewer'])
        .withMessage('Invalid role'),
    
    priority: body('priority')
        .isIn(['low', 'medium', 'high', 'critical'])
        .withMessage('Invalid priority level'),
    
    status: body('status')
        .isIn(['open', 'in-progress', 'resolved', 'closed'])
        .withMessage('Invalid status'),
    
    category: body('category')
        .isIn(['hardware', 'software', 'network', 'security', 'other'])
        .withMessage('Invalid category'),
    
    pagination: [
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
    ],
    
    dateRange: [
        query('start_date').optional().isISO8601().withMessage('Invalid start date format'),
        query('end_date').optional().isISO8601().withMessage('Invalid end date format')
    ]
};

// User validation schemas
const userValidation = {
    create: [
        commonValidations.email,
        commonValidations.password,
        commonValidations.name,
        commonValidations.role
    ],
    
    update: [
        commonValidations.id,
        body('email').optional().isEmail().normalizeEmail(),
        body('name').optional().isLength({ min: 2, max: 100 }),
        body('role').optional().isIn(['admin', 'agent', 'viewer']),
        body('is_active').optional().isBoolean()
    ],
    
    changePassword: [
        body('current_password').notEmpty().withMessage('Current password is required'),
        commonValidations.password.custom((value, { req }) => {
            if (value === req.body.current_password) {
                throw new Error('New password must be different from current password');
            }
            return true;
        })
    ]
};

// Ticket validation schemas
const ticketValidation = {
    create: [
        body('title')
            .isLength({ min: 5, max: 500 })
            .withMessage('Title must be 5-500 characters'),
        body('description')
            .isLength({ min: 10, max: 5000 })
            .withMessage('Description must be 10-5000 characters'),
        commonValidations.priority,
        commonValidations.category,
        body('assignee_id').optional().isInt({ min: 1 })
    ],
    
    update: [
        commonValidations.id,
        body('title').optional().isLength({ min: 5, max: 500 }),
        body('description').optional().isLength({ min: 10, max: 5000 }),
        body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
        body('status').optional().isIn(['open', 'in-progress', 'resolved', 'closed']),
        body('category').optional().isIn(['hardware', 'software', 'network', 'security', 'other']),
        body('assignee_id').optional().isInt({ min: 1 })
    ],
    
    assign: [
        commonValidations.id,
        body('assignee_id').isInt({ min: 1 }).withMessage('Valid assignee ID required')
    ],
    
    updateStatus: [
        commonValidations.id,
        commonValidations.status
    ]
};

// Comment validation schemas
const commentValidation = {
    create: [
        commonValidations.id, // ticket_id
        body('comment')
            .isLength({ min: 1, max: 2000 })
            .withMessage('Comment must be 1-2000 characters'),
        body('is_internal').optional().isBoolean()
    ]
};

// Notification validation schemas
const notificationValidation = {
    create: [
        body('user_id').isInt({ min: 1 }).withMessage('Valid user ID required'),
        body('ticket_id').optional().isInt({ min: 1 }),
        body('type')
            .isLength({ min: 1, max: 50 })
            .withMessage('Type is required and must be under 50 characters'),
        body('title')
            .isLength({ min: 1, max: 255 })
            .withMessage('Title is required and must be under 255 characters'),
        body('message')
            .isLength({ min: 1, max: 2000 })
            .withMessage('Message is required and must be under 2000 characters')
    ]
};

// Analytics validation schemas
const analyticsValidation = {
    trends: [
        query('period').optional().isIn(['7d', '30d', '90d', '1y']),
        query('interval').optional().isIn(['day', 'week', 'month'])
    ],
    
    userPerformance: [
        param('id').optional().isInt({ min: 1 }),
        ...commonValidations.dateRange
    ]
};

// Validation middleware
const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        const formattedErrors = errors.array().map(error => ({
            field: error.param,
            message: error.msg,
            value: error.value
        }));

        return res.status(400).json({
            error: 'Validation Error',
            message: 'The request contains invalid data',
            details: formattedErrors
        });
    }
    
    next();
};

// Sanitization middleware
const sanitizeInput = (req, res, next) => {
    // Trim strings in body
    if (req.body && typeof req.body === 'object') {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = req.body[key].trim();
            }
        }
    }
    
    // Trim strings in query
    if (req.query && typeof req.query === 'object') {
        for (const key in req.query) {
            if (typeof req.query[key] === 'string') {
                req.query[key] = req.query[key].trim();
            }
        }
    }
    
    next();
};

// Date range validation
const validateDateRange = (req, res, next) => {
    const { start_date, end_date } = req.query;
    
    if (start_date && end_date) {
        const start = new Date(start_date);
        const end = new Date(end_date);
        
        if (start >= end) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Start date must be before end date'
            });
        }
        
        const daysDiff = (end - start) / (1000 * 60 * 60 * 24);
        if (daysDiff > 730) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Date range cannot exceed 2 years'
            });
        }
    }
    
    next();
};

module.exports = {
    userValidation,
    ticketValidation,
    commentValidation,
    notificationValidation,
    analyticsValidation,
    commonValidations,
    validateRequest,
    sanitizeInput,
    validateDateRange
};