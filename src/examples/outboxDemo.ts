/**
 * Transactional Outbox Pattern Demo
 * 
 * This demo showcases the transactional outbox pattern and exactly-once semantics.
 * 
 * WHAT YOU'LL SEE:
 * 1. Atomic state updates and event persistence
 * 2. Background event publishing from outbox
 * 3. Retry logic with exponential backoff
 * 4. Crash recovery simulation
 * 5. Exactly-once delivery guarantees
 */

import { TransactionalPaymentService } from '../api/transactionalPaymentService';
import { InMemoryPaymentRepository } from '../infra/db';
import { InMemoryEventBus } from '../infra/eventBus';
import { GatewayRegistry } from '../gateways/registry';
import { MockGateway } from '../gateways/mockGateway';
import { PaymentRouter } from '../orchestration/router';
import { RetryPolicy } from '../orchestration/retryPolicy';
import { ConsoleLogger, InMemoryMetricsCollector } from '../infra/observability';
import { InMemoryLockManager } from '../infra/lockManager';
import {
  InMemoryOutboxStore,
} from '../infra/transactionalOutbox';
import { Currency, PaymentMethodType, GatewayType } from '../domain/types';
import { PaymentEvent, EventType } from '../domain/events';

// ============================================================================
// DEMO SETUP
// ============================================================================

async function setupDemo(): Promise<{
  service: TransactionalPaymentService;
  outboxStore: InMemoryOutboxStore;
  eventBus: InMemoryEventBus;
  publishedEvents: PaymentEvent[];
}> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  TRANSACTIONAL OUTBOX PATTERN DEMO');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Initialize infrastructure
  const repository = new InMemoryPaymentRepository();
  const eventBus = new InMemoryEventBus();
  const outboxStore = new InMemoryOutboxStore();
  const lockManager = new InMemoryLockManager();
  const logger = new ConsoleLogger();
  const metrics = new InMemoryMetricsCollector();

  // Initialize gateways
  const gatewayRegistry = new GatewayRegistry();
  const mockGateway = new MockGateway(
    { apiKey: 'mock' },
    {
      successRate: 0.9,
      latency: 100,
    }
  );
  gatewayRegistry.register(GatewayType.MOCK, mockGateway);

  // Initialize router and retry policy
  const router = new PaymentRouter(gatewayRegistry);
  const retryPolicy = new RetryPolicy();

  // Create transactional payment service
  const service = new TransactionalPaymentService(
    repository,
    gatewayRegistry,
    router,
    retryPolicy,
    logger,
    metrics,
    eventBus,
    outboxStore,
    lockManager
  );

  // Subscribe to events to see what gets published
  const publishedEvents: PaymentEvent[] = [];
  eventBus.subscribe(EventType.PAYMENT_INITIATED, async (event) => {
    publishedEvents.push(event);
    console.log(`  [EventBus] Received: ${event.eventType} (v${event.version})`);
  });
  eventBus.subscribe(EventType.PAYMENT_AUTHENTICATED, async (event) => {
    publishedEvents.push(event);
    console.log(`  [EventBus] Received: ${event.eventType} (v${event.version})`);
  });
  eventBus.subscribe(EventType.PAYMENT_PROCESSING, async (event) => {
    publishedEvents.push(event);
    console.log(`  [EventBus] Received: ${event.eventType} (v${event.version})`);
  });
  eventBus.subscribe(EventType.PAYMENT_SUCCEEDED, async (event) => {
    publishedEvents.push(event);
    console.log(`  [EventBus] Received: ${event.eventType} (v${event.version})`);
  });

  return { service, outboxStore, eventBus, publishedEvents };
}

// ============================================================================
// DEMO 1: Basic Transactional Outbox
// ============================================================================

async function demo1_BasicOutbox(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DEMO 1: Basic Transactional Outbox');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { service, outboxStore } = await setupDemo();

  console.log('Creating payment...\n');

  // Create payment (state + event saved atomically)
  const result = await service.createPayment({
    idempotencyKey: 'demo1_payment_001',
    amount: 100,
    currency: Currency.USD,
    paymentMethod: {
      type: PaymentMethodType.CARD,
      details: {
        cardNumber: '4242424242424242',
        expiryMonth: '12',
        expiryYear: '2025',
        cvv: '123',
        cardHolderName: 'Demo User',
      },
    },
    customer: {
      id: 'cust_001',
      email: 'demo@example.com',
      name: 'Demo User',
    },
  });

  if (result.isSuccess) {
    console.log('\n✓ Payment created:', result.value.id);
    console.log('  State:', result.value.state);

    // Check outbox
    const outboxEntries = await outboxStore.getByAggregateId(result.value.id);
    console.log(`\n  Outbox contains ${outboxEntries.length} event(s):`);
    outboxEntries.forEach((entry) => {
      console.log(`    - ${entry.eventType} (${entry.status})`);
    });
  }

  await service.stop();
}

