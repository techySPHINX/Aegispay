# AegisPay Production Deployment Guide

## 🚀 Production-Ready Features

AegisPay SDK is now **production-ready** with comprehensive features for enterprise payment processing:

### ✅ Core Production Features

- **Input Validation**: Comprehensive validation for all user inputs with detailed error messages
- **Idempotency**: Prevent duplicate charges with idempotency keys
- **Concurrency Control**: Distributed locking prevents race conditions
- **Error Handling**: Graceful degradation with detailed logging
- **Retry Logic**: Exponential backoff with configurable policies
- **Circuit Breakers**: Automatic failure detection and recovery
- **Observability**: Structured logging, metrics, and tracing
- **Event Sourcing**: Complete audit trail of all state changes
- **Type Safety**: Full TypeScript support with comprehensive types

### 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                   AegisPay SDK                      │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │   Validation │  │ Idempotency  │  │   Locks   │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │Circuit Breaker│ │    Retry     │  │  Routing  │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Observability│  │Event Sourcing│  │  Gateway  │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────┘
```

## 📦 Installation

```bash
npm install aegispay
# or
yarn add aegispay
# or
pnpm add aegispay
```

## 🔧 Configuration

### Basic Setup

```typescript
import { AegisPay, GatewayType, Currency, PaymentMethodType } from 'aegispay';

const aegis = new AegisPay({
  logging: {
    level: 'INFO', // DEBUG, INFO, WARN, ERROR
  },
  retry: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
  },
  routing: {
    strategy: 'intelligent', // cost-optimized, latency-optimized, intelligent
  },
  events: {
    logToConsole: true,
  },
});
```

### Register Payment Gateways

```typescript
// Register gateways (currently supports Mock for testing)
aegis.registerGateway(GatewayType.MOCK, {
  apiKey: 'your-api-key',
  environment: 'production',
  timeout: 30000,
});

// In production, register real gateways:
// aegis.registerGateway(GatewayType.STRIPE, { ... });
// aegis.registerGateway(GatewayType.PAYPAL, { ... });
```

## 💳 Processing Payments

### Create and Process Payment

```typescript
import { Currency, PaymentMethodType } from 'aegispay';

async function processPayment() {
  try {
    // Step 1: Create payment with idempotency
    const payment = await aegis.createPayment({
      idempotencyKey: `order_${orderId}_${Date.now()}`, // Unique key
      amount: 99.99,
      currency: Currency.USD,
      customer: {
        id: 'cust_123',
        email: 'customer@example.com',
        name: 'John Doe',
      },
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242', // In production, use tokenized cards
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'John Doe',
        },
      },
      metadata: {
        orderId: 'order_123',
        customField: 'value',
      },
    });

    console.log('Payment created:', payment.id);

    // Step 2: Process payment
    const processedPayment = await aegis.processPayment({
      paymentId: payment.id,
      // gatewayType: GatewayType.STRIPE, // Optional: let router decide
    });

    console.log('Payment processed:', processedPayment.state);
    return processedPayment;
  } catch (error) {
    console.error('Payment failed:', error);
    throw error;
  }
}
```

## 🛡️ Production Best Practices

### 1. Idempotency Keys

Always use unique, deterministic idempotency keys to prevent duplicate charges:

```typescript
// ✅ GOOD: Deterministic and unique
const idempotencyKey = `order_${orderId}_attempt_${attemptNumber}`;

// ❌ BAD: Random keys don't prevent duplicates
const idempotencyKey = `random_${Math.random()}`;
```

### 2. Input Validation

The SDK automatically validates all inputs, but you should also validate at your application layer:

```typescript
// SDK will reject invalid inputs:
// - Negative amounts
// - Invalid currency codes
// - Malformed email addresses
// - Missing required fields
```

### 3. Error Handling

Handle errors gracefully with proper retry logic:

```typescript
async function retryablePayment(paymentData: CreatePaymentRequest) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await aegis.createPayment({
        ...paymentData,
        idempotencyKey: `${paymentData.idempotencyKey}_attempt_${attempt}`,
      });
    } catch (error) {
      lastError = error;
      console.warn(`Payment attempt ${attempt} failed:`, error);

      if (attempt < 3) {
        await sleep(1000 * attempt); // Exponential backoff
      }
    }
  }

  throw lastError;
}
```

### 4. Monitoring and Observability

Monitor payment health using built-in metrics:

```typescript
// Get gateway health
const health = aegis.getHealthSummary();
console.log('Gateway health:', health);

// Get metrics
const metrics = aegis.getMetrics();
console.log('Payment metrics:', metrics);

// Get specific gateway metrics
const stripeMetrics = aegis.getGatewayMetrics(GatewayType.STRIPE);
console.log('Stripe metrics:', stripeMetrics);
```

## 🔒 Security Considerations

### 1. Sensitive Data

**Never store sensitive payment data in plain text:**

```typescript
// ✅ GOOD: Use tokenized cards from gateway
const payment = await aegis.createPayment({
  paymentMethod: {
    type: PaymentMethodType.CARD,
    details: {
      cardNumber: 'tok_visa', // Stripe token
      // ...
    },
  },
});

// ❌ BAD: Never store raw CVV
// CVV should never be stored anywhere
```

### 2. API Keys

Store API keys securely using environment variables:

```typescript
const aegis = new AegisPay({
  // Configuration loaded from environment
});

