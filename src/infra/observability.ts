/**
 * OBSERVABILITY AS A FIRST-CLASS FEATURE
 *
 * Production-grade observability with:
 * - Structured logging with correlation IDs
 * - Metrics for latency, retries, failures
 * - Trace propagation across services
 * - Performance monitoring
 *
 * HOW OBSERVABILITY HELPS DEBUG PAYMENT FAILURES:
 * ================================================
 * 1. CORRELATION IDS: Track a payment across services
 *    - Payment ID links logs from gateway, DB, events
 *    - Trace ID connects distributed operations
 *    - Can reconstruct entire payment flow
 *
 * 2. STRUCTURED LOGGING: Filter and search efficiently
 *    - JSON format enables log aggregation (ELK, Splunk)
 *    - Context fields allow precise queries
 *    - Example: Find all failed Stripe payments for customer X
 *
 * 3. METRICS: Identify patterns and anomalies
 *    - Latency spikes indicate gateway problems
 *    - Retry count shows transient failures
 *    - Success rate per gateway guides routing
 *
 * 4. TRACES: Understand performance bottlenecks
 *    - See which operation takes longest
 *    - Identify slow database queries
 *    - Detect network delays
 *
 * 5. ALERTS: Proactive issue detection
 *    - High error rate triggers alerts
 *    - Latency SLA breaches notify on-call
 *    - Circuit breaker opens indicate problems
 *
 * PRODUCTION DEBUGGING EXAMPLE:
 * ==============================
 * Problem: Customer reports failed payment
 *
 * Step 1: Search logs by paymentId
 * → Find: "Payment initiated", "Gateway timeout", "Retry attempt 1"
 *
 * Step 2: Check metrics
 * → Gateway latency spike at same timestamp
 *
 * Step 3: Check traces
 * → Gateway call took 30s (timeout = 10s)
 *
 * Conclusion: Gateway performance issue, not our bug
 * Action: Switch to backup gateway, contact provider
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogContext {
  // Core identifiers for correlation
  paymentId?: string;
  customerId?: string;
  correlationId?: string; // NEW: Links related operations
  traceId?: string; // NEW: Distributed tracing ID
  spanId?: string; // NEW: Span within trace

  // Operation context
  gatewayType?: string;
  operation?: string;
  duration?: number;

  // Performance metrics
  retryCount?: number; // NEW: Number of retries
  attemptNumber?: number; // NEW: Current attempt

  // Additional context
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;

  // NEW: Create child logger with inherited context
  child(context: LogContext): Logger;

  // NEW: Start a timed operation
  startTimer(operation: string, context?: LogContext): Timer;
}

/**
 * Timer for measuring operation duration
 */
export interface Timer {
  end(context?: LogContext): number;
  cancel(): void;
}

/**
 * Trace context for distributed tracing
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
}

/**
 * Generate trace context
 */
export function createTraceContext(parentSpanId?: string): TraceContext {
  return {
    traceId: generateId(),
    spanId: generateId(),
    parentSpanId,
    sampled: true,
  };
}

/**
 * Generate unique ID for correlation
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Console Logger Implementation with Correlation Support
 */
export class ConsoleLogger implements Logger {
  private inheritedContext: LogContext;

