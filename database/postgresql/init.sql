-- Database: incident_tracker
-- Description: Schema for incident tracking system

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
CREATE TYPE user_role AS ENUM ('admin', 'agent', 'viewer');
CREATE TYPE ticket_status AS ENUM ('open', 'in-progress', 'resolved', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE ticket_category AS ENUM ('hardware', 'software', 'network', 'security', 'other');

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP WITH TIME ZONE,
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    email_verified BOOLEAN DEFAULT FALSE,
    email_verification_token VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tickets table
CREATE TABLE tickets (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    status ticket_status NOT NULL DEFAULT 'open',
    priority ticket_priority NOT NULL DEFAULT 'medium',
    category ticket_category NOT NULL DEFAULT 'other',
    reporter_id INTEGER NOT NULL REFERENCES users(id),
    assignee_id INTEGER REFERENCES users(id),
    sla_target TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Comments table
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    comment TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Attachments table
CREATE TABLE attachments (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    email_sent BOOLEAN DEFAULT FALSE,
    slack_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Settings table
CREATE TABLE settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SLA configurations table
CREATE TABLE sla_configs (
    id SERIAL PRIMARY KEY,
    priority ticket_priority NOT NULL,
    response_time_hours INTEGER NOT NULL,
    resolution_time_hours INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ticket history table for audit trail
CREATE TABLE ticket_history (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    field_name VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    change_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_priority ON tickets(priority);
CREATE INDEX idx_tickets_assignee ON tickets(assignee_id);
CREATE INDEX idx_tickets_reporter ON tickets(reporter_id);
CREATE INDEX idx_tickets_created_at ON tickets(created_at);
CREATE INDEX idx_tickets_updated_at ON tickets(updated_at);
CREATE INDEX idx_tickets_sla_target ON tickets(sla_target);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active);

CREATE INDEX idx_comments_ticket ON comments(ticket_id);
CREATE INDEX idx_comments_user ON comments(user_id);
CREATE INDEX idx_comments_created_at ON comments(created_at);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

CREATE INDEX idx_ticket_history_ticket ON ticket_history(ticket_id);
CREATE INDEX idx_ticket_history_user ON ticket_history(user_id);
CREATE INDEX idx_ticket_history_created_at ON ticket_history(created_at);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_tickets_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_comments_updated_at
    BEFORE UPDATE ON comments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_sla_configs_updated_at
    BEFORE UPDATE ON sla_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Create ticket history trigger
CREATE OR REPLACE FUNCTION log_ticket_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Log status changes
        IF OLD.status != NEW.status THEN
            INSERT INTO ticket_history (ticket_id, user_id, field_name, old_value, new_value, change_type)
            VALUES (NEW.id, NEW.assignee_id, 'status', OLD.status::text, NEW.status::text, 'update');
        END IF;
        
        -- Log priority changes
        IF OLD.priority != NEW.priority THEN
            INSERT INTO ticket_history (ticket_id, user_id, field_name, old_value, new_value, change_type)
            VALUES (NEW.id, NEW.assignee_id, 'priority', OLD.priority::text, NEW.priority::text, 'update');
        END IF;
        
        -- Log assignee changes
        IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
            INSERT INTO ticket_history (ticket_id, user_id, field_name, old_value, new_value, change_type)
            VALUES (NEW.id, NEW.assignee_id, 'assignee_id', 
                    COALESCE(OLD.assignee_id::text, 'null'), 
                    COALESCE(NEW.assignee_id::text, 'null'), 'update');
        END IF;
        
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_ticket_changes_trigger
    AFTER UPDATE ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION log_ticket_changes();

-- Insert default SLA configurations
INSERT INTO sla_configs (priority, response_time_hours, resolution_time_hours) VALUES
('low', 48, 120),
('medium', 24, 72),
('high', 8, 24),
('critical', 2, 4);

-- Insert default settings
INSERT INTO settings (key, value, description) VALUES
('email_notifications', '{"enabled": true, "smtp_host": "", "smtp_port": 587, "smtp_user": "", "smtp_password": "", "from_email": ""}', 'Email notification settings'),
('slack_integration', '{"enabled": false, "webhook_url": "", "channel": "#incidents"}', 'Slack integration settings'),
('sla_alerts', '{"enabled": true, "warning_threshold": 0.8, "critical_threshold": 0.95}', 'SLA alert thresholds'),
('auto_assignment', '{"enabled": false, "round_robin": true, "workload_balance": false}', 'Automatic ticket assignment settings'),
('business_hours', '{"timezone": "UTC", "start_time": "09:00", "end_time": "17:00", "weekdays_only": true}', 'Business hours configuration');

-- Create views for common queries
CREATE VIEW ticket_stats AS
SELECT 
    status,
    priority,
    COUNT(*) as count,
    AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - created_at))/3600) as avg_resolution_hours
FROM tickets 
GROUP BY status, priority;

CREATE VIEW user_performance AS
SELECT 
    u.id,
    u.name,
    u.email,
    COUNT(t.id) as assigned_tickets,
    COUNT(CASE WHEN t.status = 'resolved' THEN 1 END) as resolved_tickets,
    ROUND(
        COUNT(CASE WHEN t.status = 'resolved' THEN 1 END)::numeric / 
        NULLIF(COUNT(t.id), 0) * 100, 2
    ) as resolution_rate
FROM users u
LEFT JOIN tickets t ON u.id = t.assignee_id
WHERE u.role IN ('agent', 'admin')
GROUP BY u.id, u.name, u.email;

CREATE VIEW sla_compliance AS
SELECT 
    t.id,
    t.title,
    t.priority,
    t.status,
    t.created_at,
    t.sla_target,
    t.resolved_at,
    CASE 
        WHEN t.resolved_at IS NOT NULL THEN t.resolved_at <= t.sla_target
        ELSE NOW() <= t.sla_target
    END as within_sla,
    CASE 
        WHEN t.resolved_at IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/3600
        ELSE 
            EXTRACT(EPOCH FROM (NOW() - t.created_at))/3600
    END as actual_resolution_hours
FROM tickets t
WHERE t.sla_target IS NOT NULL;