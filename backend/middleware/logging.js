const logger = require('../utils/logger');

// Simple request logging for errors only
const logRequest = (req, res, next) => {
    const startTime = Date.now();
    
    const originalSend = res.send;
    
    res.send = function(data) {
        const duration = Date.now() - startTime;
        
        // Only log slow requests or errors
        if (duration > 3000 || res.statusCode >= 400) {
            logger.info('Request completed', {
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                duration_ms: duration,
                user_id: req.user?.id
            });
        }

        originalSend.call(this, data);
    };

    next();
};

// Log errors only
const logError = (error, req, res, next) => {
    logger.error('Request error', {
        message: error.message,
        method: req.method,
        url: req.originalUrl,
        user_id: req.user?.id,
        ip: req.ip
    });

    next(error);
};

// Performance monitoring for slow requests only
const logPerformance = (threshold = 3000) => {
    return (req, res, next) => {
        const startTime = process.hrtime.bigint();
        
        const originalEnd = res.end;
        
        res.end = function(...args) {
            const endTime = process.hrtime.bigint();
            const duration = Number(endTime - startTime) / 1000000;

            if (duration > threshold) {
                logger.warn('Slow request detected', {
                    method: req.method,
                    url: req.originalUrl,
                    duration_ms: Math.round(duration),
                    user_id: req.user?.id
                });
            }

            originalEnd.apply(this, args);
        };

        next();
    };
};

module.exports = {
    logRequest,
    logError,
    logPerformance
};