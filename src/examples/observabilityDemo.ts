/**
 * OBSERVABILITY DEMO
 * 
 * Demonstrates how observability helps debug payment failures in production.
 * 
 * FEATURES DEMONSTRATED:
 * =======================
 * 1. Correlation IDs - Track payments across services
 * 2. Structured Logging - Filter and search efficiently
 * 3. Metrics Collection - Identify patterns and anomalies
 * 4. Trace Propagation - Understand performance bottlenecks
 * 5. Timer Utilities - Automatic duration tracking
 * 
 * PRODUCTION DEBUGGING SCENARIOS:
 * ===============================
 * Scenario 1: Customer reports failed payment
 * → Search logs by paymentId to reconstruct full flow
 * 
 * Scenario 2: Gateway latency spike
 * → Check metrics to identify slow gateway
 * → Use traces to find bottleneck
 * 
 * Scenario 3: Intermittent failures
 * → Analyze retry metrics
 * → Check error rates by gateway type
 */

import { createObservabilityManager, LogLevel } from '../infra/observability';
import { Payment, PaymentStatus } from '../domain/payment';
import { GatewayType } from '../domain/types';

/**
 * Simulate a payment processing operation with full observability
 */
async function processPaymentWithObservability() {
  const obsManager = createObservabilityManager(LogLevel.DEBUG);

  console.log('\n=== SCENARIO 1: Successful Payment ===\n');

  // Create observability context for the operation
  const ctx1 = obsManager.createContext('process_payment', {
    paymentId: 'pay_123',
    customerId: 'cust_456',
    gatewayType: 'stripe',
  });

  ctx1.logger.info('Payment processing started', {
    amount: 100.00,
    currency: 'USD',
  });

  // Simulate gateway call with timer
  const gatewayTimer = ctx1.logger.startTimer('gateway_call', {
    gatewayType: 'stripe',
  });

  await simulateGatewayCall(50); // 50ms latency
  const duration = gatewayTimer.end({ gatewayResponse: 'success' });

  ctx1.metrics.timing('gateway.latency', duration, {
    gateway: 'stripe',
    status: 'success',
  });

  ctx1.recordSuccess({
    transactionId: 'txn_789',
    finalStatus: PaymentStatus.COMPLETED,
  });

  console.log('\n=== SCENARIO 2: Payment with Retries ===\n');

  // Simulate payment that requires retries
  const ctx2 = obsManager.createContext('process_payment', {
    paymentId: 'pay_456',
    customerId: 'cust_789',
    gatewayType: 'paypal',
  });

  ctx2.logger.info('Payment processing started', {
    amount: 250.00,
    currency: 'EUR',
  });

  // First attempt fails
  try {
    await simulateGatewayCall(30);
    throw new Error('Gateway timeout');
  } catch (error) {
    ctx2.recordRetry(1, 'Gateway timeout - will retry');
    ctx2.metrics.timing('gateway.latency', 30, {
      gateway: 'paypal',
      status: 'timeout',
    });
  }

  // Second attempt succeeds
  await simulateGatewayCall(40);
  ctx2.recordSuccess({
    transactionId: 'txn_012',
    finalStatus: PaymentStatus.COMPLETED,
    retryCount: 1,
  });

  console.log('\n=== SCENARIO 3: Failed Payment ===\n');

  // Simulate payment failure
  const ctx3 = obsManager.createContext('process_payment', {
    paymentId: 'pay_789',
    customerId: 'cust_012',
    gatewayType: 'stripe',
  });

  ctx3.logger.info('Payment processing started', {
    amount: 500.00,
    currency: 'GBP',
  });

  try {
    await simulateGatewayCall(2000); // Slow gateway
    throw new Error('Insufficient funds');
  } catch (error) {
    ctx3.recordFailure(error as Error, {
      gatewayLatency: 2000,
      finalStatus: PaymentStatus.FAILED,
    });
    ctx3.metrics.timing('gateway.latency', 2000, {
      gateway: 'stripe',
      status: 'failure',
    });
  }

  console.log('\n=== METRICS SUMMARY ===\n');
  const metrics = obsManager.exportPrometheus();
  console.log(metrics);

  console.log('\n=== HOW TO DEBUG WITH OBSERVABILITY ===\n');
  console.log(`
DEBUGGING WORKFLOW:
===================

1. SEARCH BY PAYMENT ID
   → grep "pay_123" logs.json
   → See full payment flow with all operations
   → Correlation ID links related operations

2. ANALYZE METRICS
   → Gateway latency: avg=40ms, max=2000ms
   → Success rate: 66% (2/3 succeeded)
   → Retry rate: 33% (1/3 required retry)
   → Stripe: 1 success, 1 failure
   → PayPal: 1 success after retry

3. IDENTIFY ISSUES
   → High latency on pay_789 (2000ms)
   → Gateway timeout on pay_456 (resolved with retry)
   → Insufficient funds on pay_789 (customer issue)

4. ROOT CAUSE ANALYSIS
   → Stripe gateway slow: Check status page
   → PayPal intermittent timeouts: Enable circuit breaker
   → Insufficient funds: Not our bug, customer issue

5. TAKE ACTION
   → Set alert for gateway latency > 1000ms
   → Enable auto-retry for timeouts
   → Add circuit breaker for flaky gateways
   → Monitor success rate per gateway

PRODUCTION BENEFITS:
====================
✓ Reduce MTTR (Mean Time To Resolve) from hours to minutes
✓ Proactive alerting before customers complain
✓ Data-driven gateway selection (route to fastest)
✓ Audit trail for compliance and disputes
✓ Performance optimization insights
  `);
}

