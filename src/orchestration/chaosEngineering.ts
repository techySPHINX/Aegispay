/**
 * CHAOS ENGINEERING & FAILURE SIMULATION
 * 
 * Validate system resilience by injecting controlled failures.
 * 
 * WHY CHAOS TESTING?
 * ==================
 * 1. Find bugs before production
 * 2. Validate circuit breakers work correctly
 * 3. Ensure graceful degradation
 * 4. Test retry logic and backoff strategies
 * 5. Verify observability (logging, metrics)
 * 6. Build confidence in system reliability
 * 
 * CHAOS PATTERNS IMPLEMENTED:
 * ===========================
 * 1. Latency Injection - Slow responses
 * 2. Error Injection - Random failures
 * 3. Timeout Injection - Request timeouts
 * 4. Intermittent Failures - Flaky behavior
 * 5. Cascading Failures - Multiple gateways fail
 * 6. Resource Exhaustion - Connection pool exhaustion
 * 7. Network Partition - Gateway unreachable
 * 
 * USAGE:
 * ======
 * const chaos = new ChaosGateway(realGateway, {
 *   failureRate: 0.3,           // 30% failure rate
 *   latencyMs: { min: 100, max: 5000 },
 *   timeoutRate: 0.1,           // 10% timeouts
 * });
 * 
 * // Run chaos tests
 * await chaosOrchestrator.runExperiment(experiment);
 */

import { PaymentGateway, GatewayInitiateResponse, GatewayAuthResponse, GatewayRefundResponse, GatewayStatusResponse } from '../gateways/gateway';
import { Payment } from '../domain/payment';
import { GatewayType, Result, fail } from '../domain/types';
import { GatewayError, GatewayErrorCode, GatewayProcessResponse } from '../gateways/gateway';

// ============================================================================
// CHAOS CONFIG
// ============================================================================

export interface ChaosConfig {
  enabled: boolean;

  // Failure injection
  failureRate: number;              // 0.0 - 1.0 (probability of failure)
  errorTypes: ChaosErrorType[];     // Types of errors to inject

  // Latency injection
  latencyRate: number;              // 0.0 - 1.0 (probability of delay)
  latencyMs: { min: number; max: number };

  // Timeout injection
  timeoutRate: number;              // 0.0 - 1.0 (probability of timeout)
  timeoutMs: number;

  // Intermittent failures
  intermittentFailureWindow: number; // Time window for intermittent failures (ms)
  intermittentFailureBurst: number;  // Number of failures in burst

  // Advanced chaos
  cascadeFailureRate: number;       // Probability of cascading to other gateways
  resourceExhaustionRate: number;   // Simulate connection pool exhaustion

  // Control
  seed: number;                     // Random seed for reproducibility
  maxInjections: number;            // Max number of injections per experiment
}

export enum ChaosErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  RATE_LIMIT = 'RATE_LIMIT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
}

export const DEFAULT_CHAOS_CONFIG: ChaosConfig = {
  enabled: false,
  failureRate: 0.2,
  errorTypes: [
    ChaosErrorType.NETWORK_ERROR,
    ChaosErrorType.TIMEOUT,
    ChaosErrorType.SERVICE_UNAVAILABLE,
  ],
  latencyRate: 0.3,
  latencyMs: { min: 100, max: 3000 },
  timeoutRate: 0.1,
  timeoutMs: 5000,
  intermittentFailureWindow: 10000,
  intermittentFailureBurst: 3,
  cascadeFailureRate: 0.05,
  resourceExhaustionRate: 0.02,
  seed: Date.now(),
  maxInjections: 1000,
};

// ============================================================================
// CHAOS ERRORS
// ============================================================================

export class ChaosInjectedError extends Error {
  constructor(
    public readonly errorType: ChaosErrorType,
    public readonly gatewayType: GatewayType,
    message: string
  ) {
    super(`[CHAOS] ${errorType} on ${gatewayType}: ${message}`);
    this.name = 'ChaosInjectedError';
    Object.setPrototypeOf(this, ChaosInjectedError.prototype);
  }
}

export class ChaosTimeoutError extends ChaosInjectedError {
  constructor(gatewayType: GatewayType, timeoutMs: number) {
    super(
      ChaosErrorType.TIMEOUT,
      gatewayType,
      `Request timeout after ${timeoutMs}ms`
    );
    this.name = 'ChaosTimeoutError';
  }
}

