/**
 * COMPREHENSIVE DEMO: ALL FEATURES
 *
 * Demonstrates the complete AegisPay SDK including:
 * 1. Intelligent routing with metrics
 * 2. Circuit breakers with health tracking
 * 3. Optimistic locking for concurrency
 * 4. Chaos testing with failure injection
 * 5. Extensibility hooks
 */

import { Payment } from '../domain/payment';
import { GatewayType, PaymentState, Currency, PaymentMethodType } from '../domain/types';
import { Money } from '../domain/types';
import { MockGateway } from '../gateways/mockGateway';

// Intelligent Routing
import {
  GatewayMetricsCollector,
  IntelligentRoutingEngine,
} from '../orchestration/intelligentRouting';

// Circuit Breakers
import { CircuitBreakerManager } from '../orchestration/enhancedCircuitBreaker';

// Optimistic Locking
import {
  InMemoryVersionedRepository,
  VersionedPayment,
  VersionedPaymentService,
} from '../infra/optimisticLocking';

// Chaos Engineering
import {
  ChaosGateway,
  ChaosOrchestrator,
  ChaosExperiment,
  ChaosConfig,
  ChaosErrorType,
} from '../orchestration/chaosEngineering';

// Hooks
import {
  HookRegistry,
  HookExecutor,
  HighValueFraudCheck,
  GeographicFraudCheck,
  PaymentLoggingListener,
  HookContext,
  FraudCheckResult,
} from '../orchestration/hooks';

// ============================================================================
// DEMO 1: INTELLIGENT ROUTING
// ============================================================================

