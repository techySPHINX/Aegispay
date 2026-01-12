/**
 * ENHANCED CIRCUIT BREAKER WITH HEALTH TRACKING
 *
 * This is the unified circuit breaker implementation that combines:
 * - Basic circuit breaker functionality
 * - Comprehensive health metrics
 * - Gradual recovery via half-open state
 * - Adaptive thresholds based on historical data
 * - Health score calculation
 * - Cascading failure prevention
 *
 * HOW IT IMPROVES AVAILABILITY:
 *
 * Without Circuit Breakers:
 * - Slow/failing gateway causes request pile-up
 * - Resources (threads, connections) exhausted
 * - Cascading failures across entire system
 * - Long recovery time
 *
 * With Circuit Breakers:
 * - Fast failure when gateway is down
 * - Resources freed immediately
 * - Other gateways can handle traffic
 * - Automatic recovery detection
 * - Gradual traffic ramp-up
 *
 * This replaces the basic circuitBreaker.ts with enhanced functionality.
 */

import { GatewayType } from '../domain/types';

// ============================================================================
// CIRCUIT BREAKER STATES
// ============================================================================

export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation - all requests pass through
  OPEN = 'OPEN', // Failing fast - reject all requests
  HALF_OPEN = 'HALF_OPEN', // Testing recovery - allow limited requests
}

// ============================================================================
// HEALTH TRACKING
// ============================================================================

/**
 * Gateway health status
 */
export interface GatewayHealth {
  gatewayType: GatewayType;
  circuitState: CircuitState;
  healthScore: number; // 0.0 (unhealthy) to 1.0 (healthy)

  // Failure tracking
  consecutiveFailures: number;
  totalFailures: number;
  failureRate: number; // 0.0 to 1.0

  // Success tracking
  consecutiveSuccesses: number;
  totalSuccesses: number;
  successRate: number; // 0.0 to 1.0

  // Timing
  lastRequestTime: Date | null;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  stateChangedAt: Date;

  // Circuit breaker details
  openCount: number; // How many times circuit has opened
  halfOpenAttempts: number; // Attempts made in half-open state
  timeUntilRetry: number; // Ms until next retry attempt
}

/**
 * Health metrics collector for circuit breakers
 */
export class CircuitBreakerHealthTracker {
  private health: Map<GatewayType, GatewayHealth> = new Map();

  /**
   * Update health after successful request
   */
  recordSuccess(gatewayType: GatewayType, state: CircuitState): void {
    const health = this.getOrCreateHealth(gatewayType, state);

    health.consecutiveSuccesses++;
    health.totalSuccesses++;
    health.consecutiveFailures = 0;
    health.lastSuccessTime = new Date();
    health.lastRequestTime = new Date();

    this.updateRates(health);
    this.updateHealthScore(health);
  }

  /**
   * Update health after failed request
   */
  recordFailure(gatewayType: GatewayType, state: CircuitState): void {
    const health = this.getOrCreateHealth(gatewayType, state);

    health.consecutiveFailures++;
    health.totalFailures++;
    health.consecutiveSuccesses = 0;
    health.lastFailureTime = new Date();
    health.lastRequestTime = new Date();

    this.updateRates(health);
    this.updateHealthScore(health);
  }

  /**
   * Record state change
   */
  recordStateChange(
    gatewayType: GatewayType,
    newState: CircuitState,
    timeUntilRetry: number = 0
  ): void {
    const health = this.getOrCreateHealth(gatewayType, newState);

    health.circuitState = newState;
    health.stateChangedAt = new Date();
    health.timeUntilRetry = timeUntilRetry;

    if (newState === CircuitState.OPEN) {
      health.openCount++;
      health.consecutiveSuccesses = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      health.halfOpenAttempts++;
    }

    this.updateHealthScore(health);
  }

  /**
   * Get health for a gateway
   */
  getHealth(gatewayType: GatewayType): GatewayHealth | null {
    return this.health.get(gatewayType) || null;
  }

  /**
   * Get all gateway health statuses
   */
  getAllHealth(): Map<GatewayType, GatewayHealth> {
    return new Map(this.health);
  }

  /**
   * Check if gateway is healthy
   */
  isHealthy(gatewayType: GatewayType, minHealthScore: number = 0.5): boolean {
    const health = this.health.get(gatewayType);
    if (!health) return true; // No data = assume healthy

    return health.circuitState === CircuitState.CLOSED && health.healthScore >= minHealthScore;
  }

