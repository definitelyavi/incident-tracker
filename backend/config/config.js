require('dotenv').config();

const config = {
    // Environment
    NODE_ENV: process.env.NODE_ENV || 'production',
    PORT: process.env.PORT || 3001,
    
    // Frontend URL
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
    
    // JWT Configuration
    JWT: {
        SECRET: process.env.JWT_SECRET,
        REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
        EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
        REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    },
    
    // Database Configuration
    DATABASE: {
        POSTGRES: {
            HOST: process.env.PG_HOST || 'localhost',
            PORT: parseInt(process.env.PG_PORT, 10) || 5432,
            DATABASE: process.env.PG_DATABASE,
            USER: process.env.PG_USER,
            PASSWORD: process.env.PG_PASSWORD,
            MAX_CONNECTIONS: parseInt(process.env.PG_MAX_CONNECTIONS, 10) || 20
        }
    },
    
    // Security Configuration
    SECURITY: {
        BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
        RATE_LIMIT: {
            WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
            MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
            AUTH_MAX_REQUESTS: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 5
        }
    },
    

    // Logging Configuration
    LOGGING: {
        LEVEL: process.env.LOG_LEVEL || 'info',
        DIR: process.env.LOG_DIR || 'logs'
    },
    
    // SLA Configuration
    SLA: {
        CHECK_INTERVAL: parseInt(process.env.SLA_CHECK_INTERVAL_MS, 10) || 15 * 60 * 1000, // 15 minutes
        WARNING_THRESHOLD: parseFloat(process.env.SLA_WARNING_THRESHOLD) || 0.8,
        CRITICAL_THRESHOLD: parseFloat(process.env.SLA_CRITICAL_THRESHOLD) || 0.95
    },
    
    // Business Hours Configuration
    BUSINESS_HOURS: {
        START: process.env.BUSINESS_HOURS_START || '09:00',
        END: process.env.BUSINESS_HOURS_END || '17:00',
        TIMEZONE: process.env.BUSINESS_TIMEZONE || 'UTC',
        WEEKDAYS_ONLY: process.env.BUSINESS_DAYS_ONLY === 'true'
    },
    
    // Feature Flags
    FEATURES: {
        SLA_MONITORING: process.env.ENABLE_SLA_MONITORING !== 'false',
        BULK_OPERATIONS: process.env.ENABLE_BULK_OPERATIONS !== 'false',
        AUDIT_LOGGING: process.env.ENABLE_AUDIT_LOGGING !== 'false'
    },
    
    // Performance Configuration
    PERFORMANCE: {
        SLOW_QUERY_THRESHOLD: parseInt(process.env.SLOW_QUERY_THRESHOLD, 10) || 5000,
        SLOW_REQUEST_THRESHOLD: parseInt(process.env.SLOW_REQUEST_THRESHOLD, 10) || 1000
    },
    
    // Development Configuration
    DEV: {
        CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
        ENABLE_CORS: process.env.ENABLE_CORS !== 'false',
        ENABLE_MORGAN: process.env.ENABLE_MORGAN_LOGGING !== 'false'
    }
};

// Validation for required environment variables
const validateConfig = () => {
    const requiredEnvVars = [
        'JWT_SECRET',
        'JWT_REFRESH_SECRET',
        'PG_DATABASE',
        'PG_USER',
        'PG_PASSWORD'
    ];
    
    const missing = requiredEnvVars.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    // Validate nested config paths
    const requiredPaths = [
        'JWT.SECRET',
        'DATABASE.POSTGRES.HOST',
        'DATABASE.POSTGRES.DATABASE',
        'DATABASE.POSTGRES.USER',
        'DATABASE.POSTGRES.PASSWORD'
    ];
    
    const missingPaths = requiredPaths.filter(key => {
        const value = key.split('.').reduce((obj, k) => obj?.[k], config);
        return !value || value === '';
    });
    
    if (missingPaths.length > 0) {
        throw new Error(`Missing required configuration: ${missingPaths.join(', ')}`);
    }
};

// Validate configuration on load
if (config.NODE_ENV === 'production') {
    validateConfig();
}

// Log configuration status (without sensitive data)
console.log(`Configuration loaded for environment: ${config.NODE_ENV}`);
console.log(`Server will run on port: ${config.PORT}`);

module.exports = config;
