# Functional Programming Guide

## Why Functional Programming for Payments?

Payment systems must be:

- **Correct**: No bugs that cause incorrect charges
- **Testable**: Easy to verify behavior
- **Composable**: Build complex flows from simple parts
- **Reliable**: Predictable behavior under all conditions

Functional programming (FP) gives us these properties.

## Core FP Principles in AegisPay

### 1. Pure Functions

**Definition**: Same inputs → Same outputs, no side effects

```typescript
// ❌ IMPURE: Has side effects, non-deterministic
function createPayment(amount: number): Payment {
  const id = Math.random().toString(); // Non-deterministic
  await db.save(payment); // Side effect
  await eventBus.publish(event); // Side effect
  return payment;
}

// ✅ PURE: Deterministic, no side effects
function createPayment(command: CreatePaymentCommand): Payment {
  return new Payment({
    id: command.id,
    amount: new Money(command.amount, command.currency),
    state: PaymentState.INITIATED,
    // ... all inputs are parameters
  });
}
```

**Benefits**:

- Easy to test (no mocks needed)
- Can reason about behavior
- Can cache results
- Thread-safe by default

### 2. Immutability

**Definition**: Once created, never modified

```typescript
// ❌ MUTABLE: Dangerous
class Payment {
  state: PaymentState;

  markSuccess(): void {
    this.state = PaymentState.SUCCESS; // Mutates!
  }
}

// Concurrent access:
const payment = loadPayment();
thread1: payment.markSuccess();
thread2: payment.markFailure(); // Race condition!

// ✅ IMMUTABLE: Safe
class Payment {
  readonly state: PaymentState;

  markSuccess(): Payment {
    return new Payment({
      ...this,
      state: PaymentState.SUCCESS,
    });
  }
}

// Concurrent access:
const payment = loadPayment();
const success = payment.markSuccess(); // New object
const failure = payment.markFailure(); // Different new object
// Original payment unchanged
```

**Benefits**:

- No race conditions
- Easy to track changes
- Can implement undo/redo
- Time-travel debugging

### 3. Side Effect Isolation

**Problem**: Mixed business logic and I/O

```typescript
// ❌ MIXED: Hard to test and reason about
async function processPayment(payment: Payment): Promise<Payment> {
  // Business logic
  if (payment.state !== PaymentState.AUTHENTICATED) {
    throw new Error('Invalid state');
  }

  // Side effect
  const result = await gateway.process(payment);

  // Business logic
  if (result.success) {
    payment.state = PaymentState.SUCCESS;
  }

  // Side effect
  await db.save(payment);
  await eventBus.publish(event);

  return payment;
}
```

**Solution**: IO Monad

```typescript
// ✅ SEPARATED: Business logic is pure
function processPaymentLogic(payment: Payment, adapters: Adapters): IO<Payment> {
  // Validate (pure)
  if (payment.state !== PaymentState.AUTHENTICATED) {
    return IO.of(Promise.reject(new Error('Invalid state')));
  }

  // Compose operations (pure description)
  return adapters.gateway.process(payment).flatMap((result) => {
    // Business logic (pure)
    const updated = result.success ? payment.markSuccess() : payment.markFailure(result.error);

    // Compose more operations
    return adapters.repository
      .save(updated)
      .flatMap((saved) => adapters.events.publish(event).map(() => saved));
  });
}

// Execute side effects at boundary
const io = processPaymentLogic(payment, adapters);
const result = await io.unsafeRun(); // Side effects happen here
```

## IO Monad Explained

### What is IO?

IO is a container for computations that have side effects.

```typescript
export class IO<T> {
  constructor(private readonly effect: () => Promise<T>) {}

  // Execute the side effect
  async unsafeRun(): Promise<T> {
    return this.effect();
  }
}
```

### Why IO?

**Without IO**:

```typescript
// When does this execute?
const result = await db.save(payment); // Immediately!

// Can't compose without executing
const operation1 = await db.save(payment1); // Executes
const operation2 = await db.save(payment2); // Executes
// Can't build complex flows without running them
```

**With IO**:

```typescript
// Describes the computation, doesn't execute
const operation1 = new IO(() => db.save(payment1));
const operation2 = new IO(() => db.save(payment2));

// Compose without executing
const composed = operation1.flatMap(() => operation2);

// Execute when ready
await composed.unsafeRun(); // Now they run
```

### IO Operations

#### map: Transform the result

```typescript
const io1 = new IO(() => db.getPayment('123'));

const io2 = io1.map((payment) => {
  return payment.amount.amount; // Extract amount
});

// Type: IO<Payment> → IO<number>
```

#### flatMap: Chain operations

```typescript
const io1 = new IO(() => db.getPayment('123'));

const io2 = io1.flatMap((payment) => {
  // Return another IO
  return new IO(() => gateway.process(payment));
});

// Type: IO<Payment> → IO<GatewayResponse>
```

#### chain: Execute sequentially

```typescript
const io1 = new IO(() => db.save(payment));
const io2 = new IO(() => eventBus.publish(event));

const composed = io1.chain(io2);
// Executes io1, then io2
```

