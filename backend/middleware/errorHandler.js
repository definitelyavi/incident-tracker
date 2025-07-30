const logger = require('../utils/logger');

// Custom error class for API errors
class APIError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.name = this.constructor.name;
        
        Error.captureStackTrace(this, this.constructor);
    }
}

// Error handler middleware
const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;

    // Log error
    logger.error('Error occurred:', {
        message: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        user: req.user ? req.user.id : 'anonymous'
    });

    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
        const message = 'Resource not found';
        error = new APIError(message, 404);
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const message = 'Duplicate field value entered';
        error = new APIError(message, 400);
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const message = Object.values(err.errors).map(val => val.message).join(', ');
        error = new APIError(message, 400);
    }

    // PostgreSQL errors
    if (err.code) {
        switch (err.code) {
            case '23505': // Unique violation
                error = new APIError('Duplicate entry found', 400);
                break;
            case '23503': // Foreign key violation
                error = new APIError('Referenced resource not found', 400);
                break;
            case '23502': // Not null violation
                error = new APIError('Required field is missing', 400);
                break;
            case '42P01': // Undefined table
                error = new APIError('Database table not found', 500);
                break;
            case '42703': // Undefined column
                error = new APIError('Database column not found', 500);
                break;
            default:
                if (err.code.startsWith('23')) {
                    error = new APIError('Database constraint violation', 400);
                } else if (err.code.startsWith('42')) {
                    error = new APIError('Database schema error', 500);
                }
        }
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        error = new APIError('Invalid token', 401);
    }

    if (err.name === 'TokenExpiredError') {
        error = new APIError('Token expired', 401);
    }

    // Multer errors (file upload)
    if (err.code === 'LIMIT_FILE_SIZE') {
        error = new APIError('File too large', 400);
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        error = new APIError('Unexpected file field', 400);
    }

    // Express validator errors
    if (err.array && typeof err.array === 'function') {
        const message = err.array().map(error => error.msg).join(', ');
        error = new APIError(message, 400);
    }

    // Rate limit errors
    if (err.status === 429) {
        error = new APIError('Too many requests, please try again later', 429);
    }

    // Default to 500 server error
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal Server Error';

    // Don't leak error details in production
    const errorResponse = {
        error: getErrorName(statusCode),
        message: message
    };

    // Add error details in development
    if (process.env.NODE_ENV === 'development') {
        errorResponse.stack = err.stack;
        errorResponse.details = {
            name: err.name,
            code: err.code,
            sqlState: err.sqlState,
            constraint: err.constraint
        };
    }

    // Add request ID if available
    if (req.id) {
        errorResponse.requestId = req.id;
    }

    res.status(statusCode).json(errorResponse);
};

// Get standardized error names
const getErrorName = (statusCode) => {
    const errorNames = {
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        405: 'Method Not Allowed',
        409: 'Conflict',
        413: 'Payload Too Large',
        415: 'Unsupported Media Type',
        429: 'Too Many Requests',
        500: 'Internal Server Error',
        501: 'Not Implemented',
        502: 'Bad Gateway',
        503: 'Service Unavailable',
        504: 'Gateway Timeout'
    };

    return errorNames[statusCode] || 'Unknown Error';
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// 404 handler
const notFound = (req, res, next) => {
    const error = new APIError(`Route ${req.originalUrl} not found`, 404);
    next(error);
};

// Handle unhandled promise rejections
const handleUnhandledRejection = () => {
    process.on('unhandledRejection', (err, promise) => {
        logger.error('Unhandled Promise Rejection:', {
            error: err.message,
            stack: err.stack,
            promise: promise
        });
    });
};

// Handle uncaught exceptions
const handleUncaughtException = () => {
    process.on('uncaughtException', (err) => {
        logger.error('Uncaught Exception:', {
            error: err.message,
            stack: err.stack
        });
        
        // Graceful shutdown
        process.exit(1);
    });
};

module.exports = {
    errorHandler,
    APIError,
    asyncHandler,
    notFound,
    handleUnhandledRejection,
    handleUncaughtException
};