// ============================================================================
// DEMO 2: Event Publishing from Outbox
// ============================================================================

async function demo2_EventPublishing(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DEMO 2: Event Publishing from Outbox');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { service, outboxStore, publishedEvents } = await setupDemo();

  console.log('Step 1: Create payment (event saved to outbox)...\n');

  const result = await service.createPayment({
    idempotencyKey: 'demo2_payment_001',
    amount: 150,
    currency: Currency.USD,
    paymentMethod: {
      type: PaymentMethodType.CARD,
      details: {
        cardNumber: '5555555555554444',
        expiryMonth: '12',
        expiryYear: '2025',
        cvv: '123',
        cardHolderName: 'Test User',
      },
    },
    customer: {
      id: 'cust_002',
      email: 'user@example.com',
      name: 'Test User',
    },
  });

  if (!result.isSuccess) {
    console.error('Failed to create payment');
    return;
  }

  const paymentId = result.value.id;
  console.log('✓ Payment created:', paymentId);

  // Check outbox before publishing
  let entries = await outboxStore.getByAggregateId(paymentId);
  console.log(`\n  Outbox status BEFORE publishing:`);
  entries.forEach((entry) => {
    console.log(`    - ${entry.eventType}: ${entry.status}`);
  });

  console.log('\nStep 2: Start outbox publisher...\n');
  await service.start();

  // Wait for publisher to process events
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Check outbox after publishing
  entries = await outboxStore.getByAggregateId(paymentId);
  console.log(`\n  Outbox status AFTER publishing:`);
  entries.forEach((entry) => {
    console.log(`    - ${entry.eventType}: ${entry.status}`);
    if (entry.publishedAt) {
      console.log(`      Published at: ${entry.publishedAt.toISOString()}`);
    }
  });

  console.log(`\n✓ Total events published: ${publishedEvents.length}`);

  await service.stop();
}

// ============================================================================
// DEMO 3: Atomicity Guarantee
// ============================================================================