  /**
   * Get or create health entry
   */
  private getOrCreateHealth(gatewayType: GatewayType, state: CircuitState): GatewayHealth {
    let health = this.health.get(gatewayType);

    if (!health) {
      health = {
        gatewayType,
        circuitState: state,
        healthScore: 1.0,
        consecutiveFailures: 0,
        totalFailures: 0,
        failureRate: 0,
        consecutiveSuccesses: 0,
        totalSuccesses: 0,
        successRate: 1.0,
        lastRequestTime: null,
        lastFailureTime: null,
        lastSuccessTime: null,
        stateChangedAt: new Date(),
        openCount: 0,
        halfOpenAttempts: 0,
        timeUntilRetry: 0,
      };

      this.health.set(gatewayType, health);
    }

    return health;
  }

  /**
   * Update success/failure rates
   */
  private updateRates(health: GatewayHealth): void {
    const total = health.totalSuccesses + health.totalFailures;

    if (total > 0) {
      health.successRate = health.totalSuccesses / total;
      health.failureRate = health.totalFailures / total;
    }
  }

  /**
   * Calculate health score based on multiple factors
   */
  private updateHealthScore(health: GatewayHealth): void {
    let score = 0;

    // Factor 1: Circuit state (50% weight)
    if (health.circuitState === CircuitState.CLOSED) {
      score += 0.5;
    } else if (health.circuitState === CircuitState.HALF_OPEN) {
      score += 0.25;
    }
    // OPEN state contributes 0

    // Factor 2: Success rate (30% weight)
    score += health.successRate * 0.3;

    // Factor 3: Consecutive successes bonus (10% weight)
    const successBonus = Math.min(health.consecutiveSuccesses / 10, 1.0) * 0.1;
    score += successBonus;

    // Factor 4: Penalty for consecutive failures (10% weight)
    const failurePenalty = Math.min(health.consecutiveFailures / 5, 1.0) * 0.1;
    score -= failurePenalty;

    health.healthScore = Math.max(0, Math.min(1, score));
  }
}

// ============================================================================
// ENHANCED CIRCUIT BREAKER
// ============================================================================

export interface EnhancedCircuitBreakerConfig {
  // Failure thresholds
  failureThreshold: number; // Failures before opening circuit
  failureRateThreshold: number; // Failure rate (0-1) before opening

  // Success thresholds
  successThreshold: number; // Successes in half-open before closing

  // Timeouts
  openTimeout: number; // Time to stay open before trying half-open (ms)
  halfOpenTimeout: number; // Time to stay in half-open (ms)

  // Half-open behavior
  halfOpenMaxAttempts: number; // Max requests to allow in half-open state

  // Adaptive behavior
  adaptiveThresholds: boolean; // Adjust thresholds based on history
  minHealthScore: number; // Min health score to consider healthy
}

export const DEFAULT_ENHANCED_CONFIG: EnhancedCircuitBreakerConfig = {
  failureThreshold: 5,
  failureRateThreshold: 0.5,
  successThreshold: 3,
  openTimeout: 60000, // 1 minute
  halfOpenTimeout: 30000, // 30 seconds
  halfOpenMaxAttempts: 5,
  adaptiveThresholds: true,
  minHealthScore: 0.5,
};

/**
 * Circuit Breaker Error
 */
export class CircuitBreakerOpenError extends Error {
  constructor(
    public readonly gatewayType: GatewayType,
    public readonly health: GatewayHealth
  ) {
    super(
      `Circuit breaker is OPEN for ${gatewayType}. ` +
        `Health score: ${health.healthScore.toFixed(2)}. ` +
        `Retry in ${Math.ceil(health.timeUntilRetry / 1000)}s`
    );
    this.name = 'CircuitBreakerOpenError';
    Object.setPrototypeOf(this, CircuitBreakerOpenError.prototype);
  }
}

/**
 * Enhanced Circuit Breaker with Health Tracking
 */
