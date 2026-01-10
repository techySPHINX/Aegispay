# Transactional Outbox Pattern: Exactly-Once Event Delivery

## Overview

The **transactional outbox pattern** solves the **dual-write problem** in distributed systems where you need to atomically:

1. Update application state (e.g., payment status in database)
2. Publish events (e.g., PaymentSucceeded to message bus)

Without proper handling, these operations are **NOT atomic**, leading to:

- ❌ State changed but event lost (no notification sent)
- ❌ Event published but state update failed (inconsistent state)
- ❌ Duplicate events under retries

The transactional outbox pattern achieves **exactly-once semantics** by persisting events in the same database transaction as state changes, then publishing them asynchronously.

---

## The Dual-Write Problem

### Problem Statement

Consider this payment processing flow:

```typescript
async function processPayment(payment: Payment) {
  // Step 1: Update payment state
  payment.state = PaymentState.SUCCESS;
  await database.save(payment); // ✓ Succeeds

  // Step 2: Publish event
  await eventBus.publish(PaymentSucceeded); // ✗ CRASHES!
}
```

**What happens?**

- Payment is marked as SUCCESS in database
- But event is never published
- Downstream systems (notifications, webhooks) never know about the payment

### Why It's Hard

The problem occurs because:

1. **Two Different Systems**: Database and message bus are separate
2. **No Distributed Transaction**: Can't use 2PC (two-phase commit) - too slow/complex
3. **Network Failures**: Crash can occur between the two writes
4. **Retry Complexity**: Retrying might duplicate events

---

## Solution: Transactional Outbox

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   PAYMENT SERVICE                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Update State        BEGIN TRANSACTION                    │
│     ┌──────────┐        ┌─────────────────────┐             │
│     │ Payment  │───────►│  payments TABLE     │             │
│     │ State    │        │  id | state | ...   │             │
│     └──────────┘        └─────────────────────┘             │
│                                  │                            │
│  2. Save Event                   │ SAME TRANSACTION          │
│     ┌──────────┐                 │                            │
│     │ Payment  │─────────────────┼──►┌───────────────────┐  │
│     │ Event    │                 │   │  outbox TABLE     │  │
│     └──────────┘                 │   │  id | event | ... │  │
│                         COMMIT   │   └───────────────────┘  │
│                         ▼        │            │              │
│                    ✓ BOTH         │            │              │
│                    SUCCEED        │            │              │
│                                   │            │              │
└───────────────────────────────────┼────────────┼──────────────┘
                                    │            │
                                    │            │ 3. Background
                                    │            │    Publisher
                                    │            ▼
                             ┌──────┴────────────────────┐
                             │   OUTBOX PUBLISHER        │
                             │   (Background Worker)     │
                             └───────────┬───────────────┘
                                         │
                                         │ 4. Publish Event
                                         ▼
                             ┌─────────────────────────┐
                             │      EVENT BUS          │
                             │   (Kafka, RabbitMQ)     │
                             └─────────────────────────┘
                                         │
                                         │ 5. Consumers
                                         ▼
                         ┌──────────────────────────────────┐
                         │ Notifications, Webhooks, etc.    │
                         └──────────────────────────────────┘
```

### How It Works

**Phase 1: Transactional Write (Atomic)**

```sql
BEGIN TRANSACTION;
  -- Update payment state
  UPDATE payments
  SET state = 'SUCCESS', updated_at = NOW()
  WHERE id = 'pay_123';

  -- Insert event into outbox
  INSERT INTO outbox (id, aggregate_id, event_type, payload, status)
  VALUES ('evt_456', 'pay_123', 'PaymentSucceeded', '{"..."}', 'PENDING');
COMMIT;
```

**Key Point**: If either operation fails, **BOTH** are rolled back. State and event are **atomically persisted**.

**Phase 2: Asynchronous Publishing**

```typescript
// Background worker (OutboxPublisher)
while (true) {
  // 1. Poll for PENDING events
  const events = await outbox.getPendingEvents();

  for (const event of events) {
    // 2. Mark as PROCESSING (prevents duplicate processing)
    await outbox.markProcessing(event.id);

    try {
      // 3. Publish to event bus
      await eventBus.publish(event);

      // 4. Mark as PUBLISHED
      await outbox.markPublished(event.id);
    } catch (error) {
      // 5. Mark as failed with retry
      await outbox.markFailed(event.id, error, nextRetryTime);
    }
  }

  await sleep(pollInterval);
}
```

---

## Implementation

### 1. Outbox Entry

```typescript
interface OutboxEntry {
  id: string; // Unique event ID
  aggregateId: string; // Payment ID
  eventType: EventType; // PAYMENT_SUCCEEDED, etc.
  payload: string; // JSON-serialized event
  metadata: {
    version: number; // Event version for ordering
    eventTimestamp: Date; // Original event time
    idempotencyKey?: string; // For deduplication
    correlationId?: string; // For tracing
  };
  status: OutboxStatus; // PENDING, PUBLISHED, FAILED
  createdAt: Date; // When entry was created
  publishedAt: Date | null; // When event was published
  attempts: number; // Retry counter
  lastError: string | null; // Last error message
  nextRetryAt: Date | null; // Next retry time
}