// ============================================================================
// RANDOM NUMBER GENERATOR (Seeded)
// ============================================================================

/**
 * Seeded random number generator for reproducible chaos
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * Generate random number [0, 1)
   */
  next(): number {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }

  /**
   * Generate random integer [min, max]
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Choose random element from array
   */
  choose<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }
}

// ============================================================================
// CHAOS GATEWAY
// ============================================================================

/**
 * Gateway wrapper that injects chaos
 */
export class ChaosGateway implements PaymentGateway {
  readonly name: string;
  readonly type: GatewayType;

  private random: SeededRandom;
  private injectionCount: number = 0;
  private intermittentFailureState: {
    active: boolean;
    startTime: number;
    failureCount: number;
  } = {
      active: false,
      startTime: 0,
      failureCount: 0,
    };

  constructor(
    private realGateway: PaymentGateway,
    private config: ChaosConfig
  ) {
    this.random = new SeededRandom(config.seed);
    this.name = `Chaos(${realGateway.name})`;
    this.type = realGateway.type as GatewayType;
  }

  async initiate(payment: Payment): Promise<Result<GatewayInitiateResponse, GatewayError>> {
    return this.realGateway.initiate(payment);
  }

  async authenticate(payment: Payment): Promise<Result<GatewayAuthResponse, GatewayError>> {
    return this.realGateway.authenticate(payment);
  }

  async processPayment(payment: Payment): Promise<Result<GatewayProcessResponse, GatewayError>> {
    if (!this.config.enabled) {
      return this.realGateway.process(payment);
    }
    if (this.injectionCount >= this.config.maxInjections) {
      return this.realGateway.process(payment);
    }
    await this.maybeInjectLatency();
    if (this.shouldInjectFailure()) {
      this.injectionCount++;
      const error = this.generateChaosError();
      return fail(error);
    }
    if (this.shouldInjectTimeout()) {
      this.injectionCount++;
      return fail(new GatewayError(
        GatewayErrorCode.TIMEOUT,
        `Chaos timeout after ${this.config.timeoutMs}ms`,
        this.name,
        true
      ));
    }
    return this.realGateway.process(payment);
  }

  async process(payment: Payment): Promise<Result<GatewayProcessResponse, GatewayError>> {
    return this.processPayment(payment);
  }

  async refund(payment: Payment, amount?: number): Promise<Result<GatewayRefundResponse, GatewayError>> {
    if (!this.config.enabled) {
      return this.realGateway.refund(payment, amount);
    }
    await this.maybeInjectLatency();
    if (this.shouldInjectFailure()) {
      this.injectionCount++;
      return fail(this.generateChaosError());
    }
    return this.realGateway.refund(payment, amount);
  }

  async getStatus(paymentId: string): Promise<Result<GatewayStatusResponse, GatewayError>> {
    if (!this.config.enabled) {
      return this.realGateway.getStatus(paymentId);
    }
    await this.maybeInjectLatency();
    if (this.shouldInjectFailure()) {
      this.injectionCount++;
      return fail(this.generateChaosError());
    }
    return this.realGateway.getStatus(paymentId);
  }

  async healthCheck(): Promise<boolean> {
    return this.realGateway.healthCheck();
  }

  /**
   * Check if should inject failure
   */
  private shouldInjectFailure(): boolean {
    // Intermittent failure logic
    const now = Date.now();

    if (this.intermittentFailureState.active) {
      const elapsed = now - this.intermittentFailureState.startTime;

      if (elapsed > this.config.intermittentFailureWindow) {
        // Window expired, reset
        this.intermittentFailureState.active = false;
        this.intermittentFailureState.failureCount = 0;
      } else if (
        this.intermittentFailureState.failureCount < this.config.intermittentFailureBurst
      ) {
        // In window and haven't reached burst limit
        this.intermittentFailureState.failureCount++;
        return true;
      }
    }

    // Regular failure rate
    if (this.random.next() < this.config.failureRate) {
      // Start intermittent failure window
      this.intermittentFailureState.active = true;
      this.intermittentFailureState.startTime = now;
      this.intermittentFailureState.failureCount = 1;

      return true;
    }

    return false;
  }