/**
 * Simulate gateway call with latency
 */
function simulateGatewayCall(latencyMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, latencyMs));
}

/**
 * Advanced: Trace propagation across services
 */
async function demonstrateDistributedTracing() {
  const obsManager = createObservabilityManager(LogLevel.INFO);

  console.log('\n=== DISTRIBUTED TRACING DEMO ===\n');

  // Service 1: Payment Service
  const paymentCtx = obsManager.createContext('payment_service', {
    paymentId: 'pay_999',
    service: 'payment-api',
  });

  paymentCtx.logger.info('Payment request received');

  // Service 2: Fraud Check (child span)
  const fraudCtx = obsManager.createContext('fraud_check', {
    paymentId: 'pay_999',
    service: 'fraud-service',
    parentTraceId: paymentCtx.traceContext.traceId,
    parentSpanId: paymentCtx.traceContext.spanId,
  });

  fraudCtx.logger.info('Running fraud check');
  await simulateGatewayCall(20);
  fraudCtx.recordSuccess({ riskScore: 0.1 });

  // Service 3: Gateway (child span)
  const gatewayCtx = obsManager.createContext('gateway_call', {
    paymentId: 'pay_999',
    service: 'gateway-proxy',
    parentTraceId: paymentCtx.traceContext.traceId,
    parentSpanId: paymentCtx.traceContext.spanId,
  });

  gatewayCtx.logger.info('Calling payment gateway');
  await simulateGatewayCall(50);
  gatewayCtx.recordSuccess({ transactionId: 'txn_999' });

  // Complete payment
  paymentCtx.recordSuccess({
    totalDuration: 70,
    childOperations: ['fraud_check', 'gateway_call'],
  });

  console.log(`
TRACE ANALYSIS:
===============
TraceID: ${paymentCtx.traceContext.traceId}

Spans:
  1. payment_service (70ms) [${paymentCtx.traceContext.spanId}]
     ├─ 2. fraud_check (20ms) [${fraudCtx.traceContext.spanId}]
     └─ 3. gateway_call (50ms) [${gatewayCtx.traceContext.spanId}]

Insights:
✓ Total latency: 70ms
✓ Fraud check: 28% of total time
✓ Gateway call: 71% of total time
✓ No blocking operations detected

Optimization Opportunities:
→ Fraud check could run in parallel with enrichment
→ Gateway latency is acceptable (< 100ms SLA)
  `);
}

// Run demos
if (require.main === module) {
  (async () => {
    await processPaymentWithObservability();
    await demonstrateDistributedTracing();
  })();
}

export { processPaymentWithObservability, demonstrateDistributedTracing };
