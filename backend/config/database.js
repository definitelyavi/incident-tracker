const { Pool } = require('pg');
const logger = require('../utils/logger');

let pgConfig;

if (process.env.DATABASE_URL) {
    pgConfig = {
        connectionString: process.env.DATABASE_URL,
        max: parseInt(process.env.PG_MAX_CONNECTIONS, 10) || 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    };
} else {
    pgConfig = {
        host: process.env.PG_HOST || 'localhost',
        port: process.env.PG_PORT || 5432,
        database: process.env.PG_DATABASE || 'incident_tracker',
        user: process.env.PG_USER || 'postgres',
        password: process.env.PG_PASSWORD || 'password',
        max: parseInt(process.env.PG_MAX_CONNECTIONS, 10) || 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        ssl: false
    };
}

let pgPool;

async function connectPostgreSQL() {
    try {
        pgPool = new Pool(pgConfig);
        
        const client = await pgPool.connect();
        await client.query('SELECT NOW()');
        client.release();
        
        logger.info('PostgreSQL connected successfully');
        
        pgPool.on('error', (err) => {
            logger.error('Unexpected error on idle PostgreSQL client:', err);
        });
        
        pgPool.on('connect', () => {
            logger.debug('New PostgreSQL client connected');
        });
        
        global.pgPool = pgPool;
        return pgPool;
        
    } catch (error) {
        logger.error('Failed to connect to PostgreSQL:', error);
        throw error;
    }
}

const db = {
    async query(text, params) {
        const start = Date.now();
        try {
            const result = await pgPool.query(text, params);
            const duration = Date.now() - start;
            logger.debug('Query executed', { text, duration, rows: result.rowCount });
            return result;
        } catch (error) {
            logger.error('Database query error:', { text, error: error.message });
            throw error;
        }
    },

    async getClient() {
        return pgPool.connect();
    },

    async transaction(callback) {
        const client = await pgPool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
};

async function checkPostgreSQLHealth() {
    try {
        const result = await pgPool.query('SELECT 1 as health_check');
        return {
            status: 'healthy',
            database: 'postgresql',
            response_time: Date.now(),
            details: result.rows[0]
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            database: 'postgresql',
            error: error.message
        };
    }
}

async function closeConnection() {
    if (pgPool) {
        try {
            await pgPool.end();
            logger.info('PostgreSQL pool closed');
        } catch (err) {
            logger.error('Error closing PostgreSQL pool:', err);
        }
    }
}

module.exports = {
    connectPostgreSQL,
    db,
    checkPostgreSQLHealth,
    closeConnection,
    pgConfig
};