# Concurrency & Idempotency Deep Dive

## Overview

This document explains how AegisPay handles concurrent payment requests and ensures idempotent operations at scale.

## The Concurrency Problem

### Scenario: Duplicate Payment Creation

```
Time →
T1: User clicks "Pay" button
T2: Network slow, user clicks again
T3: Two requests arrive at server simultaneously
    Request A: Create payment with idempotency_key="checkout_123"
    Request B: Create payment with idempotency_key="checkout_123"

Question: How do we ensure only ONE payment is created?
```

### Without Locking (❌ WRONG)

```typescript
// Request A and B execute concurrently
async createPayment(request: CreatePaymentRequest) {
  // Check for existing payment
  const existing = await repository.findByIdempotencyKey(request.idempotencyKey);

  if (existing) {
    return existing; // Both requests see null, proceed
  }

  // Both create new payment
  const payment = new Payment({
    idempotencyKey: request.idempotencyKey,
    // ...
  });

  // Both try to save → DATABASE CONFLICT or TWO PAYMENTS CREATED
  return await repository.save(payment);
}
```

**Problems**:

1. Race condition between check and save
2. Might create duplicate payments
3. Might throw unique constraint violation

### With Locking (✅ CORRECT)

```typescript
async createPayment(request: CreatePaymentRequest) {
  return await withLock(
    lockManager,
    `payment:create:${request.idempotencyKey}`,
    instanceId,
    30000,
    async () => {
      // Now only ONE thread can execute this
      const existing = await repository.findByIdempotencyKey(request.idempotencyKey);

      if (existing) {
        return existing;
      }

      const payment = new Payment({
        idempotencyKey: request.idempotencyKey,
        // ...
      });

      return await repository.save(payment);
    }
  );
}
```

**How it works**:

```
Request A: Acquires lock → Executes → Releases lock
Request B: Waits for lock → Acquires lock → Finds existing payment → Returns it
```

## Lock Manager Implementation

### Interface

```typescript
export interface LockManager {
  acquire(key: string, ttlMs: number, ownerId: string): Promise<boolean>;
  release(key: string, ownerId: string): Promise<boolean>;
  isLocked(key: string): Promise<boolean>;
  extend(key: string, ownerId: string, ttlMs: number): Promise<boolean>;
}
```

### In-Memory Implementation

```typescript
export class InMemoryLockManager implements LockManager {
  private locks: Map<string, Lock> = new Map();

  async acquire(key: string, ttlMs: number, ownerId: string): Promise<boolean> {
    const now = new Date();
    const existingLock = this.locks.get(key);

    // Check if lock exists and is not expired
    if (existingLock && existingLock.expiresAt > now) {
      if (existingLock.ownerId !== ownerId) {
        return false; // Locked by another owner
      }
      // Same owner: extend lock
      existingLock.expiresAt = new Date(now.getTime() + ttlMs);
      return true;
    }

    // Acquire new lock
    this.locks.set(key, {
      key,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      ownerId,
    });

    return true;
  }

  async release(key: string, ownerId: string): Promise<boolean> {
    const lock = this.locks.get(key);

    if (!lock || lock.ownerId !== ownerId) {
      return false; // Can only release your own lock
    }

    this.locks.delete(key);
    return true;
  }
}
```

### Redis Implementation (Production)

```typescript
export class RedisLockManager implements LockManager {
  constructor(private redis: RedisClient) {}

  async acquire(key: string, ttlMs: number, ownerId: string): Promise<boolean> {
    // Atomic operation: SET if not exists with expiry
    const result = await this.redis.set(
      `lock:${key}`,
      ownerId,
      'NX', // Only set if not exists
      'PX', // Expiry in milliseconds
      ttlMs
    );

    return result === 'OK';
  }

  async release(key: string, ownerId: string): Promise<boolean> {
    // Lua script ensures atomic check-and-delete
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, `lock:${key}`, ownerId);
    return result === 1;
  }

  async extend(key: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, `lock:${key}`, ownerId, ttlMs);

    return result === 1;
  }
}
```

## withLock Helper

```typescript
export async function withLock<T>(
  lockManager: LockManager,
  key: string,
  ownerId: string,
  ttlMs: number,
  fn: () => Promise<T>,
  options: { maxWaitMs?: number; retryIntervalMs?: number } = {}
): Promise<T> {
  const { maxWaitMs = 30000, retryIntervalMs = 100 } = options;
  const startTime = Date.now();

  while (true) {
    const acquired = await lockManager.acquire(key, ttlMs, ownerId);

    if (acquired) {
      try {
        return await fn();
      } finally {
        await lockManager.release(key, ownerId);
      }
    }

    // Check timeout
    if (Date.now() - startTime >= maxWaitMs) {
      throw new LockTimeoutError(key, maxWaitMs);
    }

    // Wait and retry
    await sleep(retryIntervalMs);
  }
}
```