enum OutboxStatus {
  PENDING = 'PENDING', // Not yet published
  PROCESSING = 'PROCESSING', // Currently being published
  PUBLISHED = 'PUBLISHED', // Successfully published
  FAILED = 'FAILED', // Permanently failed
}
```

### 2. Outbox Store

```typescript
interface OutboxStore {
  // Save event in transaction with state change
  save(entry: OutboxEntry): Promise<void>;

  // Get pending events ready for publishing
  getPendingEntries(limit: number): Promise<OutboxEntry[]>;

  // Mark event as published
  markPublished(entryId: string): Promise<void>;

  // Mark event as failed with retry info
  markFailed(entryId: string, error: string, nextRetryAt: Date | null): Promise<void>;

  // Cleanup old published events
  deletePublished(olderThan: Date): Promise<number>;
}
```

### 3. Outbox Publisher

```typescript
class OutboxPublisher {
  constructor(
    private store: OutboxStore,
    private eventBus: EventBus,
    private config: OutboxPublisherConfig
  ) {}

  async start(): Promise<void> {
    // Start polling for pending events
    this.scheduleNextPoll();
  }

  private async pollAndPublish(): Promise<void> {
    // Get pending entries
    const entries = await this.store.getPendingEntries(batchSize);

    for (const entry of entries) {
      try {
        // Mark as processing
        await this.store.markProcessing(entry.id);

        // Publish event
        await this.eventBus.publish(deserialize(entry));

        // Mark as published
        await this.store.markPublished(entry.id);
      } catch (error) {
        // Retry logic with exponential backoff
        const nextRetryAt = calculateBackoff(entry.attempts);
        await this.store.markFailed(entry.id, error, nextRetryAt);
      }
    }
  }
}
```

### 4. Transactional Event Bus

```typescript
class TransactionalEventBus {
  constructor(private outboxStore: OutboxStore) {}

  // Save event to outbox instead of publishing directly
  async saveEvent(event: PaymentEvent): Promise<void> {
    const entry = createOutboxEntry(event);
    await this.outboxStore.save(entry);
  }
}
```

### 5. Payment Service Integration

```typescript
class TransactionalPaymentService {
  private async savePaymentWithEvent(payment: Payment, event: PaymentEvent): Promise<Payment> {
    // CRITICAL: Wrap in database transaction
    return await database.transaction(async (tx) => {
      // 1. Save payment state
      await tx.payments.save(payment);

      // 2. Save event to outbox
      await tx.outbox.save(createOutboxEntry(event));

      // Transaction commits - both succeed or both fail
    });
  }
}
```

---

## Exactly-Once Delivery Guarantee

### The Guarantee

**At-Least-Once Delivery**: Every event is delivered one or more times (no lost events)

**Exactly-Once Processing**: Each event is processed exactly once (via consumer idempotency)

### How It's Achieved

#### 1. **No Lost Events** (Durability)

Events are persisted in the outbox **before** being published:

```
Time    Action                              State
────────────────────────────────────────────────────────
t1      BEGIN TRANSACTION                   -
t2      UPDATE payments SET state=SUCCESS   DB only
t3      INSERT INTO outbox ...              DB only
t4      COMMIT                              ✓ BOTH persisted
t5      💥 CRASH (before publish)           Events safe in outbox!
t6      Service restarts                    -
t7      OutboxPublisher scans outbox        Finds unpublished events
t8      Publish events from outbox          Events delivered
```

**Result**: Even if service crashes **immediately** after committing the transaction, events are safely persisted and will be published on restart.

#### 2. **No Duplicate Processing** (Idempotency)

Each outbox entry has a unique ID used for consumer idempotency:

```typescript
// Consumer side
async function handlePaymentSucceeded(event: PaymentEvent) {
  const processed = await checkIfProcessed(event.eventId);

  if (processed) {
    console.log('Event already processed, skipping');
    return; // Idempotent - safe to receive multiple times
  }

  // Process event
  await sendNotification(event);

  // Mark as processed
  await markProcessed(event.eventId);
}
```

#### 3. **Ordering Within Aggregate** (Version Numbers)

Events for the same payment are ordered by version number:

```typescript
interface OutboxEntry {
  aggregateId: string; // pay_123
  metadata: {
    version: number; // 1, 2, 3, ...
  };
}