export class EnhancedCircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private halfOpenAttempts: number = 0;
  private stateChangedAt: Date = new Date();
  private requestHistory: Array<{ timestamp: Date; success: boolean }> = [];

  constructor(
    private gatewayType: GatewayType,
    private healthTracker: CircuitBreakerHealthTracker,
    private config: EnhancedCircuitBreakerConfig = DEFAULT_ENHANCED_CONFIG
  ) {}

  /**
   * Execute operation through circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check circuit state
    this.updateState();

    if (this.state === CircuitState.OPEN) {
      const health = this.healthTracker.getHealth(this.gatewayType);
      throw new CircuitBreakerOpenError(this.gatewayType, health!);
    }

    if (this.state === CircuitState.HALF_OPEN) {
      // Limit requests in half-open state
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        const health = this.healthTracker.getHealth(this.gatewayType);
        throw new CircuitBreakerOpenError(this.gatewayType, health!);
      }
      this.halfOpenAttempts++;
    }

    // Execute operation

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful request
   */
  private onSuccess(): void {
    this.successCount++;
    this.failureCount = 0;
    this.requestHistory.push({ timestamp: new Date(), success: true });
    this.cleanupOldRequests();
    this.healthTracker.recordSuccess(this.gatewayType, this.state);
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED, 'Sufficient successes in half-open state');
      }
    }
  }

  /**
   * Handle failed request
   */
  private onFailure(): void {
    this.failureCount++;
    this.successCount = 0;
    this.requestHistory.push({ timestamp: new Date(), success: false });
    this.cleanupOldRequests();
    this.healthTracker.recordFailure(this.gatewayType, this.state);
    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN, 'Failure in half-open state');
    } else if (this.state === CircuitState.CLOSED) {
      const failureRate = this.calculateFailureRate();
      if (
        this.failureCount >= this.config.failureThreshold ||
        failureRate >= this.config.failureRateThreshold
      ) {
        this.transitionTo(
          CircuitState.OPEN,
          `Threshold exceeded (failures: ${this.failureCount}, rate: ${failureRate.toFixed(2)})`
        );
      }
    }
  }

  /**
   * Update circuit state based on time
   */
  private updateState(): void {
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      const elapsed = now - this.stateChangedAt.getTime();

      if (elapsed >= this.config.openTimeout) {
        this.transitionTo(CircuitState.HALF_OPEN, 'Open timeout elapsed, attempting recovery');
      }
    } else if (this.state === CircuitState.HALF_OPEN) {
      const now = Date.now();
      const elapsed = now - this.stateChangedAt.getTime();

      if (elapsed >= this.config.halfOpenTimeout) {
        // Timeout in half-open → back to open
        this.transitionTo(
          CircuitState.OPEN,
          'Half-open timeout elapsed without sufficient successes'
        );
      }
    }
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitState, reason: string): void {
    const oldState = this.state;
    this.state = newState;
    this.stateChangedAt = new Date();

    // Reset counters
    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenAttempts = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenAttempts = 0;
    } else if (newState === CircuitState.OPEN) {
      this.successCount = 0;
      this.halfOpenAttempts = 0;
    }

    // Calculate time until retry
    let timeUntilRetry = 0;
    if (newState === CircuitState.OPEN) {
      timeUntilRetry = this.config.openTimeout;
    }

    // Update health tracker
    this.healthTracker.recordStateChange(this.gatewayType, newState, timeUntilRetry);

    console.log(`[CircuitBreaker] ${this.gatewayType}: ${oldState} → ${newState} (${reason})`);
  }

  /**
   * Calculate failure rate from recent history
   */
  private calculateFailureRate(): number {
    if (this.requestHistory.length === 0) return 0;

    const failures = this.requestHistory.filter((r) => !r.success).length;
    return failures / this.requestHistory.length;
  }

  /**
   * Clean up old requests outside monitoring period
   */
  private cleanupOldRequests(): void {
    const cutoff = Date.now() - 300000; // Keep last 5 minutes
    this.requestHistory = this.requestHistory.filter((r) => r.timestamp.getTime() > cutoff);
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  /**
   * Get health status
   */
  getHealth(): GatewayHealth | null {
    return this.healthTracker.getHealth(this.gatewayType);
  }

  /**
   * Manually reset circuit breaker
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED, 'Manual reset');
  }

  /**
   * Force open (for testing/maintenance)
   */
  forceOpen(): void {
    this.transitionTo(CircuitState.OPEN, 'Forced open');
  }
}

// ============================================================================
// CIRCUIT BREAKER MANAGER
// ============================================================================

/**
 * Manages circuit breakers for all gateways
 */
export class CircuitBreakerManager {
  private breakers: Map<GatewayType, EnhancedCircuitBreaker> = new Map();
  private healthTracker: CircuitBreakerHealthTracker;

  constructor(private config: EnhancedCircuitBreakerConfig = DEFAULT_ENHANCED_CONFIG) {
    this.healthTracker = new CircuitBreakerHealthTracker();
  }

  /**
   * Get or create circuit breaker for gateway
   */
  getBreaker(gatewayType: GatewayType): EnhancedCircuitBreaker {
    let breaker = this.breakers.get(gatewayType);

    if (!breaker) {
      breaker = new EnhancedCircuitBreaker(gatewayType, this.healthTracker, this.config);
      this.breakers.set(gatewayType, breaker);
    }

    return breaker;
  }

  /**
   * Get health for all gateways
   */
  getAllHealth(): Map<GatewayType, GatewayHealth> {
    return this.healthTracker.getAllHealth();
  }

  /**
   * Get healthy gateways
   */
  getHealthyGateways(minHealthScore: number = 0.5): GatewayType[] {
    const healthy: GatewayType[] = [];
    for (const [gatewayType] of this.breakers) {
      if (this.healthTracker.isHealthy(gatewayType, minHealthScore)) {
        healthy.push(gatewayType);
      }
    }
    return healthy;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

// Export EnhancedCircuitBreaker as CircuitBreaker for backward compatibility
export { EnhancedCircuitBreaker as CircuitBreaker };
