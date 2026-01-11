-- Aegispay Database Initialization Script

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create enum types
CREATE TYPE payment_state AS ENUM (
  'INITIATED',
  'AUTHENTICATED',
  'PROCESSING',
  'SUCCESS',
  'FAILURE'
);

CREATE TYPE gateway_type AS ENUM (
  'STRIPE',
  'RAZORPAY',
  'PAYPAL',
  'ADYEN',
  'MOCK'
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(255) PRIMARY KEY,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  state payment_state NOT NULL DEFAULT 'INITIATED',
  amount DECIMAL(19, 4) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  payment_method_type VARCHAR(50) NOT NULL,
  gateway_type gateway_type,
  gateway_transaction_id VARCHAR(255),
  failure_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT positive_amount CHECK (amount > 0),
  CONSTRAINT valid_retry_count CHECK (retry_count >= 0)
);

-- Indexes for payments
CREATE INDEX idx_payments_idempotency_key ON payments(idempotency_key);
CREATE INDEX idx_payments_state ON payments(state);
CREATE INDEX idx_payments_customer_id ON payments(customer_id);
CREATE INDEX idx_payments_gateway_transaction_id ON payments(gateway_transaction_id);
CREATE INDEX idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX idx_payments_gateway_type ON payments(gateway_type);

-- Payment events (Event Sourcing)
CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  payment_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
);

-- Indexes for payment events
CREATE INDEX idx_payment_events_payment_id ON payment_events(payment_id);
CREATE INDEX idx_payment_events_created_at ON payment_events(created_at DESC);
CREATE INDEX idx_payment_events_event_type ON payment_events(event_type);

-- Transactional Outbox
CREATE TABLE IF NOT EXISTS outbox_messages (
  id BIGSERIAL PRIMARY KEY,
  aggregate_id VARCHAR(255) NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  published BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for outbox
CREATE INDEX idx_outbox_messages_published ON outbox_messages(published) WHERE published = FALSE;
CREATE INDEX idx_outbox_messages_created_at ON outbox_messages(created_at DESC);
CREATE INDEX idx_outbox_messages_aggregate_id ON outbox_messages(aggregate_id);

-- Idempotency tracking
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  response JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Index for idempotency cleanup
CREATE INDEX idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);

-- Distributed locks
CREATE TABLE IF NOT EXISTS distributed_locks (
  lock_key VARCHAR(255) PRIMARY KEY,
  owner VARCHAR(255) NOT NULL,
  acquired_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Index for lock cleanup
CREATE INDEX idx_distributed_locks_expires_at ON distributed_locks(expires_at);

-- Gateway metrics
CREATE TABLE IF NOT EXISTS gateway_metrics (
  id BIGSERIAL PRIMARY KEY,
  gateway_type gateway_type NOT NULL,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  average_latency_ms DECIMAL(10, 2) DEFAULT 0,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for gateway metrics
CREATE INDEX idx_gateway_metrics_recorded_at ON gateway_metrics(recorded_at DESC);
CREATE INDEX idx_gateway_metrics_gateway_type ON gateway_metrics(gateway_type);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for payments table
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up expired idempotency keys
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS void AS $$
BEGIN
  DELETE FROM idempotency_keys WHERE expires_at < CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired locks
CREATE OR REPLACE FUNCTION cleanup_expired_locks()
RETURNS void AS $$
BEGIN
  DELETE FROM distributed_locks WHERE expires_at < CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust user as needed)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO aegispay;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO aegispay;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO aegispay;

-- Insert sample gateway metrics
INSERT INTO gateway_metrics (gateway_type, success_count, failure_count, average_latency_ms)
VALUES 
  ('STRIPE', 0, 0, 0),
  ('RAZORPAY', 0, 0, 0),
  ('PAYPAL', 0, 0, 0),
  ('ADYEN', 0, 0, 0),
  ('MOCK', 0, 0, 0);

-- Create materialized view for payment analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS payment_analytics AS
SELECT 
  DATE_TRUNC('hour', created_at) AS hour,
  state,
  gateway_type,
  COUNT(*) AS payment_count,
  SUM(amount) AS total_amount,
  AVG(amount) AS avg_amount,
  AVG(retry_count) AS avg_retries
FROM payments
GROUP BY DATE_TRUNC('hour', created_at), state, gateway_type;

-- Index for materialized view
CREATE INDEX idx_payment_analytics_hour ON payment_analytics(hour DESC);

-- Refresh materialized view function
CREATE OR REPLACE FUNCTION refresh_payment_analytics()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY payment_analytics;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE payments IS 'Main payments table storing payment state and metadata';
COMMENT ON TABLE payment_events IS 'Event sourcing table for payment domain events';
COMMENT ON TABLE outbox_messages IS 'Transactional outbox for reliable event publishing';
COMMENT ON TABLE idempotency_keys IS 'Idempotency key tracking for duplicate prevention';
COMMENT ON TABLE distributed_locks IS 'Distributed lock management for concurrency control';
COMMENT ON TABLE gateway_metrics IS 'Payment gateway performance metrics';
