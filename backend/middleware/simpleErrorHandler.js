const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    if (err.statusCode >= 500 || !err.statusCode) {
        logger.error('Server error', {
            message: err.message,
            url: req.originalUrl,
            method: req.method,
            user_id: req.user?.id
        });
    }

    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    res.status(statusCode).json({
        error: 'Server Error',
        message: message
    });
};

module.exports = errorHandler;