### Complete Example

```typescript
function createPaymentOrchestration(
  command: CreatePaymentCommand,
  adapters: Adapters
): IO<Payment> {
  return (
    // Step 1: Check for existing payment (IO)
    adapters.repository
      .findByIdempotencyKey(command.idempotencyKey)

      // Step 2: Decide what to do (pure)
      .flatMap((existing) => {
        if (existing) {
          return IO.of(existing); // Pure: wrap in IO
        }

        // Create new payment (pure)
        const payment = createPayment(command);

        // Step 3: Save (IO)
        return (
          adapters.repository
            .save(payment)

            // Step 4: Publish event (IO)
            .flatMap((saved) => {
              const event = PaymentEventFactory.createInitiated(saved);
              return adapters.events.publish(event).map(() => saved);
            })

            // Step 5: Log (IO)
            .flatMap((saved) => {
              return adapters.logger.info('Payment created', { id: saved.id }).map(() => saved);
            })
        );
      })
  );
}

// Usage
const io = createPaymentOrchestration(command, adapters);
const payment = await io.unsafeRun(); // All side effects execute
```

## Adapters Pattern

### Problem: Testing with Side Effects

```typescript
// ❌ HARD TO TEST: Direct dependencies
class PaymentService {
  async createPayment(request: CreatePaymentRequest) {
    const payment = new Payment({ ... });

    // Hard-coded dependencies
    await database.save(payment);
    await eventBus.publish(event);
    await logger.info('Created');

    return payment;
  }
}

// Test requires mocking everything
test('createPayment', async () => {
  const mockDb = { save: jest.fn() };
  const mockEventBus = { publish: jest.fn() };
  const mockLogger = { info: jest.fn() };
  // Lots of setup...
});
```

### Solution: Dependency Injection via Adapters

```typescript
// ✅ EASY TO TEST: Injected adapters
function createPaymentOrchestration(
  command: CreatePaymentCommand,
  adapters: Adapters // Injected
): IO<Payment> {
  // Pure business logic
  const payment = createPayment(command);

  return adapters.repository
    .save(payment)
    .flatMap((saved) => adapters.events.publish(event).map(() => saved));
}

// Test with fake adapters
test('createPaymentOrchestration', async () => {
  const fakeAdapters: Adapters = {
    repository: {
      save: (p) => IO.of(p), // Fake: just return payment
    },
    events: {
      publish: (e) => IO.of(undefined), // Fake: do nothing
    },
  };

  const io = createPaymentOrchestration(command, fakeAdapters);
  const result = await io.unsafeRun();

  expect(result.state).toBe(PaymentState.INITIATED);
  // No mocks needed!
});
```

### Adapter Types

```typescript
export interface Adapters {
  repository: RepositoryAdapter;
  events: EventAdapter;
  gateway: GatewayAdapter;
  logger: LoggerAdapter;
  metrics: MetricsAdapter;
}
```

#### RepositoryAdapter

```typescript
export interface RepositoryAdapter {
  findById(id: string): IO<Payment | null>;
  save(payment: Payment): IO<Payment>;
  update(payment: Payment): IO<Payment>;
}

// Implementation
export class RepositoryAdapterImpl implements RepositoryAdapter {
  constructor(private repository: PaymentRepository) {}

  findById(id: string): IO<Payment | null> {
    return new IO(() => this.repository.findById(id));
  }
}
```

#### EventAdapter

```typescript
export interface EventAdapter {
  publish(event: PaymentEvent): IO<void>;
  publishBatch(events: PaymentEvent[]): IO<void>;
}
```

#### GatewayAdapter

```typescript
export interface GatewayAdapter {
  authenticate(payment: Payment, gateway: PaymentGateway): IO<Result<void, Error>>;
  process(payment: Payment, gateway: PaymentGateway): IO<Result<GatewayResponse, Error>>;
}
```

## Composition Examples

### Sequential Composition

```typescript
// Execute operations in order
const flow = adapters.repository
  .findById('123')
  .flatMap((payment) => adapters.gateway.process(payment, gateway))
  .flatMap((result) => adapters.repository.update(result));

await flow.unsafeRun();
```

### Parallel Composition

```typescript
// Execute operations in parallel
const io1 = adapters.repository.findById('123');
const io2 = adapters.repository.findById('456');

const combined = IO.parallel([io1, io2]);
const [payment1, payment2] = await combined.unsafeRun();
```

### Conditional Composition

```typescript
const flow = adapters.repository.findById('123').flatMap((payment) => {
  if (payment.state === PaymentState.INITIATED) {
    return processPayment(payment, adapters);
  } else {
    return IO.of(payment); // No-op
  }
});
```

### Error Handling

```typescript
const flow = adapters.repository
  .findById('123')
  .catchError((error) => {
    // Handle error, return default value
    return null;
  })
  .flatMap((payment) => {
    if (!payment) {
      throw new Error('Payment not found');
    }
    return IO.of(payment);
  });
```