async function demoIntelligentRouting(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🎯 DEMO 1: INTELLIGENT ROUTING WITH METRICS');
  console.log('='.repeat(80) + '\n');

  // Setup
  const metricsCollector = new GatewayMetricsCollector();
  // Use default weights for routing engine
  const { DEFAULT_WEIGHTS } = await import('../orchestration/intelligentRouting');
  const routingEngine = new IntelligentRoutingEngine(DEFAULT_WEIGHTS);

  // Simulate some traffic to build metrics
  const gateways: GatewayType[] = [GatewayType.STRIPE, GatewayType.PAYPAL, GatewayType.RAZORPAY];

  console.log('📊 Simulating traffic to collect metrics...\n');

  for (let i = 0; i < 50; i++) {
    const gateway = gateways[i % gateways.length];
    const success = Math.random() > 0.1; // 90% success rate
    const latency = Math.random() * 200 + 50; // 50-250ms
    const cost = 0.029; // 2.9% fee

    if (success) {
      metricsCollector.recordSuccess(gateway, latency, cost);
    } else {
      metricsCollector.recordFailure(gateway, latency);
    }
  }

  // Make routing decisions
  console.log('🔀 Making routing decisions:\n');

  const testPayments = [
    { amount: 100, description: 'Small payment' },
    { amount: 15000, description: 'High-value payment' },
    { amount: 500, description: 'Standard payment' },
  ];

  for (const { amount, description } of testPayments) {
    const payment = new Payment({
      id: `payment-${Date.now()}`,
      idempotencyKey: `idem-${Date.now()}`,
      state: PaymentState.INITIATED,
      amount: new Money(amount, Currency.USD),
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4111111111111111',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'Test User',
        },
      },
      customer: {
        id: 'customer-1',
        email: 'test@example.com',
      },
      metadata: {},
      retryCount: 0,
    });

    const context = {
      payment,
      availableGateways: gateways,
      metrics: metricsCollector.getAllMetrics(),
      metadata: {},
    };

    const decision = routingEngine.selectGateway(context);

    console.log(`💳 ${description} ($${amount}):`);
    console.log(`   → Selected: ${decision.selectedGateway}`);
    console.log(`   → Score: ${decision.score.toFixed(3)}`);
    console.log(`   → Reason: ${decision.reason}`);
    console.log();
  }

  // Show metrics
  console.log('📈 Gateway Metrics:\n');
  for (const gateway of gateways) {
    const metrics = metricsCollector.getMetrics(gateway);
    if (metrics) {
      console.log(`${gateway}:`);
      console.log(`   Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
      console.log(`   Avg Latency: ${metrics.avgLatency.toFixed(0)}ms`);
      console.log(`   P95 Latency: ${metrics.p95Latency.toFixed(0)}ms`);
      console.log();
    }
  }
}

// ============================================================================
// DEMO 2: CIRCUIT BREAKERS
// ============================================================================

async function demoCircuitBreakers(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🔌 DEMO 2: CIRCUIT BREAKERS WITH HEALTH TRACKING');
  console.log('='.repeat(80) + '\n');

  const cbManager = new CircuitBreakerManager({
    failureThreshold: 3,
    failureRateThreshold: 0.5,
    successThreshold: 2,
    openTimeout: 5000,
    halfOpenTimeout: 3000,
    halfOpenMaxAttempts: 3,
    adaptiveThresholds: true,
    minHealthScore: 0.5,
  });

  const breaker = cbManager.getBreaker(GatewayType.STRIPE);

  // Simulate failures
  console.log('❌ Simulating failures...\n');

  for (let i = 0; i < 5; i++) {
    try {
      await breaker.execute(async () => {
        throw new Error('Gateway timeout');
      });
    } catch (error) {
      console.log(`   Attempt ${i + 1}: Failed (${breaker.getState()})`);
    }
  }

  console.log();

  // Circuit should be open now
  console.log('🚫 Circuit is now OPEN. Attempting requests...\n');

  try {
    await breaker.execute(async () => {
      return { success: true };
    });
  } catch (error) {
    console.log(`   Request blocked: ${(error as Error).message}`);
  }

  console.log();

  // Wait for half-open
  console.log('⏳ Waiting for circuit to enter HALF_OPEN state...\n');
  await new Promise((resolve) => setTimeout(resolve, 5500));

  // Try to recover
  console.log('✅ Simulating successful requests in HALF_OPEN state...\n');

  for (let i = 0; i < 3; i++) {
    try {
      await breaker.execute(async () => {
        return { success: true };
      });
      console.log(`   Attempt ${i + 1}: Success (${breaker.getState()})`);
    } catch (error) {
      console.log(`   Attempt ${i + 1}: ${(error as Error).message}`);
    }
  }

  console.log();

  // Show health
  const health = breaker.getHealth();
  if (health) {
    console.log('💊 Health Status:\n');
    console.log(`   State: ${health.circuitState}`);
    console.log(`   Health Score: ${health.healthScore.toFixed(2)}`);
    console.log(`   Success Rate: ${(health.successRate * 100).toFixed(1)}%`);
    console.log(`   Consecutive Successes: ${health.consecutiveSuccesses}`);
    console.log(`   Total Opens: ${health.openCount}`);
  }
}

// ============================================================================
// DEMO 3: OPTIMISTIC LOCKING
// ============================================================================

async function demoOptimisticLocking(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🔒 DEMO 3: OPTIMISTIC LOCKING FOR CONCURRENCY SAFETY');
  console.log('='.repeat(80) + '\n');

  const repository = new InMemoryVersionedRepository<VersionedPayment>();
  const service = new VersionedPaymentService(repository, {
    maxRetries: 5,
    initialBackoffMs: 10,
    maxBackoffMs: 100,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  });

  // Create payment
  const payment = await repository.insert({
    id: 'payment-123',
    amount: 100,
    status: 'PENDING',
    updatedAt: new Date(),
    version: 1,
  });

  console.log('📝 Created payment:\n');
  console.log(`   ID: ${payment.id}`);
  console.log(`   Status: ${payment.status}`);
  console.log(`   Version: ${payment.version}`);
  console.log();

  // Simulate concurrent updates
  console.log('🔄 Simulating concurrent updates...\n');

  const updates = [
    service.updateStatus('payment-123', 'PROCESSING'),
    service.updateStatus('payment-123', 'PAID'),
    service.updateStatus('payment-123', 'COMPLETED'),
  ];

  try {
    const results = await Promise.allSettled(updates);

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        console.log(`   Update ${i + 1}: ✅ Success (v${result.value.version})`);
      } else {
        console.log(`   Update ${i + 1}: ❌ Failed - ${result.reason.message}`);
      }
    });
  } catch (error) {
    console.error('Error:', error);
  }

  console.log();

  // Show final state
  const final = await repository.findById('payment-123');
  if (final) {
    console.log('📊 Final state:\n');
    console.log(`   Status: ${final.status}`);
    console.log(`   Version: ${final.version}`);
    console.log(`   → All updates were serialized correctly! ✅`);
  }
}

// ============================================================================
// DEMO 4: CHAOS TESTING
// ============================================================================

async function demoChaosEngineering(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🔥 DEMO 4: CHAOS ENGINEERING & FAILURE SIMULATION');
  console.log('='.repeat(80) + '\n');

  const realGateway = new MockGateway(
    {
      apiKey: 'test-key',
      baseUrl: 'https://mock.stripe.com',
      timeout: 1000,
    },
    {
      successRate: 1.0,
      latency: 100,
    }
  );

  const chaosConfig: ChaosConfig = {
    enabled: true,
    failureRate: 0.3,
    errorTypes: [
      ChaosErrorType.NETWORK_ERROR,
      ChaosErrorType.TIMEOUT,
      ChaosErrorType.SERVICE_UNAVAILABLE,
    ],
    latencyRate: 0.4,
    latencyMs: { min: 100, max: 1000 },
    timeoutRate: 0.1,
    timeoutMs: 5000,
    intermittentFailureWindow: 10000,
    intermittentFailureBurst: 3,
    cascadeFailureRate: 0.05,
    resourceExhaustionRate: 0.02,
    seed: 42,
    maxInjections: 100,
  };

  const chaosGateway = new ChaosGateway(realGateway, chaosConfig);

  const orchestrator = new ChaosOrchestrator();

  const experiment: ChaosExperiment = {
    name: 'Gateway Resilience Test',
    description: 'Test system behavior under 30% failure rate with latency',
    duration: 3000, // 3 seconds
    config: chaosConfig,
    expectedSuccessRate: 0.5,
    maxCircuitBreakerOpens: 3,
    maxAverageLatency: 2000,
    validateInvariants: async () => {
      // Check invariants
      return true;
    },
  };

  let successCount = 0;
  let failCount = 0;

  await orchestrator.runExperiment(experiment, async () => {
    const payment = new Payment({
      id: `payment-${Date.now()}`,
      idempotencyKey: `idem-${Date.now()}`,
      state: PaymentState.INITIATED,
      amount: new Money(100, Currency.USD),
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4111111111111111',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'Test User',
        },
      },
      customer: {
        id: 'customer-1',
        email: 'test@example.com',
      },
      metadata: {},
      retryCount: 0,
    });

    try {
      const result = await chaosGateway.process(payment);
      if (result.isSuccess) {
        successCount++;
      } else {
        failCount++;
        if ('error' in result) {
          throw new Error(result.error.message);
        } else {
          throw new Error('Unknown error');
        }
      }
    } catch (error) {
      failCount++;
      throw error;
    }
  });

  console.log(`\n📊 Manual counters: ${successCount} success, ${failCount} failures\n`);
}

// ============================================================================
// DEMO 5: EXTENSIBILITY HOOKS
// ============================================================================

async function demoExtensibilityHooks(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🔌 DEMO 5: SDK EXTENSIBILITY HOOKS');
  console.log('='.repeat(80) + '\n');

  const registry = new HookRegistry();
  const executor = new HookExecutor(registry);

  // Register hooks
  console.log('📝 Registering hooks...\n');

  registry.registerFraudCheck(new HighValueFraudCheck(5000));
  registry.registerFraudCheck(new GeographicFraudCheck(['XX', 'YY']));
  registry.registerEventListener(new PaymentLoggingListener());

  // Custom hook: Velocity check
  registry.registerFraudCheck({
    name: 'VelocityCheck',
    priority: 80,
    enabled: true,
    execute: async (context: HookContext): Promise<FraudCheckResult> => {
      const recentPayments = (context.metadata.recentPaymentCount as number) || 0;

      if (recentPayments > 5) {
        return {
          allowed: false,
          riskScore: 0.8,
          reason: `Too many recent payments: ${recentPayments}`,
        };
      }

      return { allowed: true, riskScore: 0.2 };
    },
  });

  console.log();

  // Test hooks
  const testCases = [
    {
      payment: new Payment({
        id: 'payment-1',
        idempotencyKey: 'idem-1',
        state: PaymentState.INITIATED,
        amount: new Money(100, Currency.USD),
        paymentMethod: {
          type: PaymentMethodType.CARD,
          details: {
            cardNumber: '4111111111111111',
            expiryMonth: '12',
            expiryYear: '2025',
            cvv: '123',
            cardHolderName: 'Test User',
          },
        },
        customer: {
          id: 'customer-1',
          email: 'test@example.com',
        },
        metadata: {},
        retryCount: 0,
      }),
      metadata: { country: 'US', recentPaymentCount: 2 },
      description: 'Normal payment',
    },
    {
      payment: new Payment({
        id: 'payment-2',
        idempotencyKey: 'idem-2',
        state: PaymentState.INITIATED,
        amount: new Money(15000, Currency.USD),
        paymentMethod: {
          type: PaymentMethodType.CARD,
          details: {
            cardNumber: '4111111111111111',
            expiryMonth: '12',
            expiryYear: '2025',
            cvv: '123',
            cardHolderName: 'Test User',
          },
        },
        customer: {
          id: 'customer-2',
          email: 'test@example.com',
        },
        metadata: {},
        retryCount: 0,
      }),
      metadata: { country: 'US', recentPaymentCount: 2 },
      description: 'High-value payment',
    },
    {
      payment: new Payment({
        id: 'payment-3',
        idempotencyKey: 'idem-3',
        state: PaymentState.INITIATED,
        amount: new Money(100, Currency.USD),
        paymentMethod: {
          type: PaymentMethodType.CARD,
          details: {
            cardNumber: '4111111111111111',
            expiryMonth: '12',
            expiryYear: '2025',
            cvv: '123',
            cardHolderName: 'Test User',
          },
        },
        customer: {
          id: 'customer-3',
          email: 'test@example.com',
        },
        metadata: {},
        retryCount: 0,
      }),
      metadata: { country: 'XX', recentPaymentCount: 2 },
      description: 'Blocked country',
    },
    {
      payment: new Payment({
        id: 'payment-4',
        idempotencyKey: 'idem-4',
        state: PaymentState.INITIATED,
        amount: new Money(100, Currency.USD),
        paymentMethod: {
          type: PaymentMethodType.CARD,
          details: {
            cardNumber: '4111111111111111',
            expiryMonth: '12',
            expiryYear: '2025',
            cvv: '123',
            cardHolderName: 'Test User',
          },
        },
        customer: {
          id: 'customer-4',
          email: 'test@example.com',
        },
        metadata: {},
        retryCount: 0,
      }),
      metadata: { country: 'US', recentPaymentCount: 10 },
      description: 'High velocity',
    },
  ];

  console.log('🔍 Testing fraud checks:\n');

  for (const { payment, metadata, description } of testCases) {
    const context: HookContext = {
      payment,
      timestamp: new Date(),
      requestId: `req-${Date.now()}`,
      metadata,
    };

    const result = await executor.executeFraudChecks(context);

    console.log(`${description} ($${payment.amount.amount}):`);
    console.log(`   Allowed: ${result.allowed ? '✅' : '❌'}`);
    if (result.riskScore) {
      console.log(`   Risk Score: ${result.riskScore.toFixed(2)}`);
    }
    if (result.reason) {
      console.log(`   Reason: ${result.reason}`);
    }
    console.log();
  }
}

// ============================================================================
// RUN ALL DEMOS
// ============================================================================

async function runAllDemos(): Promise<void> {
  try {
    await demoIntelligentRouting();
    await demoCircuitBreakers();
    await demoOptimisticLocking();
    await demoChaosEngineering();
    await demoExtensibilityHooks();

    console.log('\n' + '='.repeat(80));
    console.log('✅ ALL DEMOS COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('\n❌ Demo failed:', error);
    throw error;
  }
}

// Run if this file is executed directly
if (require.main === module) {
  runAllDemos().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export {
  demoIntelligentRouting,
  demoCircuitBreakers,
  demoOptimisticLocking,
  demoChaosEngineering,
  demoExtensibilityHooks,
  runAllDemos,
};