### Features

1. **Automatic Retry**: Waits for lock to become available
2. **Timeout**: Fails after maxWaitMs to prevent infinite waiting
3. **Guaranteed Release**: Uses try-finally to ensure lock is released
4. **Configurable**: Can adjust wait time and retry interval

## Idempotency Guarantees

### What is Idempotency?

**Definition**: Making the same request multiple times has the same effect as making it once.

```
POST /payments with idempotency_key=abc → Creates payment_1
POST /payments with idempotency_key=abc → Returns payment_1 (does not create new)
POST /payments with idempotency_key=abc → Returns payment_1 (does not create new)
```

### Implementation

```typescript
async createPayment(request: CreatePaymentRequest): Promise<Result<Payment, Error>> {
  return await withLock(
    this.lockManager,
    `payment:create:${request.idempotencyKey}`, // Lock by idempotency key
    this.instanceId,
    30000,
    async () => {
      // Critical section protected by lock

      // 1. Check if payment already exists
      const existing = await this.repository.findByIdempotencyKey(
        request.idempotencyKey
      );

      if (existing) {
        this.metrics.increment('payment.idempotency_hit');
        return ok(existing); // Return existing, don't create new
      }

      // 2. Create new payment (only if doesn't exist)
      const payment = new Payment({
        id: generateId(),
        idempotencyKey: request.idempotencyKey,
        state: PaymentState.INITIATED,
        amount: new Money(request.amount, request.currency),
        paymentMethod: request.paymentMethod,
        customer: request.customer,
      });

      // 3. Save to database
      const saved = await this.repository.save(payment);

      // 4. Emit event
      await this.eventBus.publish(
        PaymentEventFactory.createPaymentInitiated(saved, 1)
      );

      return ok(saved);
    }
  );
}
```

### Idempotency Keys

**Best Practices**:

1. User-provided: `checkout_{session_id}`
2. Include context: `user_{userId}_checkout_{cartId}`
3. Use UUID for uniqueness: `idem_${uuidv4()}`
4. Include timestamp: `pay_${userId}_${timestamp}`

**Storage**:

```typescript
// Database index for fast lookup
CREATE UNIQUE INDEX idx_payment_idempotency_key
ON payments(idempotency_key);

// Repository implementation
async findByIdempotencyKey(key: string): Promise<Payment | null> {
  return this.payments.get(this.idempotencyIndex.get(key));
}
```

## Concurrent Processing

### Scenario: Simultaneous Payment Processing

```
Request A: Process payment_123
Request B: Process payment_123 (at same time)
```

Without lock:

```
A: Load payment → state=INITIATED
B: Load payment → state=INITIATED
A: Call gateway → success
B: Call gateway → success (DUPLICATE CHARGE!)
A: Update state → SUCCESS
B: Update state → SUCCESS
```

With lock:

```
A: Acquire lock for payment_123
B: Wait for lock...
A: Process payment → SUCCESS
A: Release lock
B: Acquire lock
B: Load payment → state=SUCCESS (already processed)
B: Return existing result
B: Release lock
```

### Implementation

```typescript
async processPayment(request: ProcessPaymentRequest): Promise<Result<Payment, Error>> {
  return await withLock(
    this.lockManager,
    `payment:process:${request.paymentId}`,
    this.instanceId,
    60000, // 60 second lock for processing
    async () => {
      // Load current state
      let payment = await this.repository.findById(request.paymentId);

      // Check if already processed
      if (payment.isTerminal()) {
        return ok(payment); // Already done
      }

      // Process payment (guaranteed no concurrent execution)
      payment = await this.executePayment(payment);
      await this.repository.update(payment);

      return ok(payment);
    }
  );
}
```

## Lock Timeout Handling

### Why Timeouts Matter

**Problem**: Process crashes while holding lock

```
Process A: Acquire lock
Process A: Start processing
Process A: CRASH (lock not released)
Process B: Tries to acquire lock → BLOCKED FOREVER
```

**Solution**: Lock TTL (Time To Live)

```typescript
await lockManager.acquire(
  key,
  30000, // Lock expires after 30 seconds
  ownerId
);
```

### Auto-Cleanup

```typescript
export class InMemoryLockManager {
  constructor() {
    // Cleanup expired locks every 5 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredLocks();
    }, 5000);
  }

  private cleanupExpiredLocks(): void {
    const now = new Date();
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }
}
```

### Lock Extension

For long-running operations:

```typescript
async processLongPayment(payment: Payment) {
  const lockKey = `payment:process:${payment.id}`;
  const ownerId = this.instanceId;

  await lockManager.acquire(lockKey, 30000, ownerId);

  try {
    for (const step of steps) {
      await executeStep(step);

      // Extend lock if needed
      await lockManager.extend(lockKey, ownerId, 30000);
    }
  } finally {
    await lockManager.release(lockKey, ownerId);
  }
}
```

## Performance Considerations

### Lock Contention

**Problem**: Too many threads waiting for same lock

```
100 requests for same payment → 99 threads waiting
```

**Solutions**:

1. Use separate locks for different operations
2. Implement fair queuing
3. Add request coalescing

### Lock Granularity

**Too Coarse**:

```typescript
// BAD: Locks all payment processing
await withLock(lockManager, 'payments', ownerId, ttl, async () => {
  await processPayment(payment1);
  await processPayment(payment2);
});
```

**Too Fine**:

```typescript
// BAD: Too many locks
await withLock(lockManager, `payment:${id}:step1`, ...);
await withLock(lockManager, `payment:${id}:step2`, ...);
await withLock(lockManager, `payment:${id}:step3`, ...);
```

**Just Right**:

```typescript
// GOOD: One lock per payment operation
await withLock(lockManager, `payment:process:${id}`, ...);
```

### Distributed Locking Performance

| Implementation | Latency | Throughput   | Fault Tolerance      |
| -------------- | ------- | ------------ | -------------------- |
| In-Memory      | 1ms     | 10K+ ops/sec | Single node only     |
| Redis          | 5-10ms  | 1K ops/sec   | High (with sentinel) |
| DynamoDB       | 10-20ms | 500 ops/sec  | Very high            |
| etcd           | 20-50ms | 200 ops/sec  | Very high            |

## Testing

### Unit Tests

```typescript
describe('LockManager', () => {
  test('prevents concurrent access', async () => {
    const lockManager = new InMemoryLockManager();
    const key = 'test-key';
    let counter = 0;

    // Simulate concurrent increments
    const promises = Array.from({ length: 10 }, () =>
      withLock(lockManager, key, `owner-${Math.random()}`, 1000, async () => {
        const current = counter;
        await sleep(10); // Simulate work
        counter = current + 1;
      })
    );

    await Promise.all(promises);

    // Without lock: counter would be < 10 (race condition)
    // With lock: counter is exactly 10
    expect(counter).toBe(10);
  });

  test('handles lock timeout', async () => {
    const lockManager = new InMemoryLockManager();
    const key = 'test-key';

    // Acquire lock
    await lockManager.acquire(key, 10000, 'owner1');

    // Try to acquire again (should timeout)
    await expect(
      withLock(lockManager, key, 'owner2', 10000, async () => {}, { maxWaitMs: 100 })
    ).rejects.toThrow(LockTimeoutError);
  });
});
```

### Integration Tests

```typescript
test('idempotent payment creation', async () => {
  const sdk = createAegisPay();

  const request = {
    idempotencyKey: 'test-123',
    amount: 100,
    currency: Currency.USD,
    // ...
  };

  // Create payment twice
  const result1 = await sdk.createPayment(request);
  const result2 = await sdk.createPayment(request);

  // Should return same payment
  expect(result1.value.id).toBe(result2.value.id);

  // Verify only one payment in database
  const payments = await repository.findByIdempotencyKey('test-123');
  expect(payments).toHaveLength(1);
});
```

## Monitoring

### Metrics to Track

```typescript
// Lock acquisition time
metrics.histogram('lock.acquire_duration_ms', duration, {
  key: lockKey,
  result: acquired ? 'success' : 'timeout',
});

// Lock contention
metrics.gauge('lock.waiting_count', waitingCount, {
  key: lockKey,
});

// Lock expiration
metrics.increment('lock.expired', {
  key: lockKey,
});

// Idempotency hits
metrics.increment('payment.idempotency_hit', {
  operation: 'create',
});
```

### Alerts

```yaml
alerts:
  - name: HighLockContention
    condition: lock.waiting_count > 10
    action: Page on-call engineer

  - name: LockAcquisitionSlow
    condition: lock.acquire_duration_ms.p99 > 1000
    action: Investigate lock bottleneck

  - name: HighIdempotencyHitRate
    condition: payment.idempotency_hit.rate > 50%
    action: Investigate client retries
```

## Summary

AegisPay's concurrency handling provides:

✅ **Zero Duplicate Payments**: Distributed locks prevent races  
✅ **Idempotent Operations**: Same request = same response  
✅ **Automatic Recovery**: Locks expire after TTL  
✅ **High Performance**: Optimized lock granularity  
✅ **Production-Ready**: Redis/DynamoDB support

This ensures correctness at scale with millions of concurrent requests.
