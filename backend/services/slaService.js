const { db } = require('../config/database');
const logger = require('../utils/logger');

class SLAService {
    constructor() {
        this.alertThresholds = {
            warning: 0.8,
            critical: 0.95
        };
        this.checkInterval = 15 * 60 * 1000;
        this.isRunning = false;
        this.intervalId = null;
    }

    async startMonitoring() {
        if (this.isRunning) {
            return;
        }

        try {
            await this.loadSLASettings();
            this.intervalId = setInterval(() => {
                this.checkSLABreaches().catch(error => {
                    logger.error('SLA monitoring error:', error);
                });
            }, this.checkInterval);

            this.isRunning = true;

        } catch (error) {
            logger.error('Failed to start SLA monitoring:', error);
            throw error;
        }
    }

    stopMonitoring() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
    }

    async loadSLASettings() {
        try {
            const result = await db.query(
                "SELECT value FROM settings WHERE key = 'sla_alerts'"
            );

            if (result.rows.length > 0) {
                const settings = result.rows[0].value;
                if (settings.warning_threshold) {
                    this.alertThresholds.warning = settings.warning_threshold;
                }
                if (settings.critical_threshold) {
                    this.alertThresholds.critical = settings.critical_threshold;
                }
            }
        } catch (error) {
            logger.error('Failed to load SLA settings:', error);
        }
    }

    async checkSLABreaches() {
        try {
            const activeTickets = await this.getActiveTicketsWithSLA();
            const now = new Date();

            for (const ticket of activeTickets) {
                await this.evaluateTicketSLA(ticket, now);
            }

        } catch (error) {
            logger.error('Error checking SLA breaches:', error);
        }
    }

    async getActiveTicketsWithSLA() {
        try {
            const result = await db.query(`
                SELECT 
                    t.*,
                    reporter.name as reporter_name,
                    reporter.email as reporter_email,
                    assignee.name as assignee_name,
                    assignee.email as assignee_email
                FROM tickets t
                LEFT JOIN users reporter ON t.reporter_id = reporter.id
                LEFT JOIN users assignee ON t.assignee_id = assignee.id
                WHERE t.status NOT IN ('resolved', 'closed')
                AND t.sla_target IS NOT NULL
                ORDER BY t.sla_target ASC
            `);

            return result.rows;
        } catch (error) {
            logger.error('Failed to get active tickets with SLA:', error);
            return [];
        }
    }

    async evaluateTicketSLA(ticket, currentTime) {
        const slaTarget = new Date(ticket.sla_target);
        const createdAt = new Date(ticket.created_at);
        
        const totalSLATime = slaTarget.getTime() - createdAt.getTime();
        const elapsedTime = currentTime.getTime() - createdAt.getTime();
        const remainingTime = slaTarget.getTime() - currentTime.getTime();
        
        const slaPercentage = elapsedTime / totalSLATime;
        const hoursRemaining = remainingTime / (1000 * 60 * 60);
        const hoursOverdue = hoursRemaining < 0 ? Math.abs(hoursRemaining) : 0;

        if (remainingTime < 0) {
            await this.handleSLABreach(ticket, hoursOverdue);
            return;
        }

        if (slaPercentage >= this.alertThresholds.critical) {
            await this.handleCriticalSLAWarning(ticket, hoursRemaining);
            return;
        }

        if (slaPercentage >= this.alertThresholds.warning) {
            await this.handleSLAWarning(ticket, hoursRemaining);
        }
    }

    async handleSLABreach(ticket, hoursOverdue) {
        try {
            const existingBreach = await this.checkExistingAlert(ticket.id, 'breach');
            if (existingBreach) {
                return;
            }

            await this.recordSLAAlert(ticket.id, 'breach', {
                hours_overdue: hoursOverdue,
                sla_target: ticket.sla_target
            });

            await this.sendBreachNotifications(ticket, hoursOverdue);

        } catch (error) {
            logger.error('Failed to handle SLA breach:', error);
        }
    }

    async handleCriticalSLAWarning(ticket, hoursRemaining) {
        try {
            const existingAlert = await this.checkExistingAlert(ticket.id, 'critical');
            if (existingAlert) {
                return;
            }

            await this.recordSLAAlert(ticket.id, 'critical', {
                hours_remaining: hoursRemaining,
                sla_target: ticket.sla_target
            });

            await this.sendCriticalWarningNotifications(ticket, hoursRemaining);

        } catch (error) {
            logger.error('Failed to handle critical SLA warning:', error);
        }
    }

    async handleSLAWarning(ticket, hoursRemaining) {
        try {
            const existingAlert = await this.checkExistingAlert(ticket.id, 'warning');
            if (existingAlert) {
                return;
            }

            await this.recordSLAAlert(ticket.id, 'warning', {
                hours_remaining: hoursRemaining,
                sla_target: ticket.sla_target
            });

            await this.sendWarningNotifications(ticket, hoursRemaining);

        } catch (error) {
            logger.error('Failed to handle SLA warning:', error);
        }
    }

    async checkExistingAlert(ticketId, alertType) {
        try {
            const result = await db.query(`
                SELECT id FROM notifications 
                WHERE ticket_id = $1 AND type = $2
                AND created_at > NOW() - INTERVAL '24 hours'
            `, [ticketId, `sla_${alertType}`]);

            return result.rows.length > 0;
        } catch (error) {
            logger.error('Failed to check existing alert:', error);
            return false;
        }
    }

    async recordSLAAlert(ticketId, alertType, details) {
        try {
            await db.insertLog({
                action: 'sla_alert',
                resource_type: 'ticket',
                resource_id: ticketId,
                details: {
                    alert_type: alertType,
                    ...details
                }
            });
        } catch (error) {
            logger.error('Failed to record SLA alert:', error);
        }
    }

    async sendBreachNotifications(ticket, hoursOverdue) {
        try {
            if (ticket.assignee_id) {
                await this.createSLANotification(
                    ticket.assignee_id,
                    ticket.id,
                    'sla_breach',
                    `SLA Breach - Ticket #${ticket.id}`,
                    `Ticket "${ticket.title}" has exceeded its SLA by ${Math.round(hoursOverdue * 100) / 100} hours. Immediate attention required.`
                );
            }

            if (ticket.reporter_id !== ticket.assignee_id) {
                await this.createSLANotification(
                    ticket.reporter_id,
                    ticket.id,
                    'sla_breach',
                    `SLA Breach Alert - Your Ticket #${ticket.id}`,
                    `Your ticket "${ticket.title}" has exceeded its SLA target. We are working to resolve this urgently.`
                );
            }

        } catch (error) {
            logger.error('Failed to send breach notifications:', error);
        }
    }

    async sendCriticalWarningNotifications(ticket, hoursRemaining) {
        try {
            if (ticket.assignee_id) {
                await this.createSLANotification(
                    ticket.assignee_id,
                    ticket.id,
                    'sla_critical',
                    `Critical SLA Warning - Ticket #${ticket.id}`,
                    `Ticket "${ticket.title}" will breach SLA in ${Math.round(hoursRemaining * 100) / 100} hours. Urgent action needed.`
                );
            }
        } catch (error) {
            logger.error('Failed to send critical warning notifications:', error);
        }
    }

    async sendWarningNotifications(ticket, hoursRemaining) {
        try {
            if (ticket.assignee_id) {
                await this.createSLANotification(
                    ticket.assignee_id,
                    ticket.id,
                    'sla_warning',
                    `SLA Warning - Ticket #${ticket.id}`,
                    `Ticket "${ticket.title}" will breach SLA in ${Math.round(hoursRemaining * 100) / 100} hours.`
                );
            }
        } catch (error) {
            logger.error('Failed to send warning notifications:', error);
        }
    }

    async createSLANotification(userId, ticketId, type, title, message) {
        try {
            await db.query(`
                INSERT INTO notifications (user_id, ticket_id, type, title, message)
                VALUES ($1, $2, $3, $4, $5)
            `, [userId, ticketId, type, title, message]);
        } catch (error) {
            logger.error('Failed to create SLA notification:', error);
        }
    }

    async calculateSLATarget(priority, businessHoursOnly = false) {
        try {
            const result = await db.query(
                'SELECT resolution_time_hours FROM sla_configs WHERE priority = $1 AND is_active = true',
                [priority]
            );

            if (result.rows.length === 0) {
                const defaultSLA = {
                    'critical': 4,
                    'high': 24,
                    'medium': 72,
                    'low': 120
                };
                return this.addBusinessHours(new Date(), defaultSLA[priority] || 72, businessHoursOnly);
            }

            const hours = result.rows[0].resolution_time_hours;
            return this.addBusinessHours(new Date(), hours, businessHoursOnly);

        } catch (error) {
            logger.error('Failed to calculate SLA target:', error);
            return new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
    }

    addBusinessHours(startDate, hours, businessHoursOnly) {
        if (!businessHoursOnly) {
            return new Date(startDate.getTime() + hours * 60 * 60 * 1000);
        }

        const result = new Date(startDate);
        let remainingHours = hours;

        while (remainingHours > 0) {
            const currentHour = result.getHours();
            const currentDay = result.getDay();

            if (currentDay === 0 || currentDay === 6) {
                result.setDate(result.getDate() + 1);
                result.setHours(9, 0, 0, 0);
                continue;
            }

            if (currentHour < 9) {
                result.setHours(9, 0, 0, 0);
                continue;
            }

            if (currentHour >= 17) {
                result.setDate(result.getDate() + 1);
                result.setHours(9, 0, 0, 0);
                continue;
            }

            const endOfDay = new Date(result);
            endOfDay.setHours(17, 0, 0, 0);
            
            const hoursUntilEndOfDay = (endOfDay - result) / (1000 * 60 * 60);
            
            if (remainingHours <= hoursUntilEndOfDay) {
                result.setTime(result.getTime() + remainingHours * 60 * 60 * 1000);
                remainingHours = 0;
            } else {
                remainingHours -= hoursUntilEndOfDay;
                result.setDate(result.getDate() + 1);
                result.setHours(9, 0, 0, 0);
            }
        }

        return result;
    }

    async getSLACompliance(timeframe = '30d') {
        try {
            let dateCondition = '';
            if (timeframe === '7d') {
                dateCondition = "AND created_at >= NOW() - INTERVAL '7 days'";
            } else if (timeframe === '30d') {
                dateCondition = "AND created_at >= NOW() - INTERVAL '30 days'";
            } else if (timeframe === '90d') {
                dateCondition = "AND created_at >= NOW() - INTERVAL '90 days'";
            }

            const result = await db.query(`
                SELECT 
                    priority,
                    COUNT(*) as total_tickets,
                    COUNT(CASE WHEN resolved_at <= sla_target THEN 1 END) as within_sla,
                    COUNT(CASE WHEN resolved_at > sla_target THEN 1 END) as breached_sla,
                    COUNT(CASE WHEN resolved_at IS NULL AND NOW() > sla_target THEN 1 END) as currently_breached,
                    AVG(CASE WHEN resolved_at IS NOT NULL 
                        THEN EXTRACT(EPOCH FROM (resolved_at - created_at))/3600 
                    END) as avg_resolution_hours
                FROM tickets 
                WHERE sla_target IS NOT NULL
                ${dateCondition}
                GROUP BY priority
                ORDER BY 
                    CASE priority 
                        WHEN 'critical' THEN 1
                        WHEN 'high' THEN 2
                        WHEN 'medium' THEN 3
                        WHEN 'low' THEN 4
                    END
            `);

            return result.rows.map(row => ({
                priority: row.priority,
                total_tickets: parseInt(row.total_tickets),
                within_sla: parseInt(row.within_sla),
                breached_sla: parseInt(row.breached_sla),
                currently_breached: parseInt(row.currently_breached),
                compliance_rate: row.total_tickets > 0 
                    ? Math.round((row.within_sla / row.total_tickets) * 100) 
                    : 0,
                avg_resolution_hours: parseFloat(row.avg_resolution_hours) || 0
            }));

        } catch (error) {
            logger.error('Failed to get SLA compliance:', error);
            return [];
        }
    }

    async getCurrentBreaches() {
        try {
            const result = await db.query(`
                SELECT 
                    t.id,
                    t.title,
                    t.priority,
                    t.status,
                    t.created_at,
                    t.sla_target,
                    EXTRACT(EPOCH FROM (NOW() - t.sla_target))/3600 as hours_overdue,
                    assignee.name as assignee_name,
                    assignee.email as assignee_email
                FROM tickets t
                LEFT JOIN users assignee ON t.assignee_id = assignee.id
                WHERE t.status NOT IN ('resolved', 'closed')
                AND t.sla_target < NOW()
                ORDER BY t.sla_target ASC
            `);

            return result.rows.map(row => ({
                ...row,
                hours_overdue: Math.round(parseFloat(row.hours_overdue) * 100) / 100
            }));

        } catch (error) {
            logger.error('Failed to get current breaches:', error);
            return [];
        }
    }

    async updateSLAConfiguration(priority, responseHours, resolutionHours) {
        try {
            await db.query(`
                UPDATE sla_configs 
                SET response_time_hours = $1, resolution_time_hours = $2, updated_at = NOW()
                WHERE priority = $3
            `, [responseHours, resolutionHours, priority]);

        } catch (error) {
            logger.error('Failed to update SLA configuration:', error);
            throw error;
        }
    }
}

module.exports = new SLAService();