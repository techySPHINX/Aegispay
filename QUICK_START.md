# 🚀 Quick Start: Adding Your First Real Test

This guide shows you how to add your first real test to AegisPay.

## Step 1: Study Your API

First, look at your existing code to understand the API:

```typescript
// From src/domain/types.ts - Check what types you have
export enum PaymentState {
  INITIATED = 'INITIATED',
  AUTHENTICATED = 'AUTHENTICATED',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

// From src/domain/payment.ts - Check Payment class
export class Payment {
  constructor(params: {
    id: string;
    idempotencyKey: string;
    state: PaymentState;
    amount: Money;
    paymentMethod: PaymentMethod;
    customer: Customer;
    // ... other params
  }) {
    // ...
  }
}
```

## Step 2: Create Your First Unit Test

Create `tests/unit/types.test.ts`:

```typescript
/**
 * Unit Tests: Domain Types
 * Tests the basic type system of AegisPay
 */

import { PaymentState, ok, fail } from '../../src/domain/types';

describe('Domain Types', () => {
  describe('PaymentState', () => {
    it('should have all required states', () => {
      expect(PaymentState.INITIATED).toBe('INITIATED');
      expect(PaymentState.AUTHENTICATED).toBe('AUTHENTICATED');
      expect(PaymentState.PROCESSING).toBe('PROCESSING');
      expect(PaymentState.SUCCESS).toBe('SUCCESS');
      expect(PaymentState.FAILURE).toBe('FAILURE');
    });
  });

  describe('Result Type', () => {
    it('should create success result', () => {
      const result = ok({ value: 42 });
      expect(result.isOk()).toBe(true);
      expect(result.isErr()).toBe(false);
    });

    it('should create error result', () => {
      const result = fail(new Error('Test error'));
      expect(result.isOk()).toBe(false);
      expect(result.isErr()).toBe(true);
    });
  });
});
```

## Step 3: Run Your Test

```bash
pnpm test
```

Expected output:

```
Test Suites: 2 passed, 2 total
Tests:       14 passed, 14 total
```

## Step 4: Add More Tests Gradually

### Example: Test Payment State Machine

Create `tests/unit/stateMachine.test.ts`:

```typescript
import { PaymentStateMachine } from '../../src/domain/paymentStateMachine';
import { PaymentState } from '../../src/domain/types';

describe('Payment State Machine', () => {
  describe('State Transitions', () => {
    it('should validate INITIATED -> AUTHENTICATED transition', () => {
      const isValid = PaymentStateMachine.isValidTransition(
        PaymentState.INITIATED,
        PaymentState.AUTHENTICATED
      );
      expect(isValid).toBe(true);
    });

    it('should reject invalid transitions', () => {
      const isValid = PaymentStateMachine.isValidTransition(
        PaymentState.INITIATED,
        PaymentState.SUCCESS
      );
      expect(isValid).toBe(false);
    });

    it('should reject transitions from terminal states', () => {
      const isValid = PaymentStateMachine.isValidTransition(
        PaymentState.SUCCESS,
        PaymentState.PROCESSING
      );
      expect(isValid).toBe(false);
    });
  });
});
```

## Step 5: Check Coverage

```bash
pnpm run test:coverage
```

Open `coverage/lcov-report/index.html` to see detailed coverage report.

## Step 6: Commit Your Progress

```bash
git add tests/unit/types.test.ts
git commit -m "Add domain types unit tests"

git add tests/unit/stateMachine.test.ts
git commit -m "Add state machine unit tests"
```

## Step 7: Create Integration Test

Create `tests/integration/payment.integration.test.ts`:

```typescript
import { Payment } from '../../src/domain/payment';
import { PaymentState } from '../../src/domain/types';
import { PaymentStateMachine } from '../../src/domain/paymentStateMachine';

describe('Payment Integration', () => {
  it('should create and transition payment through states', () => {
    // Create a payment
    const payment = new Payment({
      id: 'pay_test_123',
      idempotencyKey: 'key_test_123',
      state: PaymentState.INITIATED,
      amount: { value: 10000, currency: 'USD' },
      paymentMethod: {
        type: 'CARD',
        card: {
          last4: '4242',
          brand: 'VISA',
        },
      },
      customer: {
        id: 'cust_123',
        email: 'test@example.com',
      },
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      retryCount: 0,
    });

    // Verify initial state
    expect(payment.state).toBe(PaymentState.INITIATED);

    // Check valid transition
    expect(PaymentStateMachine.isValidTransition(payment.state, PaymentState.AUTHENTICATED)).toBe(
      true
    );
  });
});
```