// Publisher ensures ordering
const events = await outbox.getPendingEntries().orderBy('aggregateId', 'version');
```

---

## Failure Scenarios & Recovery

### Scenario 1: Service Crashes After State Update, Before Event Save

**Without Outbox:**

```
BEGIN TRANSACTION
UPDATE payments SET state=SUCCESS
COMMIT
💥 CRASH
// Event never saved or published - LOST!
```

**With Outbox:**

```
BEGIN TRANSACTION
UPDATE payments SET state=SUCCESS
INSERT INTO outbox ...
💥 CRASH (before COMMIT)
ROLLBACK (automatic)
// Nothing persisted - will retry entire operation
```

**Result**: Transaction atomicity ensures state and event are **both saved or both lost**. No partial writes.

### Scenario 2: Service Crashes After Commit, Before Publishing

**Timeline:**

```
t1  BEGIN TRANSACTION
t2  UPDATE payments SET state=SUCCESS
t3  INSERT INTO outbox (status=PENDING)
t4  COMMIT ✓                              [State + Event persisted]
t5  💥 CRASH (before OutboxPublisher runs)
t6  Service restarts
t7  OutboxPublisher scans outbox
t8  Finds PENDING event
t9  Publishes event ✓
```

**Result**: Event is eventually published. Zero data loss.

### Scenario 3: Event Published But Acknowledgement Lost

**Timeline:**

```
t1  OutboxPublisher gets PENDING event
t2  Mark as PROCESSING
t3  Publish to EventBus ✓                 [Event delivered]
t4  💥 CRASH (before marking PUBLISHED)
t5  Service restarts
t6  OutboxPublisher sees PROCESSING event
t7  Retry publish (event sent again)
```

**Result**: Event delivered **at-least-once**. Consumer must be idempotent.

### Scenario 4: Database Transaction Fails

**Timeline:**

```
t1  BEGIN TRANSACTION
t2  UPDATE payments SET state=SUCCESS
t3  INSERT INTO outbox ...
t4  Constraint violation (e.g., duplicate ID)
t5  ROLLBACK                               [Nothing persisted]
```

**Result**: Entire operation fails atomically. Application can retry from scratch.

---

## Comparison with Alternatives

### vs. Direct Event Publishing

| Aspect          | Direct Publishing             | Outbox Pattern                   |
| --------------- | ----------------------------- | -------------------------------- |
| **Atomicity**   | ❌ None (two separate writes) | ✅ Guaranteed (same transaction) |
| **Data Loss**   | ❌ Events lost on crash       | ✅ Zero data loss                |
| **Ordering**    | ❌ Not guaranteed             | ✅ Guaranteed per aggregate      |
| **Idempotency** | ❌ Must handle externally     | ✅ Built-in via event IDs        |
| **Complexity**  | ✅ Simple                     | ⚠️ Moderate (outbox + publisher) |

### vs. 2PC (Two-Phase Commit)

| Aspect           | 2PC                               | Outbox Pattern                  |
| ---------------- | --------------------------------- | ------------------------------- |
| **Performance**  | ❌ Slow (coordination overhead)   | ✅ Fast (async publishing)      |
| **Availability** | ❌ Blocks on coordinator failure  | ✅ High (eventual consistency)  |
| **Scalability**  | ❌ Limited (tight coupling)       | ✅ Excellent (loose coupling)   |
| **Complexity**   | ❌ High (protocol implementation) | ⚠️ Moderate (background worker) |

### vs. CDC (Change Data Capture)

| Aspect               | CDC                                  | Outbox Pattern                 |
| -------------------- | ------------------------------------ | ------------------------------ |
| **Database Support** | ⚠️ Limited (needs WAL access)        | ✅ Any database                |
| **Schema Changes**   | ⚠️ Brittle (tied to table structure) | ✅ Resilient (explicit events) |
| **Event Schema**     | ❌ Raw DB rows (not domain events)   | ✅ Clean domain events         |
| **Control**          | ❌ Automatic (hard to customize)     | ✅ Full control                |

---

## Production Considerations

### Database Schema

```sql
CREATE TABLE outbox (
  id VARCHAR(255) PRIMARY KEY,
  aggregate_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  published_at TIMESTAMP,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMP,

  INDEX idx_status_retry (status, next_retry_at),
  INDEX idx_aggregate_version (aggregate_id, version)
);
```

### Publisher Configuration

```typescript
const config: OutboxPublisherConfig = {
  pollInterval: 1000, // Poll every 1 second
  batchSize: 100, // Process 100 events per batch
  maxRetries: 10, // Retry up to 10 times
  retryBaseDelay: 1000, // Start with 1 second delay
  retryMaxDelay: 60000, // Max 1 minute delay
  enableCleanup: true, // Clean up old published events
  cleanupAge: 86400000, // After 24 hours
};
```

### Monitoring Metrics

```typescript
// Track outbox health
metrics.gauge('outbox.pending_count', pendingCount);
metrics.gauge('outbox.failed_count', failedCount);
metrics.gauge('outbox.oldest_pending_age_seconds', oldestAge);