  /**
   * Check if should inject timeout
   */
  private shouldInjectTimeout(): boolean {
    return this.random.next() < this.config.timeoutRate;
  }

  /**
   * Check if should inject latency
   */
  private async maybeInjectLatency(): Promise<void> {
    if (this.random.next() < this.config.latencyRate) {
      const latency = this.random.nextInt(
        this.config.latencyMs.min,
        this.config.latencyMs.max
      );

      console.log(`[CHAOS] Injecting ${latency}ms latency on ${this.type}`);

      await new Promise((resolve) => setTimeout(resolve, latency));
    }
  }

  /**
   * Generate chaos error
   */
  private generateChaosError(): GatewayError {
    const errorType = this.random.choose(this.config.errorTypes);

    const errorCodeMap: Record<ChaosErrorType, GatewayErrorCode> = {
      [ChaosErrorType.NETWORK_ERROR]: GatewayErrorCode.NETWORK_ERROR,
      [ChaosErrorType.TIMEOUT]: GatewayErrorCode.TIMEOUT,
      [ChaosErrorType.SERVICE_UNAVAILABLE]: GatewayErrorCode.GATEWAY_ERROR,
      [ChaosErrorType.RATE_LIMIT]: GatewayErrorCode.GATEWAY_ERROR,
      [ChaosErrorType.INTERNAL_ERROR]: GatewayErrorCode.GATEWAY_ERROR,
      [ChaosErrorType.INVALID_RESPONSE]: GatewayErrorCode.GATEWAY_ERROR,
    };

    const messages: Record<ChaosErrorType, string> = {
      [ChaosErrorType.NETWORK_ERROR]: 'Connection refused',
      [ChaosErrorType.TIMEOUT]: 'Request timeout',
      [ChaosErrorType.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable (503)',
      [ChaosErrorType.RATE_LIMIT]: 'Rate limit exceeded (429)',
      [ChaosErrorType.INTERNAL_ERROR]: 'Internal server error (500)',
      [ChaosErrorType.INVALID_RESPONSE]: 'Invalid response format',
    };

    return new GatewayError(
      errorCodeMap[errorType],
      `[CHAOS] ${messages[errorType]}`,
      this.name,
      true
    );
  }

  /**
   * Reset chaos state
   */
  reset(): void {
    this.injectionCount = 0;
    this.intermittentFailureState = {
      active: false,
      startTime: 0,
      failureCount: 0,
    };
  }

  /**
   * Get injection stats
   */
  getStats(): {
    injectionCount: number;
    intermittentActive: boolean;
  } {
    return {
      injectionCount: this.injectionCount,
      intermittentActive: this.intermittentFailureState.active,
    };
  }
}

// ============================================================================
// CHAOS EXPERIMENTS
// ============================================================================

export interface ChaosExperiment {
  name: string;
  description: string;
  duration: number;                 // Duration in ms
  config: ChaosConfig;

  // Success criteria
  expectedSuccessRate: number;      // Min success rate to pass (0-1)
  maxCircuitBreakerOpens: number;   // Max allowed circuit breaker opens
  maxAverageLatency: number;        // Max average latency (ms)

  // Validation
  validateInvariants: () => Promise<boolean>;
}

export interface ExperimentResult {
  experiment: ChaosExperiment;
  success: boolean;

  // Metrics
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;

  circuitBreakerOpens: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;

  // Validation
  invariantsHeld: boolean;

  // Errors
  errorCounts: Map<string, number>;

  // Timeline
  startTime: Date;
  endTime: Date;
  duration: number;
}

/**
 * Chaos Orchestrator
 */
export class ChaosOrchestrator {
  constructor() { }

