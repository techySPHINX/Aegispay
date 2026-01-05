/**
 * Structured Logger for observability
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogContext {
  paymentId?: string;
  customerId?: string;
  gatewayType?: string;
  operation?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
}

/**
 * Console Logger Implementation
 */
export class ConsoleLogger implements Logger {
  constructor(private minLevel: LogLevel = LogLevel.INFO) { }

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
      };
      this.log(LogLevel.ERROR, message, errorContext);
    }
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
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
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, number[]>;
  timestamp: Date;
}

/**
 * In-Memory Metrics Collector
 */
export class InMemoryMetricsCollector implements MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

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

  getMetrics(): MetricsSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(this.histograms),
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
  }

  private createKey(metric: string, labels?: Record<string, string>): string {
    if (!labels) return metric;
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${metric}{${labelStr}}`;
  }
}
