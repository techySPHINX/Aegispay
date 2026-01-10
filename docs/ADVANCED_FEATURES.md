# Advanced Features Guide

This document covers the advanced features of AegisPay that enable production-grade payment orchestration with resilience, observability, and extensibility.

## Table of Contents

1. [Intelligent Gateway Routing](#intelligent-gateway-routing)
2. [Circuit Breakers & Health Tracking](#circuit-breakers--health-tracking)
3. [Concurrency & Optimistic Locking](#concurrency--optimistic-locking)
4. [Chaos Engineering](#chaos-engineering)
5. [Extensibility Hooks](#extensibility-hooks)
6. [Integration Examples](#integration-examples)

---

## Intelligent Gateway Routing

### Overview

The Intelligent Routing Engine dynamically selects the optimal payment gateway based on real-time metrics and configurable rules.

### Key Features

- **Real-time metrics collection**: Success rates, latency (p50, p95, p99), costs
- **Weighted scoring algorithm**: Customizable weights for different factors
- **Dynamic rule system**: Pre-built and custom routing rules
- **Rolling window metrics**: Configurable time windows for metric aggregation

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Intelligent Routing Engine                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐      ┌──────────────────┐           │
│  │ Metrics Collector│◄─────┤  Gateway Events  │           │
│  └────────┬─────────┘      └──────────────────┘           │
│           │                                                 │
│           │ Metrics                                         │
│           ▼                                                 │
│  ┌──────────────────┐      ┌──────────────────┐           │
│  │  Routing Rules   │─────►│  Scoring Engine  │           │
│  └──────────────────┘      └────────┬─────────┘           │
│                                      │                      │
│                                      │ Decision             │
│                                      ▼                      │
│                             ┌──────────────────┐           │
│                             │ Gateway Selection│           │
│                             └──────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### Usage Example

```typescript
import {
  GatewayMetricsCollector,
  IntelligentRoutingEngine,
  createHighValueRule,
  createLowLatencyRule,
} from './orchestration/intelligentRouting';

// 1. Setup metrics collector
const metricsCollector = new GatewayMetricsCollector({
  windowSize: 3600000,  // 1 hour
  maxEntries: 10000,
});

// 2. Create routing engine
const routingEngine = new IntelligentRoutingEngine(metricsCollector, {
  successWeight: 0.5,
  latencyWeight: 0.3,
  costWeight: 0.2,
});

// 3. Register routing rules
routingEngine.registerRule(createHighValueRule(10000));
routingEngine.registerRule(createLowLatencyRule(100));

// 4. Make routing decision
const payment = Payment.create({ amount: 15000, ... });
const decision = routingEngine.selectGateway(
  payment,
  ['STRIPE', 'PAYPAL', 'SQUARE']
);

console.log(`Selected: ${decision.selectedGateway}`);
console.log(`Score: ${decision.score}`);
console.log(`Reason: ${decision.reason}`);
```

### Custom Routing Rules

```typescript
import { RoutingRule } from './orchestration/intelligentRouting';

const customRule: RoutingRule = {
  name: 'business-hours-rule',
  priority: 100,
  condition: (payment, context) => {
    const hour = new Date().getHours();
    return hour >= 9 && hour <= 17; // Business hours
  },
  selectGateway: (payment, availableGateways, metrics) => {
    // During business hours, prefer gateway with best success rate
    const scores = availableGateways.map((gw) => ({
      gateway: gw,
      score: metrics.get(gw)?.successRate || 0,
    }));

    scores.sort((a, b) => b.score - a.score);
    return scores[0].gateway;
  },
};

routingEngine.registerRule(customRule);
```

### Metrics API

```typescript
// Record payment result
metricsCollector.recordPayment('STRIPE', {
  success: true,
  latency: 150,
  amount: 100,
});

// Get metrics for gateway
const metrics = metricsCollector.getMetrics('STRIPE');
console.log(`Success Rate: ${metrics.successRate * 100}%`);
console.log(`P95 Latency: ${metrics.p95Latency}ms`);

// Get all metrics
const allMetrics = metricsCollector.getAllMetrics();
```

---

## Circuit Breakers & Health Tracking

### Overview

Circuit breakers prevent cascading failures by failing fast when a gateway is unhealthy, with automatic recovery detection.

### Circuit States

```
┌──────────┐
│  CLOSED  │  ◄── Normal operation, all requests pass through
└────┬─────┘
     │ Failures exceed threshold
     ▼
┌──────────┐
│   OPEN   │  ◄── Fail fast, reject all requests
└────┬─────┘
     │ Timeout expires
     ▼
┌──────────┐
│HALF_OPEN │  ◄── Testing recovery, allow limited requests
└────┬─────┘
     │ Success threshold met / Failure occurs
     │
     ├──► Back to CLOSED (recovery successful)
     └──► Back to OPEN (recovery failed)
```

### Health Score Calculation

The health score (0.0 to 1.0) is calculated from multiple factors:

- **Circuit State (50%)**: CLOSED = 0.5, HALF_OPEN = 0.25, OPEN = 0.0
- **Success Rate (30%)**: Based on historical success/failure ratio
- **Consecutive Successes (10%)**: Bonus for sustained reliability
- **Consecutive Failures (-10%)**: Penalty for recent failures

### Usage Example

```typescript
import {
  CircuitBreakerManager,
  EnhancedCircuitBreaker,
} from './orchestration/enhancedCircuitBreaker';

// 1. Create circuit breaker manager
const cbManager = new CircuitBreakerManager({
  failureThreshold: 5, // Open after 5 failures
  failureRateThreshold: 0.5, // Or 50% failure rate
  successThreshold: 3, // Close after 3 successes
  openTimeout: 60000, // Wait 1 min before half-open
  halfOpenTimeout: 30000, // Test for 30s in half-open
  halfOpenMaxAttempts: 5, // Max 5 requests in half-open
  adaptiveThresholds: true,
  minHealthScore: 0.5,
});

// 2. Get circuit breaker for gateway
const breaker = cbManager.getBreaker('STRIPE');

// 3. Execute operation through breaker
try {
  const result = await breaker.execute(async () => {
    return await gateway.processPayment(payment);
  });

  console.log('Payment processed successfully');
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    console.log('Circuit breaker is open, failing fast');
    console.log(`Retry in ${error.health.timeUntilRetry}ms`);
  } else {
    console.log('Payment failed');
  }
}

// 4. Check health
const health = breaker.getHealth();
console.log(`State: ${health.circuitState}`);
console.log(`Health Score: ${health.healthScore}`);
console.log(`Success Rate: ${health.successRate}`);
```

### Health Monitoring

```typescript
// Get all gateway health
const allHealth = cbManager.getAllHealth();

for (const [gateway, health] of allHealth) {
  console.log(`${gateway}:`);
  console.log(`  State: ${health.circuitState}`);
  console.log(`  Health: ${health.healthScore.toFixed(2)}`);
  console.log(`  Success Rate: ${(health.successRate * 100).toFixed(1)}%`);
  console.log(`  Opens: ${health.openCount}`);
}

// Get only healthy gateways
const healthyGateways = cbManager.getHealthyGateways(0.7);
console.log('Healthy gateways:', healthyGateways);
```

---

## Concurrency & Optimistic Locking

### Overview

Optimistic locking prevents lost updates and race conditions in concurrent environments using version-based concurrency control.

### The Lost Update Problem

```
WITHOUT Optimistic Locking:
───────────────────────────
Time  Thread-1              Thread-2
────  ───────────────────   ───────────────────
T1    Read payment (v=1)
T2                          Read payment (v=1)
T3    Update to PAID
T4                          Update to REFUNDED
T5    Write (overwrites!)   ← LOST UPDATE!


WITH Optimistic Locking:
────────────────────────
Time  Thread-1                    Thread-2
────  ─────────────────────────   ─────────────────────────
T1    Read payment (v=1)
T2                                Read payment (v=1)
T3    Update IF version=1 (✓)
      → New version=2
T4                                Update IF version=1 (✗)
                                  → CONFLICT! Retry with v=2
```

### Usage Example

```typescript
import {
  OptimisticLockManager,
  InMemoryVersionedRepository,
  VersionedPaymentService,
} from './infra/optimisticLocking';

// 1. Setup repository with versioning
const repository = new InMemoryVersionedRepository<VersionedPayment>();

// 2. Create service with lock manager
const service = new VersionedPaymentService(repository, {
  maxRetries: 5,
  initialBackoffMs: 10,
  maxBackoffMs: 1000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
});

// 3. Update with automatic conflict resolution
try {
  const updated = await service.updateStatus('payment-123', 'PAID');
  console.log(`Updated to version ${updated.version}`);
} catch (error) {
  if (error instanceof MaxRetriesExceededError) {
    console.log('Too many conflicts, manual intervention required');
  }
}

// 4. Conditional updates (business logic + version check)
try {
  const updated = await service.conditionalUpdate(
    'payment-123',
    'PENDING', // Expected current status
    'PROCESSING' // New status
  );
} catch (error) {
  console.log('Status check or version conflict failed');
}
```

### Custom Repository Implementation

```typescript
class DatabaseVersionedRepository implements VersionedRepository<VersionedPayment> {
  async updateWithVersion(
    id: string,
    entity: VersionedPayment,
    expectedVersion: number
  ): Promise<UpdateResult<VersionedPayment>> {
    // SQL with version check
    const sql = `
      UPDATE payments
      SET status = ?, version = version + 1, updated_at = NOW()
      WHERE id = ? AND version = ?
    `;

    const result = await db.execute(sql, [entity.status, id, expectedVersion]);

    if (result.affectedRows === 0) {
      // Conflict detected
      return {
        success: false,
        entity: null,
        previousVersion: expectedVersion,
        newVersion: expectedVersion,
        conflictDetected: true,
      };
    }

    // Success
    const updated = await this.findById(id);
    return {
      success: true,
      entity: updated,
      previousVersion: expectedVersion,
      newVersion: expectedVersion + 1,
      conflictDetected: false,
    };
  }
}
```

### Backoff Strategy

The lock manager uses exponential backoff with jitter to prevent thundering herd:

```
Attempt 1: 10ms
Attempt 2: 20ms ± jitter
Attempt 3: 40ms ± jitter
Attempt 4: 80ms ± jitter
Attempt 5: 160ms ± jitter (max: 1000ms)
```

---

## Chaos Engineering

### Overview

Chaos engineering validates system resilience by injecting controlled failures during testing.

### Failure Types

1. **Latency Injection**: Slow responses (100-5000ms)
2. **Error Injection**: Random failures (network, timeout, 503, 429, 500)
3. **Timeout Injection**: Request timeouts
4. **Intermittent Failures**: Burst of failures in time window
5. **Cascading Failures**: Failures spread to other gateways
6. **Resource Exhaustion**: Connection pool exhaustion simulation

### Usage Example

```typescript
import {
  ChaosGateway,
  ChaosOrchestrator,
  ChaosConfig,
  ChaosErrorType,
} from './orchestration/chaosEngineering';

// 1. Create chaos configuration
const chaosConfig: ChaosConfig = {
  enabled: true,
  failureRate: 0.3,              // 30% of requests fail
  errorTypes: [
    ChaosErrorType.NETWORK_ERROR,
    ChaosErrorType.TIMEOUT,
    ChaosErrorType.SERVICE_UNAVAILABLE,
  ],
  latencyRate: 0.4,              // 40% have added latency
  latencyMs: { min: 100, max: 3000 },
  timeoutRate: 0.1,              // 10% timeout
  timeoutMs: 5000,
  intermittentFailureWindow: 10000,
  intermittentFailureBurst: 3,
  seed: 42,                      // For reproducibility
  maxInjections: 1000,
};

// 2. Wrap real gateway with chaos
const realGateway = new StripeGateway();
const chaosGateway = new ChaosGateway(realGateway, chaosConfig);

// 3. Define chaos experiment
const experiment: ChaosExperiment = {
  name: 'Gateway Resilience Test',
  description: 'Test system under 30% failure rate',
  duration: 60000,                    // 1 minute
  config: chaosConfig,

  // Success criteria
  expectedSuccessRate: 0.5,           // Min 50% success
  maxCircuitBreakerOpens: 5,          // Max 5 CB opens
  maxAverageLatency: 2000,            // Max 2s avg latency

  validateInvariants: async () => {
    // Check system invariants
    const payments = await db.getPayments();
    const noDuplicates = new Set(payments.map(p => p.id)).size === payments.length;
    const validStatuses = payments.every(p => isValidStatus(p.status));
    return noDuplicates && validStatuses;
  },
};

// 4. Run experiment
const orchestrator = new ChaosOrchestrator();
const result = await orchestrator.runExperiment(experiment, async () => {
  // Your test function
  const payment = Payment.create({ ... });
  await paymentService.processPayment(payment);
});

// 5. Check results
console.log(`Experiment: ${result.success ? 'PASSED' : 'FAILED'}`);
console.log(`Success Rate: ${result.successRate * 100}%`);
console.log(`Circuit Breaker Opens: ${result.circuitBreakerOpens}`);
console.log(`Average Latency: ${result.averageLatency}ms`);
console.log(`Invariants Held: ${result.invariantsHeld}`);
```

### Chaos Experiment Results

```
════════════════════════════════════════════════════════════
📊 EXPERIMENT RESULTS
════════════════════════════════════════════════════════════
✅ PASSED: Gateway Resilience Test

📈 Metrics:
  Total Requests: 523
  Successful: 367 (70.17%)
  Failed: 156
  Circuit Breaker Opens: 3

⏱️  Latency:
  Average: 485.23ms
  P95: 1250ms
  P99: 2100ms

❗ Errors:
  ChaosInjectedError: 89
  ChaosTimeoutError: 34
  CircuitBreakerOpenError: 33

🔍 Validation:
  Invariants Held: ✅
  Success Rate: ✅ (expected: 50%, actual: 70%)
  CB Opens: ✅ (max: 5, actual: 3)
  Latency: ✅ (max: 2000ms, actual: 485.23ms)
════════════════════════════════════════════════════════════
```

---

## Extensibility Hooks

### Overview

The hook system allows extending AegisPay with custom logic without modifying core code.

### Available Hook Types

1. **PrePaymentValidationHook**: Validate before processing
2. **PostPaymentValidationHook**: Validate after processing
3. **FraudCheckHook**: Custom fraud detection
4. **RoutingStrategyHook**: Custom gateway selection
5. **PaymentEnrichmentHook**: Add metadata
6. **EventListenerHook**: React to events
7. **MetricsCollectorHook**: Custom metrics
8. **ErrorHandlerHook**: Custom error handling

### Usage Example

```typescript
import { HookRegistry, HookExecutor, FraudCheckHook } from './orchestration/hooks';

// 1. Create registry and executor
const hookRegistry = new HookRegistry();
const hookExecutor = new HookExecutor(hookRegistry);

// 2. Register built-in hooks
hookRegistry.registerFraudCheck(new HighValueFraudCheck(10000));
hookRegistry.registerFraudCheck(new GeographicFraudCheck(['XX']));

// 3. Register custom hook
hookRegistry.registerFraudCheck({
  name: 'VelocityCheck',
  priority: 80,
  enabled: true,
  execute: async (context) => {
    const recentCount = await getRecentPaymentCount(context.payment.merchantId);

    if (recentCount > 10) {
      return {
        allowed: false,
        riskScore: 0.9,
        reason: `Too many payments: ${recentCount} in last hour`,
      };
    }

    return { allowed: true, riskScore: 0.1 };
  },
});

// 4. Execute hooks
const context: HookContext = {
  payment,
  timestamp: new Date(),
  requestId: 'req-123',
  metadata: { country: 'US' },
};

const fraudResult = await hookExecutor.executeFraudChecks(context);

if (!fraudResult.allowed) {
  console.log(`Payment blocked: ${fraudResult.reason}`);
  console.log(`Risk score: ${fraudResult.riskScore}`);
}
```

### Custom Routing Strategy Hook

```typescript
import { RoutingStrategyHook } from './orchestration/hooks';

class RegionBasedRoutingStrategy implements RoutingStrategyHook {
  name = 'RegionBasedRouting';
  priority = 100;
  enabled = true;

  async execute(context: RoutingContext): Promise<RoutingDecision> {
    const region = context.metadata.region as string;

    // Prefer regional gateway
    const regionalGateway = this.getRegionalGateway(region);

    if (context.availableGateways.includes(regionalGateway)) {
      return {
        gatewayType: regionalGateway,
        confidence: 0.9,
        reason: `Regional preference for ${region}`,
        metadata: { region },
      };
    }

    // Fallback to default
    return {
      gatewayType: context.availableGateways[0],
      confidence: 0.5,
      reason: 'No regional gateway available',
    };
  }

  private getRegionalGateway(region: string): GatewayType {
    const regionMap: Record<string, GatewayType> = {
      US: 'STRIPE',
      EU: 'ADYEN',
      ASIA: 'PAYPAL',
    };
    return regionMap[region] || 'STRIPE';
  }
}

hookRegistry.registerRoutingStrategy(new RegionBasedRoutingStrategy());
```

### Event Listener Hook

```typescript
hookRegistry.registerEventListener({
  name: 'SlackNotifier',
  priority: 0,
  enabled: true,
  eventTypes: ['PaymentFailed', 'RefundProcessed'],

  execute: async (event, context) => {
    await fetch('https://hooks.slack.com/...', {
      method: 'POST',
      body: JSON.stringify({
        text: `${event.type}: ${context.payment.id}`,
        amount: context.payment.amount,
        status: context.payment.status,
      }),
    });
  },
});
```

---

## Integration Examples

### Complete Payment Service with All Features

```typescript
import {
  GatewayMetricsCollector,
  IntelligentRoutingEngine,
  CircuitBreakerManager,
  HookRegistry,
  HookExecutor,
  OptimisticLockManager,
} from './orchestration';

class ProductionPaymentService {
  private routingEngine: IntelligentRoutingEngine;
  private cbManager: CircuitBreakerManager;
  private hookExecutor: HookExecutor;
  private lockManager: OptimisticLockManager;

  constructor() {
    // Setup routing
    const metricsCollector = new GatewayMetricsCollector();
    this.routingEngine = new IntelligentRoutingEngine(metricsCollector);

    // Setup circuit breakers
    this.cbManager = new CircuitBreakerManager();

    // Setup hooks
    const hookRegistry = new HookRegistry();
    hookRegistry.registerFraudCheck(new HighValueFraudCheck(10000));
    this.hookExecutor = new HookExecutor(hookRegistry);

    // Setup optimistic locking
    this.lockManager = new OptimisticLockManager();
  }

  async processPayment(payment: Payment): Promise<Payment> {
    // 1. Pre-validation hooks
    const preValidation = await this.hookExecutor.executePreValidation({
      payment,
      timestamp: new Date(),
      requestId: generateId(),
      metadata: {},
    });

    if (!preValidation.valid) {
      throw new ValidationError(preValidation.errors);
    }

    // 2. Fraud checks
    const fraudResult = await this.hookExecutor.executeFraudChecks({
      payment,
      timestamp: new Date(),
      requestId: generateId(),
      metadata: {},
    });

    if (!fraudResult.allowed) {
      throw new FraudError(fraudResult.reason, fraudResult.riskScore);
    }

    // 3. Select gateway with intelligent routing
    const healthyGateways = this.cbManager.getHealthyGateways();
    const decision = this.routingEngine.selectGateway(payment, healthyGateways);

    // 4. Get circuit breaker for selected gateway
    const breaker = this.cbManager.getBreaker(decision.selectedGateway);

    // 5. Execute with circuit breaker
    try {
      const result = await breaker.execute(async () => {
        const gateway = this.getGateway(decision.selectedGateway);
        return await gateway.processPayment(payment);
      });

      // 6. Post-validation
      await this.hookExecutor.executePostValidation({
        payment: result,
        timestamp: new Date(),
        requestId: generateId(),
        metadata: {},
      });

      return result;
    } catch (error) {
      // 7. Error handling hooks
      const errorResult = await this.hookExecutor.executeErrorHandlers({
        payment,
        timestamp: new Date(),
        requestId: generateId(),
        metadata: {},
        error: error as Error,
        attemptNumber: 1,
        previousAttempts: [],
      });

      if (errorResult?.shouldRetry) {
        // Retry logic
        return this.retryPayment(payment, errorResult.retryAfterMs);
      }

      throw error;
    }
  }
}
```

---

## Summary

The advanced features of AegisPay work together to provide:

1. **Intelligent Routing**: Optimal gateway selection based on real-time metrics
2. **Circuit Breakers**: Cascading failure prevention with health tracking
3. **Optimistic Locking**: Concurrency safety and race condition prevention
4. **Chaos Engineering**: Resilience validation through controlled failure injection
5. **Extensibility Hooks**: Custom logic integration without code modification

These features enable production-grade payment orchestration with:

- **High Availability**: Through circuit breakers and intelligent routing
- **Data Consistency**: Through optimistic locking and transactional outbox
- **Observability**: Through metrics collection and event hooks
- **Reliability**: Validated through chaos testing
- **Extensibility**: Through comprehensive hook system
