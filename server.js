const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

const { connectPostgreSQL } = require('./backend/config/database');
const authRoutes = require('./backend/routes/auth');
const ticketRoutes = require('./backend/routes/tickets');
const userRoutes = require('./backend/routes/users');
const analyticsRoutes = require('./backend/routes/analytics');
const notificationRoutes = require('./backend/routes/notifications');
const searchRoutes = require('./backend/routes/search');

const { requireRole, authenticateToken } = require('./backend/middleware/auth');
const errorHandler = require('./backend/middleware/simpleErrorHandler');
const logger = require('./backend/utils/logger');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"]
        }
    }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: NODE_ENV === 'production' ? 100 : 1000,
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: NODE_ENV === 'production' ? 50 : 100,
    message: { error: 'Too many authentication attempts, please try again later.' }
});

app.use('/api/auth', authLimiter);
app.use('/api', limiter);

// Basic middleware
app.use(compression());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP request logging
if (NODE_ENV === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined', {
        stream: { write: message => logger.info(message.trim()) },
        skip: (req, res) => res.statusCode < 400
    }));
}

// Serve static files
app.use(express.static('frontend', {
    setHeaders: (res, path) => {
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        }
    }
}));

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: NODE_ENV
    });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/tickets', authenticateToken, ticketRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/analytics', authenticateToken, analyticsRoutes);
app.use('/api/notifications', authenticateToken, notificationRoutes);
app.use('/api/search', authenticateToken, searchRoutes);

// SLA endpoints
app.get('/api/sla/compliance', authenticateToken, async (req, res) => {
    try {
        const slaService = require('./backend/services/slaService');
        const timeframe = req.query.timeframe || '30d';
        const compliance = await slaService.getSLACompliance(timeframe);
        res.json(compliance);
    } catch (error) {
        logger.error('SLA compliance error', { error: error.message });
        res.status(500).json({ 
            error: 'SLA compliance data not available',
            message: error.message 
        });
    }
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`
    });
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Error handling
app.use(errorHandler);

let server;
let slaService;

async function startServer() {
    try {
        await connectPostgreSQL();
        
        server = app.listen(PORT, () => {
            logger.info('Server started', { port: PORT, environment: NODE_ENV });
        });
        
        global.server = server;
        
        // Start SLA monitoring
        try {
            slaService = require('./backend/services/slaService');
            await slaService.startMonitoring();
        } catch (slaError) {
            logger.warn('SLA monitoring failed to start', { error: slaError.message });
        }
        
    } catch (error) {
        logger.error('Server startup failed', { error: error.message });
        process.exit(1);
    }
}

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    if (slaService) {
        try {
            slaService.stopMonitoring();
        } catch (error) {
            logger.error('Error stopping SLA monitoring', { error: error.message });
        }
    }
    
    if (server) {
        server.close(() => {
            process.exit(0);
        });
        
        setTimeout(() => {
            process.exit(1);
        }, 10000);
    }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    process.exit(1);
});

// Start the application
if (require.main === module) {
    startServer();
}

module.exports = app;