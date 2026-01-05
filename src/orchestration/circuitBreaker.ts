/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by failing fast when a service is unhealthy
 */

export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing fast
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  successThreshold: number; // Number of successes before closing from half-open
  timeout: number; // Time to wait before moving to half-open (ms)
  monitoringPeriod: number; // Period to track failures (ms)
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000, // 1 minute
  monitoringPeriod: 120000, // 2 minutes
};

/**
 * Circuit Breaker Error
 */
export class CircuitBreakerOpenError extends Error {
  constructor(public readonly serviceName: string) {
    super(`Circuit breaker is OPEN for ${serviceName}`);
    this.name = 'CircuitBreakerOpenError';
    Object.setPrototypeOf(this, CircuitBreakerOpenError.prototype);
  }
}

/**
 * Circuit Breaker Implementation
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime?: Date;
  private stateChangedAt: Date = new Date();
  private requestHistory: Array<{ timestamp: Date; success: boolean }> = [];

  constructor(
    private serviceName: string,
    private config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
  ) { }

  /**
   * Execute an operation through the circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      // Check if timeout has elapsed
      if (this.shouldAttemptReset()) {
        this.moveToHalfOpen();
      } else {
        throw new CircuitBreakerOpenError(this.serviceName);
      }
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a successful request
   */
  private recordSuccess(): void {
    this.cleanupOldRequests();
    this.requestHistory.push({ timestamp: new Date(), success: true });

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.moveToClosed();
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed request
   */
  private recordFailure(): void {
    this.cleanupOldRequests();
    this.requestHistory.push({ timestamp: new Date(), success: false });
    this.lastFailureTime = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      // One failure in half-open state opens the circuit again
      this.moveToOpen();
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount++;
      if (this.failureCount >= this.config.failureThreshold) {
        this.moveToOpen();
      }
    }
  }

  /**
   * Move to OPEN state
   */
  private moveToOpen(): void {
    this.state = CircuitState.OPEN;
    this.stateChangedAt = new Date();
    this.successCount = 0;
    console.warn(`Circuit breaker OPENED for ${this.serviceName}`);
  }

  /**
   * Move to HALF_OPEN state
   */
  private moveToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.stateChangedAt = new Date();
    this.successCount = 0;
    this.failureCount = 0;
    console.info(`Circuit breaker moved to HALF_OPEN for ${this.serviceName}`);
  }

  /**
   * Move to CLOSED state
   */
  private moveToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.stateChangedAt = new Date();
    this.failureCount = 0;
    this.successCount = 0;
    console.info(`Circuit breaker CLOSED for ${this.serviceName}`);
  }

  /**
   * Check if enough time has elapsed to attempt reset
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return false;

    const elapsedTime = Date.now() - this.lastFailureTime.getTime();
    return elapsedTime >= this.config.timeout;
  }

  /**
   * Clean up old requests outside monitoring period
   */
  private cleanupOldRequests(): void {
    const cutoffTime = Date.now() - this.config.monitoringPeriod;
    this.requestHistory = this.requestHistory.filter(
      (req) => req.timestamp.getTime() > cutoffTime
    );
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker metrics
   */
  getMetrics(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    requestCount: number;
    errorRate: number;
    stateChangedAt: Date;
  } {
    this.cleanupOldRequests();

    const totalRequests = this.requestHistory.length;
    const failures = this.requestHistory.filter((req) => !req.success).length;
    const errorRate = totalRequests > 0 ? (failures / totalRequests) * 100 : 0;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      requestCount: totalRequests,
      errorRate,
      stateChangedAt: this.stateChangedAt,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.moveToClosed();
    this.requestHistory = [];
    this.lastFailureTime = undefined;
  }

  /**
   * Force open the circuit breaker (for maintenance)
   */
  forceOpen(): void {
    this.moveToOpen();
  }
}