  constructor(
    private minLevel: LogLevel = LogLevel.INFO,
    inheritedContext: LogContext = {}
  ) {
    this.inheritedContext = inheritedContext;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.log(LogLevel.DEBUG, message, context);
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.log(LogLevel.INFO, message, context);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.log(LogLevel.WARN, message, context);
    }
  }

  error(message: string, error?: Error, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const errorContext = {
        ...context,
        error: error?.message,
        stack: error?.stack,
        errorType: error?.constructor.name,
      };
      this.log(LogLevel.ERROR, message, errorContext);
    }
  }

  /**
   * Create child logger with inherited context
   * Useful for tracking operations across function calls
   */
  child(context: LogContext): Logger {
    return new ConsoleLogger(this.minLevel, {
      ...this.inheritedContext,
      ...context,
    });
  }

  /**
   * Start a timed operation
   */
  startTimer(operation: string, context?: LogContext): Timer {
    const startTime = Date.now();
    const timerContext = {
      ...this.inheritedContext,
      ...context,
      operation,
    };

    this.debug(`Starting operation: ${operation}`, timerContext);

    return {
      end: (endContext?: LogContext): number => {
        const duration = Date.now() - startTime;
        this.info(`Completed operation: ${operation}`, {
          ...timerContext,
          ...endContext,
          duration,
        });
        return duration;
      },
      cancel: (): void => {
        this.debug(`Cancelled operation: ${operation}`, timerContext);
      },
    };
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...this.inheritedContext,
      ...context,
    };

    const color = this.getColorForLevel(level);
    console.log(color, JSON.stringify(logEntry));
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private getColorForLevel(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return '\x1b[36m%s\x1b[0m'; // Cyan
      case LogLevel.INFO:
        return '\x1b[32m%s\x1b[0m'; // Green
      case LogLevel.WARN:
        return '\x1b[33m%s\x1b[0m'; // Yellow
      case LogLevel.ERROR:
        return '\x1b[31m%s\x1b[0m'; // Red
      default:
        return '\x1b[0m%s'; // Default
    }
  }
}

/**
 * Metrics Collector Interface
 */
export interface MetricsCollector {
  /**
   * Increment a counter
   */
  increment(metric: string, labels?: Record<string, string>): void;

  /**
   * Record a gauge value
   */
  gauge(metric: string, value: number, labels?: Record<string, string>): void;

  /**
   * Record a histogram value (for latencies)
   */
  histogram(metric: string, value: number, labels?: Record<string, string>): void;

  /**
   * Get current metrics
   */
  getMetrics(): MetricsSnapshot;

  /**
   * Record operation timing
   */
  timing(metric: string, durationMs: number, labels?: Record<string, string>): void;

  /**
   * Start a timer for an operation
   */
  startTimer(metric: string, labels?: Record<string, string>): MetricTimer;
}

/**
 * Timer for metrics
 */
export interface MetricTimer {
  end(additionalLabels?: Record<string, string>): void;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, number[]>;
  timings: Record<string, { count: number; sum: number; avg: number; min: number; max: number }>;
  timestamp: Date;
}

/**
 * In-Memory Metrics Collector with Timing Support
 */
