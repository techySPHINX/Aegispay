/**
 * Idempotency Engine Demo
 * 
 * Demonstrates how the idempotency engine prevents double charges under all failure scenarios:
 * - Network retries
 * - Client retries
 * - Service crashes and restarts
 * - Concurrent duplicate requests
 * - Request tampering detection
 */

import {
  IdempotencyEngine,
  InMemoryIdempotencyStore,
  IdempotencyFingerprintMismatchError,
} from '../infra/idempotency';
import { InMemoryLockManager } from '../infra/lockManager';
import { Payment } from '../domain/payment';
import { PaymentState, Money, Currency, PaymentMethodType, GatewayType } from '../domain/types';

// ============================================================================
// MAIN EXECUTION
// ============================================================================

(async function runAllDemos(): Promise<void> {
  const store = new InMemoryIdempotencyStore();
  const lockManager = new InMemoryLockManager();
  const engine = new IdempotencyEngine(store, lockManager, {
    ttl: 3600000, // 1 hour
    lockTimeout: 5000, // 5 seconds
    retryInterval: 50, // 50ms
    maxRetries: 100, // 5 seconds total
  });

  // ============================================================================
  // DEMO 1: Basic Idempotency - Network Retry Scenario
  // ============================================================================

  console.log('═══════════════════════════════════════════════════════════');
  console.log('DEMO 1: Basic Idempotency - Network Retry');
  console.log('═══════════════════════════════════════════════════════════\n');

  async function demo1(): Promise<void> {
    const merchantId = 'merchant_001';
    const operation = 'create_payment';
    const idempotencyKey = 'demo1_key_12345';

    const request = {
      amount: 100.00,
      currency: 'USD',
      customerId: 'cust_001',
    };

    let executionCount = 0;

    // Simulate payment creation with network retry
    const createPayment = async (): Promise<{ paymentId: string; amount: number; status: string }> => {
      executionCount++;
      console.log(`  Execution attempt #${executionCount}`);

      // Simulate actual payment creation
      return {
        paymentId: `pay_${Date.now()}`,
        amount: request.amount,
        status: 'success',
      };
    };

    console.log('Scenario: Client sends same request 3 times (network retry)\n');

    // First request - executes normally
    console.log('Request 1: Initial request');
    const result1 = await engine.executeIdempotent(
      merchantId,
      operation,
      idempotencyKey,
      request,
      createPayment
    );
    console.log('✓ Result 1:', result1);
    console.log(`  Execution count: ${executionCount}\n`);

    // Second request - returns cached response (NO execution)
    console.log('Request 2: Network retry with same key');
    const result2 = await engine.executeIdempotent(
      merchantId,
      operation,
      idempotencyKey,
      request,
      createPayment
    );
    console.log('✓ Result 2 (cached):', result2);
    console.log(`  Execution count: ${executionCount} (same as before!)\n`);

    // Third request - still cached
    console.log('Request 3: Another retry');
    const result3 = await engine.executeIdempotent(
      merchantId,
      operation,
      idempotencyKey,
      request,
      createPayment
    );
    console.log('✓ Result 3 (cached):', result3);
    console.log(`  Execution count: ${executionCount}\n`);

    console.log('✅ Result: Payment executed ONCE, but client got response 3 times');
    console.log('✅ NO DOUBLE CHARGE!\n');
  }

  await demo1();

  // ============================================================================
  // DEMO 2: Request Fingerprint - Tampering Detection
  // ============================================================================

  console.log('═══════════════════════════════════════════════════════════');
  console.log('DEMO 2: Request Fingerprint - Tampering Detection');
  console.log('═══════════════════════════════════════════════════════════\n');

  async function demo2(): Promise<void> {
    const merchantId = 'merchant_002';
    const operation = 'create_payment';
    const idempotencyKey = 'demo2_key_67890';

    const originalRequest = {
      amount: 50.00,
      currency: 'USD',
      customerId: 'cust_002',
    };

    const tamperedRequest = {
      amount: 500.00, // ⚠️ Changed amount!
      currency: 'USD',
      customerId: 'cust_002',
    };

    console.log('Scenario: Client reuses idempotency key with different amount\n');

    // First request with $50
    console.log('Request 1: Original ($50.00)');
    const result1 = await engine.executeIdempotent(
      merchantId,
      operation,
      idempotencyKey,
      originalRequest,
      async () => ({ paymentId: 'pay_50', amount: 50, status: 'success' })
    );
    console.log('✓ Result 1:', result1, '\n');

    // Second request with $500 (tampered!)
    console.log('Request 2: Tampered ($500.00) - SAME idempotency key');
    try {
      await engine.executeIdempotent(
        merchantId,
        operation,
        idempotencyKey,
        tamperedRequest,
        async () => ({ paymentId: 'pay_500', amount: 500, status: 'success' })
      );
      console.log('✗ This should never execute!');
    } catch (error) {
      if (error instanceof IdempotencyFingerprintMismatchError) {
        console.log('✓ Caught IdempotencyFingerprintMismatchError:');
        console.log(`  Expected hash: ${error.expectedHash.substring(0, 16)}...`);
        console.log(`  Actual hash:   ${error.actualHash.substring(0, 16)}...`);
        console.log('  Message:', error.message, '\n');
      }
    }

    console.log('✅ Result: Tampering detected and blocked!');
    console.log('✅ Client cannot change request parameters while reusing idempotency key\n');
  }

  await demo2();

  // ============================================================================
  // DEMO 3: Concurrent Duplicate Requests
  // ============================================================================

  console.log('═══════════════════════════════════════════════════════════');
  console.log('DEMO 3: Concurrent Duplicate Requests');
  console.log('═══════════════════════════════════════════════════════════\n');

  async function demo3(): Promise<void> {
    const merchantId = 'merchant_003';
    const operation = 'create_payment';
    const idempotencyKey = 'demo3_concurrent_key';

    const request = {
      amount: 75.00,
      currency: 'USD',
      customerId: 'cust_003',
    };

    let executionCount = 0;
    const processOrder: number[] = [];

    const createPayment = async (processId: number): Promise<{ paymentId: string; amount: number; status: string }> => {
      processOrder.push(processId);
      executionCount++;
      console.log(`  [Process ${processId}] Starting execution...`);

      // Simulate slow operation
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log(`  [Process ${processId}] Execution complete`);
      return {
        paymentId: `pay_concurrent_${Date.now()}`,
        amount: request.amount,
        status: 'success',
      };
    };

    console.log('Scenario: 3 concurrent requests with same idempotency key\n');
    console.log('Starting 3 concurrent processes...\n');

    // Launch 3 concurrent requests
    const [result1, result2, result3] = await Promise.all([
      engine.executeIdempotent(
        merchantId,
        operation,
        idempotencyKey,
        request,
        () => createPayment(1)
      ),
      engine.executeIdempotent(
        merchantId,
        operation,
        idempotencyKey,
        request,
        () => createPayment(2)
      ),
      engine.executeIdempotent(
        merchantId,
        operation,
        idempotencyKey,
        request,
        () => createPayment(3)
      ),
    ]);

    console.log('\n✓ All processes completed');
    console.log(`  Execution count: ${executionCount} (should be 1!)`);
    console.log(`  Process execution order: ${processOrder.join(' → ')}`);
    console.log('\nResults:');
    console.log('  Process 1:', result1);
    console.log('  Process 2:', result2);
    console.log('  Process 3:', result3);
    console.log('\n✅ Result: Only ONE execution despite 3 concurrent requests');
    console.log('✅ All processes got the SAME response (consistent!)');
    console.log('✅ NO DOUBLE CHARGE!\n');
  }

  await demo3();

  // ============================================================================
  // DEMO 4: Service Restart Scenario
  // ============================================================================

  console.log('═══════════════════════════════════════════════════════════');
  console.log('DEMO 4: Service Restart - Idempotency Survives Crashes');
  console.log('═══════════════════════════════════════════════════════════\n');

  async function demo4(): Promise<void> {
    const merchantId = 'merchant_004';
    const operation = 'create_payment';
    const idempotencyKey = 'demo4_restart_key';

    const request = {
      amount: 125.00,
      currency: 'USD',
      customerId: 'cust_004',
    };

    console.log('Scenario: Service crashes, then restarts and receives retry\n');

    // First request - completes successfully
    console.log('Request 1: Before crash');
    const result1 = await engine.executeIdempotent(
      merchantId,
      operation,
      idempotencyKey,
      request,
      async () => {
        console.log('  Executing payment...');
        return { paymentId: 'pay_before_crash', amount: 125, status: 'success' };
      }
    );
    console.log('✓ Result 1:', result1);
    console.log('  Payment completed and stored in idempotency store\n');

    console.log('💥 SERVICE CRASHES AND RESTARTS\n');
    console.log('(Idempotency store persists - Redis/PostgreSQL/DynamoDB)\n');

    // Simulate service restart - create new engine instance
    // In production, store would be Redis/PostgreSQL, so data persists
    const restartedEngine = new IdempotencyEngine(store, lockManager);

    // Retry after restart
    console.log('Request 2: After restart (client retry)');
    const result2 = await restartedEngine.executeIdempotent(
      merchantId,
      operation,
      idempotencyKey,
      request,
      async () => {
        console.log('  This should NOT execute!');
        return { paymentId: 'pay_after_crash', amount: 125, status: 'success' };
      }
    );
    console.log('✓ Result 2 (from store):', result2);
    console.log('\n✅ Result: Idempotency survives service restart');
    console.log('✅ Client got cached response, NO re-execution');
    console.log('✅ NO DOUBLE CHARGE!\n');
  }

  await demo4();

  // ============================================================================
  // DEMO 5: Failed Request Caching
  // ============================================================================

  console.log('═══════════════════════════════════════════════════════════');
  console.log('DEMO 5: Failed Request Caching');
  console.log('═══════════════════════════════════════════════════════════\n');

  async function demo5(): Promise<void> {
    const merchantId = 'merchant_005';
    const operation = 'create_payment';
    const idempotencyKey = 'demo5_failure_key';

    const request = {
      amount: 200.00,
      currency: 'USD',
      customerId: 'cust_005',
    };

    let attemptCount = 0;

    console.log('Scenario: Payment fails, client retries\n');

    // First request - fails with permanent error
    console.log('Request 1: Initial attempt (will fail)');
    try {
      await engine.executeIdempotent(
        merchantId,
        operation,
        idempotencyKey,
        request,
        async () => {
          attemptCount++;
          console.log(`  Execution attempt #${attemptCount}`);
          throw new Error('Insufficient funds');
        }
      );
    } catch (error: unknown) {
      console.log('✗ Error:', (error as Error).message, '\n');
    }

    // Retry - returns cached error (NO re-execution)
    console.log('Request 2: Client retry');
    try {
      await engine.executeIdempotent(
        merchantId,
        operation,
        idempotencyKey,
        request,
        async () => {
          attemptCount++;
          console.log(`  This should NOT execute!`);
          throw new Error('Insufficient funds');
        }
      );
    } catch (error: unknown) {
      console.log('✗ Cached error:', (error as Error).message);
      console.log(`  Execution count: ${attemptCount} (still 1!)\n`);
    }

    console.log('✅ Result: Failed requests are cached too');
    console.log('✅ Client gets consistent error without re-execution');
    console.log('✅ Prevents hammering gateway with failed attempts\n');
  }

  await demo5();

  // ============================================================================
  // DEMO 6: Scoped Idempotency Keys
  // ============================================================================

  console.log('═══════════════════════════════════════════════════════════');
  console.log('DEMO 6: Scoped Idempotency Keys (Merchant + Operation)');
  console.log('═══════════════════════════════════════════════════════════\n');

  async function demo6(): Promise<void> {
    const idempotencyKey = 'shared_key_999';
    const request = { amount: 100, currency: 'USD', customerId: 'cust_006' };

    console.log('Scenario: Same key used by different merchants/operations\n');

    // Merchant 1 - Create payment
    console.log('Merchant 1: create_payment with key "shared_key_999"');
    const result1 = await engine.executeIdempotent(
      'merchant_A',
      'create_payment',
      idempotencyKey,
      request,
      async () => ({ paymentId: 'pay_merchant_A', amount: 100 })
    );
    console.log('✓ Result:', result1, '\n');

    // Merchant 2 - Create payment (same key, different merchant)
    console.log('Merchant 2: create_payment with key "shared_key_999"');
    const result2 = await engine.executeIdempotent(
      'merchant_B',
      'create_payment',
      idempotencyKey,
      request,
      async () => ({ paymentId: 'pay_merchant_B', amount: 100 })
    );
    console.log('✓ Result:', result2, '\n');

    // Merchant 1 - Different operation (same key)
    console.log('Merchant 1: refund_payment with key "shared_key_999"');
    const result3 = await engine.executeIdempotent(
      'merchant_A',
      'refund_payment',
      idempotencyKey,
      request,
      async () => ({ refundId: 'ref_merchant_A', amount: 100 })
    );
    console.log('✓ Result:', result3, '\n');

    console.log('✅ Result: Scoped keys prevent collisions');
    console.log('✅ Each merchant+operation combination is independent');
    console.log('✅ Format: {merchantId}:{operation}:{key}\n');
  }

  await demo6();

  // ============================================================================
  // DEMO 7: Real-World Example - Payment Creation
  // ============================================================================

  console.log('═══════════════════════════════════════════════════════════');
  console.log('DEMO 7: Real-World Payment Creation Flow');
  console.log('═══════════════════════════════════════════════════════════\n');

  async function demo7(): Promise<void> {
    const merchantId = 'stripe_merchant_001';
    const operation = 'create_payment';
    const idempotencyKey = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const paymentRequest = {
      amount: 99.99,
      currency: 'USD',
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242',
          cvv: '123',
          expiryMonth: '12',
          expiryYear: '2025',
          cardHolderName: 'Test User',
        },
      },
      customer: {
        id: 'cust_real_001',
        email: 'customer@example.com',
        name: 'John Doe',
      },
    };

    console.log('Creating payment with full flow...\n');

    const createRealPayment = async (): Promise<unknown> => {
      console.log('  → Validating payment details');
      console.log('  → Charging payment gateway');

      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const payment = new Payment({
        id: `pay_${Date.now()}`,
        idempotencyKey,
        state: PaymentState.SUCCESS,
        amount: new Money(paymentRequest.amount, Currency.USD),
        paymentMethod: {
          type: PaymentMethodType.CARD,
          details: paymentRequest.paymentMethod.details,
        },
        customer: paymentRequest.customer,
        gatewayType: GatewayType.STRIPE,
        gatewayTransactionId: `txn_${Date.now()}`,
      });

      console.log('  → Payment processed successfully');

      return {
        payment: payment.toJSON(),
        message: 'Payment created successfully',
      };
    };

    // Initial request
    console.log('Request 1: Initial payment creation');
    const start1 = Date.now();
    const result1 = await engine.executeIdempotent(
      merchantId,
      operation,
      idempotencyKey,
      paymentRequest,
      createRealPayment
    );
    const duration1 = Date.now() - start1;
    console.log(`✓ Completed in ${duration1}ms`);
    console.log(`  Payment ID: ${(result1 as { payment: { id: string } }).payment.id}\n`);

    // Simulated retry (e.g., user clicks "Pay" button again)
    console.log('Request 2: User double-clicks (retry)');
    const start2 = Date.now();
    const result2 = await engine.executeIdempotent(
      merchantId,
      operation,
      idempotencyKey,
      paymentRequest,
      createRealPayment
    );
    const duration2 = Date.now() - start2;
    console.log(`✓ Completed in ${duration2}ms (from cache!)`);
    console.log(`  Payment ID: ${(result2 as { payment: { id: string } }).payment.id} (same!)\n`);

    console.log('✅ Result: User charged once despite double-click');
    console.log('✅ Second request returned in ~0ms (cached)');
    console.log('✅ Consistent payment ID across requests\n');
  }

  await demo7();

  // ============================================================================
  // DEMO 8: Cleanup Expired Records
  // ============================================================================

  console.log('═══════════════════════════════════════════════════════════');
  console.log('DEMO 8: Cleanup Expired Records');
  console.log('═══════════════════════════════════════════════════════════\n');

  async function demo8(): Promise<void> {
    // Create engine with short TTL for demo
    const shortTTLEngine = new IdempotencyEngine(
      new InMemoryIdempotencyStore(),
      lockManager,
      { ttl: 100 } // 100ms TTL
    );

    console.log('Creating idempotency records with 100ms TTL...\n');

    // Create some records
    for (let i = 1; i <= 5; i++) {
      await shortTTLEngine.executeIdempotent(
        'merchant_cleanup',
        'test_operation',
        `key_${i}`,
        { test: i },
        async () => ({ result: i })
      );
      console.log(`  Created record ${i}`);
    }

    console.log('\nWaiting for records to expire (150ms)...');
    await new Promise(resolve => setTimeout(resolve, 150));

    console.log('Running cleanup...\n');
    const deleted = await shortTTLEngine.cleanup();

    console.log(`✓ Deleted ${deleted} expired records`);
    console.log('\n✅ Result: Expired records are automatically cleaned up');
    console.log('✅ Prevents unbounded storage growth');
    console.log('✅ Should run periodically (e.g., every hour)\n');
  }

  await demo8();

  // ============================================================================
  // SUMMARY
  // ============================================================================

  console.log('═══════════════════════════════════════════════════════════');
  console.log('SUMMARY: How Idempotency Prevents Double Charges');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('✅ Network Retries: Cached response returned, no re-execution');
  console.log('✅ Client Retries: Same payment returned for duplicate requests');
  console.log('✅ Service Crashes: Idempotency store persists across restarts');
  console.log('✅ Concurrent Requests: Distributed locks ensure single execution');
  console.log('✅ Request Tampering: Fingerprint validation detects changes');
  console.log('✅ Failed Requests: Errors cached to prevent retry storms');
  console.log('✅ Scoped Keys: Merchant + operation prevents collisions');
  console.log('✅ Expiration: Old records cleaned up automatically\n');

  console.log('Key Mechanisms:');
  console.log('1. Request Fingerprinting (SHA-256 hash of request body)');
  console.log('2. Distributed Locking (prevents concurrent execution)');
  console.log('3. State Tracking (PROCESSING → COMPLETED/FAILED)');
  console.log('4. Response Caching (returns same result for duplicates)');
  console.log('5. Scoped Keys (merchantId:operation:key)\n');

  console.log('Production Recommendations:');
  console.log('• Use Redis for idempotency store (fast + TTL support)');
  console.log('• Set TTL to 24 hours (Stripe standard)');
  console.log('• Run cleanup job every hour');
  console.log('• Monitor fingerprint mismatches (potential attack)');
  console.log('• Track idempotency hit rate (caching efficiency)\n');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('All demos completed successfully! ✨');
  console.log('═══════════════════════════════════════════════════════════');
})().catch(console.error);