aegis.registerGateway(GatewayType.STRIPE, {
  apiKey: process.env.STRIPE_SECRET_KEY, // From environment
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
});
```

### 3. Input Sanitization

The SDK automatically sanitizes metadata to prevent injection attacks:

```typescript
// Metadata is automatically sanitized:
// - Keys limited to alphanumeric + underscore
// - Values limited to primitives (string, number, boolean)
// - String length limited to 1000 characters
// - Key length limited to 128 characters
```

## 📊 Performance Optimization

### 1. Gateway Routing

Use intelligent routing to optimize for cost, latency, or success rate:

```typescript
const aegis = new AegisPay({
  routing: {
    strategy: 'intelligent', // Automatically balances cost, latency, success rate
    rules: [
      {
        condition: (payment) => payment.amount.amount > 1000,
        gatewayType: GatewayType.STRIPE, // High-value payments to premium gateway
        priority: 100,
      },
    ],
  },
});
```

### 2. Circuit Breakers

Automatic circuit breakers prevent cascading failures:

```typescript
// Circuit breaker configuration (applied per gateway)
{
  circuitBreaker: {
    failureThreshold: 5,     // Open circuit after 5 failures
    resetTimeoutMs: 60000,   // Try again after 1 minute
    monitorWindowMs: 120000, // Monitor last 2 minutes
  }
}
```

### 3. Connection Pooling

For production deployments, consider connection pooling:

```typescript
// Implement custom repository with connection pooling
import { PaymentRepository } from 'aegispay';

class PostgresPaymentRepository implements PaymentRepository {
  // Use pg-pool or similar for connection pooling
  // ...
}
```

## 🧪 Testing

### Unit Tests

```typescript
import { AegisPay, GatewayType, Currency } from 'aegispay';

describe('Payment Processing', () => {
  let aegis: AegisPay;

  beforeEach(() => {
    aegis = new AegisPay();
    aegis.registerGateway(GatewayType.MOCK, {
      apiKey: 'test-key',
      environment: 'sandbox',
    });
  });

  it('should create and process payment', async () => {
    const payment = await aegis.createPayment({
      idempotencyKey: `test_${Date.now()}`,
      amount: 100,
      currency: Currency.USD,
      customer: {
        id: 'test_customer',
        email: 'test@example.com',
      },
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'Test User',
        },
      },
    });

    expect(payment.id).toBeDefined();
    expect(payment.state).toBe(PaymentState.INITIATED);
  });
});
```

## 📈 Scaling to Production

### 1. Database

Replace in-memory repository with production database:

```typescript
// Example: PostgreSQL repository
import { Pool } from 'pg';
import { PaymentRepository, Payment } from 'aegispay';

class PostgresPaymentRepository implements PaymentRepository {
  constructor(private pool: Pool) {}

  async save(payment: Payment): Promise<Payment> {
    const query = `
      INSERT INTO payments (id, idempotency_key, state, amount, currency, ...)
      VALUES ($1, $2, $3, $4, $5, ...)
      RETURNING *
    `;
    const result = await this.pool.query(query, [
      payment.id,
      payment.idempotencyKey,
      payment.state,
      payment.amount.amount,
      payment.amount.currency,
      // ...
    ]);
    return Payment.fromJSON(result.rows[0]);
  }

  // Implement other methods...
}
```

### 2. Distributed Locks

Use Redis for distributed locking:

```typescript
import { LockManager } from 'aegispay';
import Redis from 'ioredis';

class RedisLockManager implements LockManager {
  constructor(private redis: Redis) {}

  async acquireLock(key: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(`lock:${key}`, ownerId, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  // Implement other methods...
}

// Use with PaymentService
const lockManager = new RedisLockManager(redisClient);
const paymentService = new PaymentService(
  repository,
  eventBus,
  gatewayRegistry,
  router,
  retryPolicy,
  logger,
  metrics,
  lockManager // Pass custom lock manager
);
```

### 3. Event Bus

Use message queue for event processing:

```typescript
import { EventBus, DomainEvent } from 'aegispay';
import { Queue } from 'bull';

class RabbitMQEventBus implements EventBus {
  constructor(private queue: Queue) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.queue.add('payment-event', event);
  }

  subscribe(handler: (event: DomainEvent) => Promise<void>): void {
    this.queue.process('payment-event', async (job) => {
      await handler(job.data);
    });
  }
}
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Payment Stuck in INITIATED State

**Cause**: Gateway timeout or network issue

**Solution**:

```typescript
// Check payment state
const payment = await aegis.getPayment(paymentId);
if (payment.state === PaymentState.INITIATED) {
  // Retry processing
  await aegis.processPayment({ paymentId });
}
```

#### 2. Duplicate Charges

**Cause**: Missing or incorrect idempotency key

**Solution**:

```typescript
// Always use deterministic idempotency keys
const idempotencyKey = `order_${orderId}`;

// SDK prevents duplicates automatically
const payment1 = await aegis.createPayment({ idempotencyKey, ... });
const payment2 = await aegis.createPayment({ idempotencyKey, ... });
// payment1.id === payment2.id (same payment returned)
```

#### 3. Gateway Errors

**Cause**: Invalid gateway configuration or API keys

**Solution**:

```typescript
// Check gateway health
const health = aegis.getHealthSummary();
console.log(health);

// Verify API keys are correct
// Check gateway environment (sandbox vs production)
```

## 📚 Additional Resources

- [API Documentation](./docs/API.md)
- [Architecture Guide](./docs/ARCHITECTURE.md)
- [State Machine](./docs/STATE_MACHINE_AND_CONCURRENCY.md)
- [Observability](./docs/PRODUCTION_RELIABILITY.md)
- [Advanced Features](./docs/ADVANCED_FEATURES.md)

## 🆘 Support

For issues, questions, or feature requests:

- Create an issue on GitHub
- Check existing documentation
- Review example code in `/src/examples`

## 📄 License

MIT License - See LICENSE file for details