// Track publisher performance
metrics.increment('outbox.published_total');
metrics.increment('outbox.publish_failed_total');
metrics.recordDuration('outbox.publish_latency', latency);

// Alert on anomalies
if (pendingCount > 1000) {
  alert('Outbox backlog building up!');
}
```

### Scaling Strategies

#### 1. **Multiple Publishers**

Run multiple OutboxPublisher instances with partitioning:

```typescript
// Publisher 1: Process payments starting with 0-4
const publisher1 = new OutboxPublisher(store, eventBus, {
  ...config,
  filterFn: (entry) => entry.aggregateId.charCodeAt(0) % 10 < 5,
});

// Publisher 2: Process payments starting with 5-9
const publisher2 = new OutboxPublisher(store, eventBus, {
  ...config,
  filterFn: (entry) => entry.aggregateId.charCodeAt(0) % 10 >= 5,
});
```

#### 2. **Priority Queues**

Process high-priority events first:

```typescript
async getPendingEntries(limit: number): Promise<OutboxEntry[]> {
  return await db.outbox
    .where('status', 'PENDING')
    .orderBy('priority', 'DESC')  // High priority first
    .orderBy('created_at', 'ASC')  // Then FIFO
    .limit(limit);
}
```

#### 3. **Dead Letter Queue**

Move permanently failed events to DLQ for manual review:

```typescript
if (entry.attempts >= maxRetries) {
  await deadLetterQueue.save(entry);
  await outbox.delete(entry.id);
  await alertOps(`Event ${entry.id} moved to DLQ`);
}
```

---

## Testing

### Unit Test: Atomicity

```typescript
test('state and event saved atomically', async () => {
  // Arrange
  const payment = createPayment();
  const event = PaymentSucceeded(payment);

  // Act
  await service.savePaymentWithEvent(payment, event);

  // Assert
  const savedPayment = await repository.findById(payment.id);
  const outboxEntry = await outboxStore.getById(event.eventId);

  expect(savedPayment.state).toBe(PaymentState.SUCCESS);
  expect(outboxEntry).toBeDefined();
  expect(outboxEntry.status).toBe(OutboxStatus.PENDING);
});
```

### Integration Test: Event Publishing

```typescript
test('events published from outbox', async () => {
  // Arrange
  const publishedEvents = [];
  eventBus.subscribe(EventType.PAYMENT_SUCCEEDED, (e) => publishedEvents.push(e));

  // Act
  await service.createPayment(request);
  await publisher.start();
  await sleep(2000);

  // Assert
  expect(publishedEvents).toHaveLength(1);
  expect(publishedEvents[0].eventType).toBe(EventType.PAYMENT_SUCCEEDED);
});
```

### Chaos Test: Crash Recovery

```typescript
test('events published after crash', async () => {
  // Create payment (event in outbox)
  await service.createPayment(request);

  // Simulate crash (stop without publishing)
  await publisher.stop();

  // Verify event not published yet
  const published = await getPublishedEvents();
  expect(published).toHaveLength(0);

  // Restart service
  await publisher.start();
  await sleep(2000);

  // Verify event published after recovery
  const publishedAfter = await getPublishedEvents();
  expect(publishedAfter).toHaveLength(1);
});
```

---

## Summary

### Key Benefits

✅ **Atomicity**: State and events always consistent  
✅ **Durability**: Zero data loss even on crashes  
✅ **Reliability**: At-least-once delivery guarantee  
✅ **Ordering**: Events ordered per aggregate  
✅ **Scalability**: Async publishing, low latency  
✅ **Observability**: Full audit trail in outbox

### When to Use

- ✅ Critical business events (payments, orders, bookings)
- ✅ Need strong consistency guarantees
- ✅ Must survive crashes and network failures
- ✅ Downstream systems depend on events

### When NOT to Use

- ❌ Non-critical notifications (can tolerate loss)
- ❌ Fire-and-forget logging
- ❌ High-frequency telemetry data
- ❌ Read-only queries

---

## Further Reading

- **Martin Fowler**: [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- **Chris Richardson**: [Transactional Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html)
- **Designing Data-Intensive Applications** by Martin Kleppmann (Chapter 11: Stream Processing)
- **Enterprise Integration Patterns** by Gregor Hohpe (Chapter 7: Messaging)

---

**Implementation**: [`src/infra/transactionalOutbox.ts`](../src/infra/transactionalOutbox.ts)  
**Service Integration**: [`src/api/transactionalPaymentService.ts`](../src/api/transactionalPaymentService.ts)  
**Demo**: [`src/examples/outboxDemo.ts`](../src/examples/outboxDemo.ts)