  /**
   * Run chaos experiment
   */
  async runExperiment(
    experiment: ChaosExperiment,
    testFunction: () => Promise<void>
  ): Promise<ExperimentResult> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔥 CHAOS EXPERIMENT: ${experiment.name}`);
    console.log(`📝 ${experiment.description}`);
    console.log(`⏱️  Duration: ${experiment.duration}ms`);
    console.log(`${'='.repeat(60)}\n`);

    const startTime = new Date();
    const metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      circuitBreakerOpens: 0,
      latencies: [] as number[],
      errorCounts: new Map<string, number>(),
    };

    // Run experiment
    const endTime = Date.now() + experiment.duration;

    while (Date.now() < endTime) {
      const requestStart = Date.now();

      try {
        await testFunction();
        metrics.successfulRequests++;
      } catch (error) {
        metrics.failedRequests++;

        const errorType = (error as Error).name;
        metrics.errorCounts.set(
          errorType,
          (metrics.errorCounts.get(errorType) || 0) + 1
        );

        if (errorType === 'CircuitBreakerOpenError') {
          metrics.circuitBreakerOpens++;
        }
      }

      const latency = Date.now() - requestStart;
      metrics.latencies.push(latency);
      metrics.totalRequests++;

      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const endTimeDate = new Date();

    // Calculate metrics
    const successRate = metrics.successfulRequests / metrics.totalRequests;
    const averageLatency =
      metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length;

    const sortedLatencies = metrics.latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);
    const p95Latency = sortedLatencies[p95Index] || 0;
    const p99Latency = sortedLatencies[p99Index] || 0;

    // Validate invariants
    const invariantsHeld = await experiment.validateInvariants();

    // Check success criteria
    const success =
      successRate >= experiment.expectedSuccessRate &&
      metrics.circuitBreakerOpens <= experiment.maxCircuitBreakerOpens &&
      averageLatency <= experiment.maxAverageLatency &&
      invariantsHeld;

    const result: ExperimentResult = {
      experiment,
      success,
      totalRequests: metrics.totalRequests,
      successfulRequests: metrics.successfulRequests,
      failedRequests: metrics.failedRequests,
      successRate,
      circuitBreakerOpens: metrics.circuitBreakerOpens,
      averageLatency,
      p95Latency,
      p99Latency,
      invariantsHeld,
      errorCounts: metrics.errorCounts,
      startTime,
      endTime: endTimeDate,
      duration: endTimeDate.getTime() - startTime.getTime(),
    };

    this.printResults(result);

    return result;
  }

  /**
   * Print experiment results
   */
  private printResults(result: ExperimentResult): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 EXPERIMENT RESULTS`);
    console.log(`${'='.repeat(60)}`);
    console.log(
      `${result.success ? '✅ PASSED' : '❌ FAILED'}: ${result.experiment.name}`
    );
    console.log();

    console.log('📈 Metrics:');
    console.log(`  Total Requests: ${result.totalRequests}`);
    console.log(`  Successful: ${result.successfulRequests} (${(result.successRate * 100).toFixed(2)}%)`);
    console.log(`  Failed: ${result.failedRequests}`);
    console.log(`  Circuit Breaker Opens: ${result.circuitBreakerOpens}`);
    console.log();

    console.log('⏱️  Latency:');
    console.log(`  Average: ${result.averageLatency.toFixed(2)}ms`);
    console.log(`  P95: ${result.p95Latency}ms`);
    console.log(`  P99: ${result.p99Latency}ms`);
    console.log();

    console.log('❗ Errors:');
    if (result.errorCounts.size === 0) {
      console.log('  None');
    } else {
      for (const [errorType, count] of result.errorCounts) {
        console.log(`  ${errorType}: ${count}`);
      }
    }
    console.log();

    console.log('🔍 Validation:');
    console.log(`  Invariants Held: ${result.invariantsHeld ? '✅' : '❌'}`);
    console.log(`  Success Rate: ${result.successRate >= result.experiment.expectedSuccessRate ? '✅' : '❌'} (expected: ${result.experiment.expectedSuccessRate * 100}%, actual: ${result.successRate * 100}%)`);
    console.log(`  CB Opens: ${result.circuitBreakerOpens <= result.experiment.maxCircuitBreakerOpens ? '✅' : '❌'} (max: ${result.experiment.maxCircuitBreakerOpens}, actual: ${result.circuitBreakerOpens})`);
    console.log(`  Latency: ${result.averageLatency <= result.experiment.maxAverageLatency ? '✅' : '❌'} (max: ${result.experiment.maxAverageLatency}ms, actual: ${result.averageLatency.toFixed(2)}ms)`);

    console.log(`\n${'='.repeat(60)}\n`);
  }
}