export class InMemoryMetricsCollector implements MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private timings: Map<string, number[]> = new Map();

  increment(metric: string, labels?: Record<string, string>): void {
    const key = this.createKey(metric, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + 1);
  }

  gauge(metric: string, value: number, labels?: Record<string, string>): void {
    const key = this.createKey(metric, labels);
    this.gauges.set(key, value);
  }

  histogram(metric: string, value: number, labels?: Record<string, string>): void {
    const key = this.createKey(metric, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);
  }

  /**
   * Record timing/latency metric
   */
  timing(metric: string, durationMs: number, labels?: Record<string, string>): void {
    const key = this.createKey(metric, labels);
    const values = this.timings.get(key) || [];
    values.push(durationMs);
    this.timings.set(key, values);
  }

  /**
   * Start a timer for measuring operation duration
   */
  startTimer(metric: string, labels?: Record<string, string>): MetricTimer {
    const startTime = Date.now();

    return {
      end: (additionalLabels?: Record<string, string>): void => {
        const duration = Date.now() - startTime;
        const combinedLabels = { ...labels, ...additionalLabels };
        this.timing(metric, duration, combinedLabels);
      },
    };
  }

  getMetrics(): MetricsSnapshot {
    const timingsStats: Record<
      string,
      { count: number; sum: number; avg: number; min: number; max: number }
    > = {};

    this.timings.forEach((values, key) => {
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        timingsStats[key] = {
          count: values.length,
          sum,
          avg: sum / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
        };
      }
    });

    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(this.histograms),
      timings: timingsStats,
      timestamp: new Date(),
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timings.clear();
  }

  private createKey(metric: string, labels?: Record<string, string>): string {
    if (!labels) return metric;
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${metric}{${labelStr}}`;
  }
}

/**
 * OBSERVABILITY FACADE
 *
 * Combines logging, metrics, and tracing in one interface
 */
export class ObservabilityManager {
  constructor(
    private logger: Logger,
    private metrics: MetricsCollector
  ) {}

  /**
   * Create observability context for an operation
   */
  createContext(operation: string, baseContext: LogContext = {}): ObservabilityContext {
    const correlationId = generateId();
    const traceContext = createTraceContext();

    const context: LogContext = {
      ...baseContext,
      correlationId,
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
      operation,
    };

    const childLogger = this.logger.child(context);
    const metricTimer = this.metrics.startTimer(`${operation}.duration`, {
      operation,
    });

    return {
      logger: childLogger,
      metrics: this.metrics,
      correlationId,
      traceContext,
      context,
      startTime: Date.now(),

      // Record success
      recordSuccess: (additionalContext?: LogContext): void => {
        const startTimeValue =
          typeof context.startTime === 'number' ? context.startTime : Date.now();
        const duration = Date.now() - startTimeValue;
        childLogger.info(`${operation} succeeded`, {
          ...additionalContext,
          duration,
        });
        metricTimer.end({ status: 'success' });
        this.metrics.increment(`${operation}.success`, { operation });
      },

      // Record failure
      recordFailure: (error: Error, additionalContext?: LogContext): void => {
        const startTimeValue =
          typeof context.startTime === 'number' ? context.startTime : Date.now();
        const duration = Date.now() - startTimeValue;
        childLogger.error(`${operation} failed`, error, {
          ...additionalContext,
          duration,
        });
        metricTimer.end({ status: 'failure' });
        this.metrics.increment(`${operation}.failure`, {
          operation,
          errorType: error.constructor.name,
        });
      },

      // Record retry
      recordRetry: (attempt: number, reason: string): void => {
        childLogger.warn(`${operation} retry attempt ${attempt}`, {
          attemptNumber: attempt,
          retryReason: reason,
        });
        this.metrics.increment(`${operation}.retry`, {
          operation,
          attempt: attempt.toString(),
        });
      },
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const snapshot = this.metrics.getMetrics();
    const lines: string[] = [];

    // Export counters
    Object.entries(snapshot.counters).forEach(([key, value]) => {
      const [metric, labels] = this.parseMetricKey(key);
      lines.push(`# TYPE ${metric} counter`);
      lines.push(`${metric}${labels} ${value}`);
    });

    // Export gauges
    Object.entries(snapshot.gauges).forEach(([key, value]) => {
      const [metric, labels] = this.parseMetricKey(key);
      lines.push(`# TYPE ${metric} gauge`);
      lines.push(`${metric}${labels} ${value}`);
    });

    // Export timing summaries
    Object.entries(snapshot.timings).forEach(([key, stats]) => {
      const [metric, labels] = this.parseMetricKey(key);
      lines.push(`# TYPE ${metric} summary`);
      lines.push(`${metric}_count${labels} ${stats.count}`);
      lines.push(`${metric}_sum${labels} ${stats.sum}`);
      lines.push(`${metric}_avg${labels} ${stats.avg}`);
      lines.push(`${metric}_min${labels} ${stats.min}`);
      lines.push(`${metric}_max${labels} ${stats.max}`);
    });

    return lines.join('\n');
  }

  private parseMetricKey(key: string): [string, string] {
    const match = key.match(/^([^{]+)(\{.+\})?$/);
    if (!match) return [key, ''];
    return [match[1], match[2] || ''];
  }
}

/**
 * Observability context for a single operation
 */
export interface ObservabilityContext {
  logger: Logger;
  metrics: MetricsCollector;
  correlationId: string;
  traceContext: TraceContext;
  context: LogContext;
  startTime: number;
  recordSuccess: (additionalContext?: LogContext) => void;
  recordFailure: (error: Error, additionalContext?: LogContext) => void;
  recordRetry: (attempt: number, reason: string) => void;
}

/**
 * Create default observability manager
 */
export function createObservabilityManager(
  logLevel: LogLevel = LogLevel.INFO
): ObservabilityManager {
  const logger = new ConsoleLogger(logLevel);
  const metrics = new InMemoryMetricsCollector();
  return new ObservabilityManager(logger, metrics);
}