## Step 8: Create Simple Benchmark

Create `src/benchmark/simple.ts`:

```typescript
import { performance } from 'perf_hooks';

interface BenchmarkResult {
  totalOperations: number;
  duration: number;
  opsPerSecond: number;
}

/**
 * Simple benchmark to test state machine performance
 */
async function benchmarkStateMachine(): Promise<BenchmarkResult> {
  const { PaymentStateMachine } = await import('../domain/paymentStateMachine');
  const { PaymentState } = await import('../domain/types');

  console.log('🚀 Benchmarking State Machine...\n');

  const startTime = performance.now();
  const testDuration = 5000; // 5 seconds
  let operationCount = 0;

  const endTime = startTime + testDuration;

  // Perform state transition checks as fast as possible
  while (performance.now() < endTime) {
    PaymentStateMachine.isValidTransition(PaymentState.INITIATED, PaymentState.AUTHENTICATED);
    PaymentStateMachine.isValidTransition(PaymentState.AUTHENTICATED, PaymentState.PROCESSING);
    PaymentStateMachine.isValidTransition(PaymentState.PROCESSING, PaymentState.SUCCESS);
    operationCount += 3;
  }

  const duration = (performance.now() - startTime) / 1000;
  const opsPerSecond = operationCount / duration;

  return {
    totalOperations: operationCount,
    duration,
    opsPerSecond,
  };
}

// Run benchmark
async function main() {
  const result = await benchmarkStateMachine();

  console.log('✅ Results:');
  console.log(`   Operations: ${result.totalOperations.toLocaleString()}`);
  console.log(`   Duration: ${result.duration.toFixed(2)}s`);
  console.log(`   Ops/sec: ${Math.round(result.opsPerSecond).toLocaleString()}`);
  console.log(`   Status: ${result.opsPerSecond >= 1000000 ? '✅ PASSED' : '⚠️ REVIEW'}`);
}

main().catch(console.error);
```

Run it:

```bash
npx ts-node src/benchmark/simple.ts
```

## Step 9: Validate Everything

```bash
# Run all tests
pnpm test

# Check coverage
pnpm run test:coverage

# Run linting
pnpm run lint

# Type check
pnpm run typecheck

# Run benchmark
npx ts-node src/benchmark/simple.ts
```

## Step 10: Push to GitHub

```bash
# Add all changes
git add .

# Commit
git commit -m "Add initial tests and benchmarks"

# Push
git push
```

GitHub Actions will automatically:

1. Run all tests ✅
2. Check code quality ✅
3. Build on multiple platforms ✅
4. Generate reports ✅

## 📊 Progress Tracking

Use this checklist to track your progress:

### Unit Tests

- [x] Smoke tests (11 tests)
- [ ] Domain types tests
- [ ] State machine tests
- [ ] Payment entity tests
- [ ] Event tests
- [ ] Gateway tests

### Integration Tests

- [ ] Payment service tests
- [ ] Event bus tests
- [ ] Repository tests
- [ ] Circuit breaker tests

### E2E Tests

- [ ] Complete payment flow
- [ ] Error recovery
- [ ] Concurrent operations

### Benchmarks

- [ ] State machine performance
- [ ] Event bus throughput
- [ ] Payment processing TPS
- [ ] Latency measurements

## 🎯 Goals

- **Week 1**: 20+ unit tests, 50% coverage
- **Week 2**: Integration tests, 70% coverage
- **Week 3**: E2E tests, 80% coverage
- **Week 4**: Benchmarks, full validation

## 💡 Tips

1. **Start Small**: One test file at a time
2. **Test What You Know**: Use your examples folder as reference
3. **Run Often**: `pnpm run test:watch` for instant feedback
4. **Commit Often**: Small, frequent commits
5. **Check Coverage**: See what needs testing

## 🆘 Stuck?

**Can't figure out the API?**

- Look at `src/examples/` folder
- Check the TypeScript types
- Read existing code

**Tests failing?**

- Check import paths
- Verify type definitions
- Run `pnpm run typecheck`

**Coverage too low?**

- Run `pnpm run test:coverage`
- Open `coverage/lcov-report/index.html`
- See what's not covered

## 🎉 Success!

Once you have:

- ✅ Tests passing
- ✅ Coverage > 80%
- ✅ Benchmarks running
- ✅ CI passing on GitHub

You're done! Your SDK is production-ready with proof! 🚀

---

**Next**: Read [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md) for more detailed guidance!