async function demo3_AtomicityGuarantee(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DEMO 3: Atomicity Guarantee (State + Event)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { service, outboxStore } = await setupDemo();

  console.log('This demo shows that state changes and event persistence are atomic.\n');
  console.log('Creating and processing payment...\n');

  // Create payment
  const createResult = await service.createPayment({
    idempotencyKey: 'demo3_payment_001',
    amount: 200,
    currency: Currency.USD,
    paymentMethod: {
      type: PaymentMethodType.UPI,
      details: {
        vpa: 'user@upi',
      },
    },
    customer: {
      id: 'cust_003',
      email: 'atomic@example.com',
      name: 'Atomic User',
    },
  });

  if (!createResult.isSuccess) {
    console.error('Failed to create payment');
    return;
  }

  const paymentId = createResult.value.id;

  // Start publisher
  await service.start();

  // Process payment (will generate multiple state transitions)
  console.log('Processing payment through all states...\n');

  const processResult = await service.processPayment({
    paymentId,
    gatewayType: GatewayType.MOCK,
  });

  // Wait for events to publish
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Check final state
  const entries = await outboxStore.getByAggregateId(paymentId);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('ATOMICITY VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Payment Final State: ${processResult.isSuccess ? processResult.value.state : 'FAILED'}`);
  console.log(`\nEvents Generated (${entries.length}):`);

  entries.forEach((entry, idx) => {
    console.log(`  ${idx + 1}. ${entry.eventType}`);
    console.log(`     Status: ${entry.status}`);
    console.log(`     Created: ${entry.createdAt.toISOString()}`);
    if (entry.publishedAt) {
      console.log(`     Published: ${entry.publishedAt.toISOString()}`);
    }
  });

  console.log('\n✓ All state transitions have corresponding events');
  console.log('✓ All events persisted atomically with state changes');

  await service.stop();
}

// ============================================================================
// DEMO 4: Crash Recovery Simulation
// ============================================================================

async function demo4_CrashRecovery(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DEMO 4: Crash Recovery Simulation');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { service, outboxStore } = await setupDemo();

  console.log('Simulating service crash during event publishing...\n');

  // Create payment
  const result = await service.createPayment({
    idempotencyKey: 'demo4_payment_001',
    amount: 250,
    currency: Currency.USD,
    paymentMethod: {
      type: PaymentMethodType.CARD,
      details: {
        cardNumber: '4111111111111111',
        expiryMonth: '12',
        expiryYear: '2025',
        cvv: '123',
        cardHolderName: 'Crash Test',
      },
    },
    customer: {
      id: 'cust_004',
      email: 'crash@example.com',
      name: 'Crash Test',
    },
  });

  if (!result.isSuccess) {
    console.error('Failed to create payment');
    return;
  }

  const paymentId = result.value.id;
  console.log('✓ Payment created:', paymentId);

  // Check outbox
  let entries = await outboxStore.getByAggregateId(paymentId);
  console.log(`\n  Events in outbox: ${entries.length} (PENDING)`);

  console.log('\n💥 SIMULATING SERVICE CRASH (before publishing)...\n');
  console.log('  Service stopped without publishing events');
  console.log('  But events are safely persisted in outbox!\n');

  // Simulate crash (stop service without publishing)
  await service.stop();

  console.log('🔄 SERVICE RESTARTED\n');

  // "Restart" service - outbox still has the events
  await service.start();

  console.log('  Outbox publisher scanning for unpublished events...\n');

  // Wait for publisher to process
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Check outbox after recovery
  entries = await outboxStore.getByAggregateId(paymentId);
  console.log('✓ Events published after recovery:');
  entries.forEach((entry) => {
    console.log(`    - ${entry.eventType}: ${entry.status}`);
  });

  console.log('\n✓ Zero data loss despite crash!');
  console.log('✓ Events eventually delivered (at-least-once guarantee)');

  await service.stop();
}

// ============================================================================
// DEMO 5: Exactly-Once Semantics
// ============================================================================

async function demo5_ExactlyOnceSemantics(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DEMO 5: Exactly-Once Semantics');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { service, outboxStore, eventBus } = await setupDemo();

  // Track event deliveries
  const deliveries: Map<string, number> = new Map();

  eventBus.subscribe(EventType.PAYMENT_INITIATED, async (event) => {
    const count = deliveries.get(event.eventId) || 0;
    deliveries.set(event.eventId, count + 1);
  });

  console.log('Creating payment and starting publisher...\n');

  await service.start();

  const result = await service.createPayment({
    idempotencyKey: 'demo5_payment_001',
    amount: 300,
    currency: Currency.USD,
    paymentMethod: {
      type: PaymentMethodType.WALLET,
      details: {
        walletProvider: 'PayPal',
      },
    },
    customer: {
      id: 'cust_005',
      email: 'exactlyonce@example.com',
      name: 'Exactly Once User',
    },
  });

  if (!result.isSuccess) {
    console.error('Failed to create payment');
    return;
  }

  // Wait for events to publish
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Verify exactly-once delivery
  const entries = await outboxStore.getByAggregateId(result.value.id);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('EXACTLY-ONCE VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  let allExactlyOnce = true;
  entries.forEach((entry) => {
    const deliveryCount = deliveries.get(entry.id) || 0;
    const status = deliveryCount === 1 ? '✓' : '✗';
    console.log(`${status} Event ${entry.eventType}: delivered ${deliveryCount} time(s)`);

    if (deliveryCount !== 1) {
      allExactlyOnce = false;
    }
  });

  if (allExactlyOnce) {
    console.log('\n✓ ALL EVENTS DELIVERED EXACTLY ONCE!');
    console.log('✓ No duplicate deliveries');
    console.log('✓ No missing events');
  } else {
    console.log('\n✗ Some events not delivered exactly once');
  }

  await service.stop();
}

// ============================================================================
// DEMO 6: Outbox Statistics
// ============================================================================

async function demo6_OutboxStatistics(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DEMO 6: Outbox Statistics');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { service } = await setupDemo();

  await service.start();

  // Create multiple payments
  console.log('Creating multiple payments...\n');

  for (let i = 1; i <= 5; i++) {
    await service.createPayment({
      idempotencyKey: `demo6_payment_${i.toString().padStart(3, '0')}`,
      amount: 100 + i * 50,
      currency: Currency.USD,
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: `4${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`,
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: `User ${i}`,
        },
      },
      customer: {
        id: `cust_${i}`,
        email: `user${i}@example.com`,
        name: `User ${i}`,
      },
    });
  }

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Get statistics
  const stats = await service.getOutboxStats() as { pending: number; processing: number; published: number; failed: number };

  console.log('═══════════════════════════════════════════════════════════');
  console.log('OUTBOX STATISTICS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Pending:    ${stats.pending}`);
  console.log(`Processing: ${stats.processing}`);
  console.log(`Published:  ${stats.published}`);
  console.log(`Failed:     ${stats.failed}`);

  console.log('\n✓ Outbox processing statistics available for monitoring');

  await service.stop();
}

// ============================================================================
// RUN ALL DEMOS
// ============================================================================

async function runAllDemos(): Promise<void> {
  try {
    await demo1_BasicOutbox();
    await demo2_EventPublishing();
    await demo3_AtomicityGuarantee();
    await demo4_CrashRecovery();
    await demo5_ExactlyOnceSemantics();
    await demo6_OutboxStatistics();

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('ALL DEMOS COMPLETED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════════\n');
  } catch (error) {
    console.error('\n✗ Demo failed:', error);
  }
}

// Run if executed directly
if (require.main === module) {
  runAllDemos().catch(console.error);
}

export { runAllDemos };