## Benefits of This Approach

### 1. Testability

```typescript
// Business logic: pure function
test('createPayment creates correct domain object', () => {
  const payment = createPayment({
    amount: 100,
    currency: Currency.USD,
    // ...
  });

  expect(payment.amount.amount).toBe(100);
  expect(payment.state).toBe(PaymentState.INITIATED);
  // No mocks, no setup, deterministic
});
```

### 2. Composability

```typescript
// Build complex flows from simple parts
const authenticateStep = (payment: Payment) =>
  adapters.gateway.authenticate(payment, gateway).map(() => payment.authenticate(gatewayType));

const processStep = (payment: Payment) =>
  adapters.gateway.process(payment, gateway).map(() => payment.markSuccess());

const completeFlow = authenticateStep(payment).flatMap(processStep);
```

### 3. Type Safety

```typescript
// Compiler catches errors
const flow: IO<Payment> = adapters.repository
  .findById('123') // IO<Payment | null>
  .map((payment) => {
    // Type: Payment | null
    return payment.amount; // ERROR if payment is null
  });

// Fix with proper handling
const fixed: IO<Money> = adapters.repository.findById('123').flatMap((payment) => {
  if (!payment) {
    throw new Error('Not found');
  }
  return IO.of(payment.amount); // Type: IO<Money>
});
```

### 4. Refactoring Safety

```typescript
// Easy to refactor without breaking tests
function oldOrchestration(payment: Payment, adapters: Adapters): IO<Payment> {
  return adapters.repository
    .save(payment)
    .flatMap((saved) => adapters.events.publish(event).map(() => saved));
}

// Add logging (no tests broken)
function newOrchestration(payment: Payment, adapters: Adapters): IO<Payment> {
  return adapters.repository.save(payment).flatMap((saved) =>
    adapters.logger
      .info('Payment saved', { id: saved.id })
      .chain(adapters.events.publish(event))
      .map(() => saved)
  );
}
```

## Migration Guide

### Step 1: Identify Side Effects

```typescript
// Current code
async function processPayment(payment: Payment) {
  const result = await gateway.process(payment); // Side effect
  payment.state = PaymentState.SUCCESS; // Mutation
  await db.save(payment); // Side effect
  await events.publish(event); // Side effect
  return payment;
}
```

### Step 2: Make Domain Logic Pure

```typescript
// Pure domain logic
function markPaymentSuccess(payment: Payment): Payment {
  return payment.markSuccess(); // Immutable
}
```

### Step 3: Create Adapters

```typescript
const adapters: Adapters = {
  repository: new RepositoryAdapterImpl(db),
  events: new EventAdapterImpl(eventBus),
  gateway: new GatewayAdapterImpl(),
  logger: new LoggerAdapterImpl(logger),
  metrics: new MetricsAdapterImpl(metrics),
};
```

### Step 4: Wrap in IO

```typescript
function processPaymentIO(payment: Payment, adapters: Adapters): IO<Payment> {
  return adapters.gateway
    .process(payment, gateway)
    .map((result) => {
      // Pure logic
      return result.success ? markPaymentSuccess(payment) : payment.markFailure(result.error);
    })
    .flatMap((updated) =>
      adapters.repository
        .save(updated)
        .flatMap((saved) => adapters.events.publish(event).map(() => saved))
    );
}
```

### Step 5: Execute at Boundaries

```typescript
// API handler
async function handleProcessPayment(req: Request, res: Response) {
  const payment = await loadPayment(req.params.id);

  // Create IO
  const io = processPaymentIO(payment, adapters);

  // Execute (boundary)
  try {
    const result = await io.unsafeRun();
    res.json({ success: true, payment: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
```

## Common Patterns

### 1. Retry with IO

```typescript
function retryIO<T>(io: IO<T>, maxAttempts: number, delay: number): IO<T> {
  return new IO(async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await io.unsafeRun();
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        await sleep(delay * attempt);
      }
    }
    throw new Error('Unreachable');
  });
}
```

### 2. Timeout with IO

```typescript
function timeoutIO<T>(io: IO<T>, ms: number): IO<T> {
  return new IO(async () => {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new TimeoutError()), ms)
    );
    return Promise.race([io.unsafeRun(), timeout]);
  });
}
```

### 3. Fallback with IO

```typescript
function fallbackIO<T>(primary: IO<T>, fallback: IO<T>): IO<T> {
  return new IO(async () => {
    try {
      return await primary.unsafeRun();
    } catch (error) {
      return await fallback.unsafeRun();
    }
  });
}
```

## Summary

Functional programming in AegisPay provides:

✅ **Pure Business Logic**: Easy to understand and verify  
✅ **Testable Without Mocks**: Pure functions don't need mocking  
✅ **Composable Operations**: Build complex flows from simple parts  
✅ **Type-Safe**: Compiler catches errors  
✅ **Side Effect Isolation**: Clear separation of concerns  
✅ **Refactoring Safety**: Changes don't break tests

This approach makes the codebase maintainable and correct by construction.
