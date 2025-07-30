const express = require('express');
const { db } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/dashboard', async (req, res) => {
    try {
        const metricsQuery = `
            SELECT 
                COUNT(*) as total_tickets,
                COUNT(CASE WHEN status = 'open' THEN 1 END) as open_tickets,
                COUNT(CASE WHEN status = 'in-progress' THEN 1 END) as in_progress_tickets,
                COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_tickets,
                COUNT(CASE WHEN priority = 'critical' AND status NOT IN ('resolved', 'closed') THEN 1 END) as critical_active,
                COUNT(CASE WHEN priority = 'high' AND status NOT IN ('resolved', 'closed') THEN 1 END) as high_active,
                COUNT(CASE WHEN resolved_at::date = CURRENT_DATE THEN 1 END) as resolved_today
            FROM tickets
        `;

        const result = await db.query(metricsQuery);
        const metrics = result.rows[0] || {};

        let recentActivity = [];

        try {
            const createdQuery = `
                SELECT 
                    'ticket_created' as action,
                    t.id as ticket_id,
                    t.title,
                    t.priority,
                    t.status,
                    t.created_at as timestamp,
                    COALESCE(u.name, 'Unknown User') as user_name
                FROM tickets t
                LEFT JOIN users u ON t.reporter_id = u.id
                WHERE t.created_at >= NOW() - INTERVAL '7 days'
                AND t.priority NOT IN ('critical', 'high')
                ORDER BY t.created_at DESC
                LIMIT 5
            `;
            const createdResult = await db.query(createdQuery);
            recentActivity = [...recentActivity, ...createdResult.rows];

            const updatedQuery = `
                SELECT 
                    'ticket_updated' as action,
                    t.id as ticket_id,
                    t.title,
                    t.priority,
                    t.status,
                    t.updated_at as timestamp,
                    COALESCE(assignee.name, reporter.name, 'System') as user_name
                FROM tickets t
                LEFT JOIN users assignee ON t.assignee_id = assignee.id
                LEFT JOIN users reporter ON t.reporter_id = reporter.id
                WHERE t.updated_at >= NOW() - INTERVAL '7 days'
                AND t.updated_at > t.created_at + INTERVAL '5 minutes'
                ORDER BY t.updated_at DESC
                LIMIT 5
            `;
            const updatedResult = await db.query(updatedQuery);
            recentActivity = [...recentActivity, ...updatedResult.rows];

            const resolvedQuery = `
                SELECT 
                    'ticket_resolved' as action,
                    t.id as ticket_id,
                    t.title,
                    t.priority,
                    t.status,
                    t.resolved_at as timestamp,
                    COALESCE(assignee.name, reporter.name, 'System') as user_name
                FROM tickets t
                LEFT JOIN users assignee ON t.assignee_id = assignee.id
                LEFT JOIN users reporter ON t.reporter_id = reporter.id
                WHERE t.resolved_at >= NOW() - INTERVAL '7 days'
                AND t.resolved_at IS NOT NULL
                ORDER BY t.resolved_at DESC
                LIMIT 5
            `;
            const resolvedResult = await db.query(resolvedQuery);
            recentActivity = [...recentActivity, ...resolvedResult.rows];

            const escalatedQuery = `
                SELECT 
                    'ticket_escalated' as action,
                    t.id as ticket_id,
                    t.title,
                    t.priority,
                    t.status,
                    t.created_at as timestamp,
                    COALESCE(u.name, 'Unknown User') as user_name
                FROM tickets t
                LEFT JOIN users u ON t.reporter_id = u.id
                WHERE t.priority IN ('critical', 'high')
                AND t.created_at >= NOW() - INTERVAL '7 days'
                ORDER BY t.created_at DESC
                LIMIT 5
            `;
            const escalatedResult = await db.query(escalatedQuery);
            recentActivity = [...recentActivity, ...escalatedResult.rows];

            const assignedQuery = `
                SELECT 
                    'ticket_assigned' as action,
                    t.id as ticket_id,
                    t.title,
                    t.priority,
                    t.status,
                    GREATEST(t.updated_at, t.created_at) as timestamp,
                    COALESCE(assignee.name, 'Unknown User') as user_name
                FROM tickets t
                LEFT JOIN users assignee ON t.assignee_id = assignee.id
                WHERE t.assignee_id IS NOT NULL
                AND GREATEST(t.updated_at, t.created_at) >= NOW() - INTERVAL '7 days'
                AND GREATEST(t.updated_at, t.created_at) > t.created_at + INTERVAL '2 minutes'
                ORDER BY GREATEST(t.updated_at, t.created_at) DESC
                LIMIT 3
            `;
            const assignedResult = await db.query(assignedQuery);
            recentActivity = [...recentActivity, ...assignedResult.rows];

        } catch (activityError) {
            logger.error('Error fetching recent activity:', activityError);
            const fallbackQuery = `
                SELECT 
                    CASE 
                        WHEN t.priority IN ('critical', 'high') THEN 'ticket_escalated'
                        ELSE 'ticket_created'
                    END as action,
                    t.id as ticket_id,
                    t.title,
                    t.priority,
                    t.status,
                    t.created_at as timestamp,
                    COALESCE(u.name, 'Unknown User') as user_name
                FROM tickets t
                LEFT JOIN users u ON t.reporter_id = u.id
                ORDER BY t.created_at DESC
                LIMIT 10
            `;
            const fallbackResult = await db.query(fallbackQuery);
            recentActivity = fallbackResult.rows;
        }

        recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        const seen = new Set();
        recentActivity = recentActivity.filter(activity => {
            const key = `${activity.ticket_id}-${activity.action}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
        
        recentActivity = recentActivity.slice(0, 15);

        const formattedActivity = recentActivity.map(activity => ({
            action: activity.action,
            ticket_id: activity.ticket_id,
            title: activity.title,
            priority: activity.priority,
            status: activity.status,
            timestamp: activity.timestamp,
            user_name: activity.user_name || 'Unknown User',
            time_ago: getTimeAgo(activity.timestamp)
        }));

        res.json({
            metrics: {
                total_tickets: parseInt(metrics.total_tickets || 0),
                open_tickets: parseInt(metrics.open_tickets || 0),
                in_progress_tickets: parseInt(metrics.in_progress_tickets || 0),
                resolved_tickets: parseInt(metrics.resolved_tickets || 0),
                critical_active: parseInt(metrics.critical_active || 0),
                high_active: parseInt(metrics.high_active || 0),
                resolved_today: parseInt(metrics.resolved_today || 0)
            },
            sla: {
                compliance_percentage: 85
            },
            recent_activity: formattedActivity
        });

    } catch (error) {
        logger.error('Analytics dashboard error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve dashboard analytics'
        });
    }
});

router.get('/sla', async (req, res) => {
    try {
        res.json({
            sla: {
                response_time: 85,
                resolution_time: 72,
                compliance_percentage: 85
            }
        });
    } catch (error) {
        logger.error('SLA error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve SLA data'
        });
    }
});

function getTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInSeconds = Math.floor((now - time) / 1000);

    if (diffInSeconds < 60) {
        return 'just now';
    } else if (diffInSeconds < 3600) {
        const minutes = Math.floor(diffInSeconds / 60);
        return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    } else if (diffInSeconds < 86400) {
        const hours = Math.floor(diffInSeconds / 3600);
        return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else {
        const days = Math.floor(diffInSeconds / 86400);
        return `${days} day${days !== 1 ? 's' : ''} ago`;
    }
}

module.exports = router;