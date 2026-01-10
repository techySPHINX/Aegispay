# AegisPay

A production-grade payment orchestration SDK designed for high-volume payment traffic with **correctness, reliability, and scalability** as first-class concerns.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

## Features

### Core Correctness & Reliability

- 🔒 **Concurrency-Safe**: Distributed locking + optimistic locking prevents race conditions and lost updates
- 🎯 **Formal State Machine**: Deterministic finite automaton with mathematically proven invariants
- 🔄 **Type-Safe Transitions**: Compile-time and runtime validation of state changes
- 🛡️ **Crash Recovery**: Event sourcing ensures correctness even after process crashes
- 📦 **Exactly-Once Semantics**: Transactional outbox pattern for guaranteed event delivery
- 🔢 **Version Control**: Optimistic locking with automatic conflict resolution and retry

### Advanced Orchestration

- 🧠 **Intelligent Routing**: Real-time metrics-based gateway selection (success rate, latency, cost)
- 🔌 **Circuit Breakers**: Health tracking with CLOSED/OPEN/HALF_OPEN states for cascading failure prevention
- 🎲 **Chaos Engineering**: Built-in failure injection for resilience testing
- 🔄 **Adaptive Retry**: Exponential backoff with jitter and configurable policies
- 📊 **Health Monitoring**: Comprehensive gateway health scoring and tracking

### Integration & Extensibility

- 🌐 **Gateway Agnostic**: Pluggable payment gateway integration (Stripe, Razorpay, PayPal, etc.)
- 🧩 **Extensibility Hooks**: Plugin architecture for fraud checks, custom routing, and validation
- 📈 **Observable**: Structured logging, metrics collection, and tracing-friendly design
- 🎯 **Event-Driven**: Complete audit trail with event sourcing
- 🏗️ **Functional Design**: Pure business logic with isolated side effects for maximum testability

## 🚀 Production Reliability

AegisPay is built for mission-critical payment workloads:

### Correctness Guarantees

- **Zero Duplicate Payments**: Idempotency + distributed locking ensures at-most-once processing
- **Formal Verification**: State machine with proven invariants prevents inconsistent states
- **Linearizable Operations**: Compare-and-swap + optimistic locking ensure atomic state transitions
- **Exactly-Once Events**: Transactional outbox pattern guarantees event delivery without duplicates
- **No Lost Updates**: Version-based optimistic locking prevents race conditions

### Reliability Features

- **Crash Recovery**: Event sourcing allows state reconstruction after crashes
- **Partial Failure Handling**: Gateway verification prevents double-charging
- **Intelligent Routing**: Metrics-based gateway selection optimizes for success rate and latency
- **Circuit Breakers**: Automatic failure detection with gradual recovery (CLOSED → OPEN → HALF_OPEN)
- **Health Tracking**: Real-time gateway health scoring (0.0-1.0) based on multiple factors
- **Chaos Testing**: Built-in failure injection validates resilience before production

### Extensibility

- **Hook System**: Pre/post validation, fraud checks, custom routing, event listeners
- **Plugin Architecture**: Add custom logic without modifying core code
- **Metrics Integration**: Custom metrics collectors for monitoring platforms

**Read more**: [Production Reliability Guide](docs/PRODUCTION_RELIABILITY.md) | [Advanced Features](docs/ADVANCED_FEATURES.md)

## 📚 Documentation

### Core Concepts

- **[State Machine & Concurrency](docs/STATE_MACHINE_AND_CONCURRENCY.md)** - Formal state machine with concurrency safety proofs
- **[Transactional Outbox](docs/TRANSACTIONAL_OUTBOX.md)** - Exactly-once event delivery guarantees
- **[Advanced Features](docs/ADVANCED_FEATURES.md)** - Intelligent routing, circuit breakers, optimistic locking, chaos testing, hooks
- **[Production Reliability](docs/PRODUCTION_RELIABILITY.md)** - Comprehensive guide to scale, reliability, and correctness guarantees
- **[Concurrency & Idempotency](docs/CONCURRENCY.md)** - Deep dive into distributed locking and concurrent request handling
- **[Functional Programming](docs/FUNCTIONAL_PROGRAMMING.md)** - Pure orchestration with IO monads and adapters
- **[Architecture](docs/ARCHITECTURE.md)** - System design and component overview
- **[API Reference](docs/API.md)** - Complete API documentation
- **[Failure Scenarios](docs/FAILURE_SCENARIOS.md)** - How we handle production failures

### Quick Links

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Payment Lifecycle](#payment-lifecycle)
- [Testing](#testing)

## Why AegisPay?

### For Merchants

- **Reliability**: Built-in retry logic and circuit breakers ensure high payment success rates
- **Cost Optimization**: Intelligent routing to minimize transaction fees
- **No Vendor Lock-in**: Switch or combine payment gateways without code changes
- **Audit Trail**: Complete event history for compliance and debugging
- **No Lost Revenue**: Crash recovery ensures no payments are lost

### For Developers

- **Type Safe**: Written in TypeScript with comprehensive type definitions
- **Testable**: Pure domain logic separated from infrastructure (FP design)
- **Observable**: Built-in logging and metrics for monitoring
- **Documented**: Extensive documentation and production-tested patterns
- **No Race Conditions**: Distributed locking handles concurrent requests safely

## Architecture

AegisPay follows a clean layered architecture with functional programming principles:

```
┌─────────────────────────────────────┐
│         API Layer                   │  ← PaymentService
│    (Payment Operations)             │
├─────────────────────────────────────┤
│      Orchestration Layer            │  ← Router, Retry, CircuitBreaker
│  (Smart Routing & Fault Tolerance)  │
├─────────────────────────────────────┤
│       Gateway Layer                 │  ← Gateway Interface & Registry
│   (Payment Provider Integration)    │
├─────────────────────────────────────┤
│       Domain Layer                  │  ← Payment, StateMachine, Events
│     (Pure Business Logic)           │
├─────────────────────────────────────┤
│    Infrastructure Layer             │  ← DB, EventBus, Observability
│  (Persistence & External Services)  │
└─────────────────────────────────────┘
```

## Payment Lifecycle

```
INITIATED → AUTHENTICATED → PROCESSING → SUCCESS | FAILURE
```

All state transitions are validated and enforced. Invalid transitions fail fast.

## Installation

```bash
npm install aegispay
```

## Quick Start

```typescript
import { AegisPay, Currency, PaymentMethodType, GatewayType } from 'aegispay';

// 1. Initialize SDK
const aegisPay = new AegisPay({
  routing: {
    strategy: RoutingStrategy.HIGHEST_SUCCESS_RATE,
  },
  retry: {
    maxRetries: 3,
    initialDelayMs: 1000,
  },
});

// 2. Register payment gateways
aegisPay.registerGateway(GatewayType.MOCK, {
  apiKey: 'your_api_key',
  apiSecret: 'your_api_secret',
});

// 3. Create a payment (idempotent)
const payment = await aegisPay.createPayment({
  idempotencyKey: 'order_123_payment',
  amount: 100.0,
  currency: Currency.USD,
  paymentMethod: {
    type: PaymentMethodType.CARD,
    details: {
      cardNumber: '4242424242424242',
      expiryMonth: '12',
      expiryYear: '2025',
      cvv: '123',
      cardHolderName: 'John Doe',
    },
  },
  customer: {
    id: 'cust_123',
    email: 'john.doe@example.com',
    name: 'John Doe',
  },
});

// 4. Process the payment
const result = await aegisPay.processPayment({
  paymentId: payment.id,
});

// 5. Check result
if (result.state === PaymentState.SUCCESS) {
  console.log('Payment successful!');
} else {
  console.log('Payment failed:', result.failureReason);
}
```

## Core Concepts

### Idempotency

Prevent double-charging by using idempotency keys:

```typescript
const idempotencyKey = `order_${orderId}_${userId}`;
const payment = await aegisPay.createPayment({
  idempotencyKey,
  // ... other fields
});

// Calling again with same key returns the same payment (no duplicate charge)
const samePayment = await aegisPay.createPayment({ idempotencyKey, ... });
console.log(payment.id === samePayment.id); // true
```

### Smart Routing

Route payments intelligently based on various factors:

```typescript
// Strategy: Highest success rate
const aegisPay = new AegisPay({
  routing: { strategy: RoutingStrategy.HIGHEST_SUCCESS_RATE },
});

// Strategy: Cost optimization
const aegisPay = new AegisPay({
  routing: { strategy: RoutingStrategy.COST_OPTIMIZED },
  gatewayCosts: [
    { gatewayType: GatewayType.STRIPE, fixedFee: 0.3, percentageFee: 2.9 },
    { gatewayType: GatewayType.PAYPAL, fixedFee: 0.49, percentageFee: 3.49 },
  ],
});

// Strategy: Custom rules
const aegisPay = new AegisPay({
  routing: {
    strategy: RoutingStrategy.RULE_BASED,
    rules: [
      {
        id: 'high-value',
        priority: 10,
        conditions: [{ field: 'amount', operator: 'greaterThan', value: 1000 }],
        gatewayType: GatewayType.STRIPE,
        enabled: true,
      },
    ],
  },
});
```

### Fault Tolerance

Built-in retry logic and circuit breakers:

```typescript
// Exponential backoff retries
// 1st retry: 1s, 2nd: 2s, 3rd: 4s (with jitter)

// Circuit breaker automatically isolates failing gateways
// After 5 failures → Circuit OPEN (fail fast)
// After 60s → Circuit HALF_OPEN (test recovery)
// Success → Circuit CLOSED (normal operation)
```

### Event-Driven

Subscribe to payment lifecycle events:

```typescript
eventBus.subscribe('PAYMENT_SUCCEEDED', async (event) => {
  // Send confirmation email
  // Update inventory
  // Trigger fulfillment
  console.log('Payment succeeded:', event.payload);
});
```

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md) - Deep dive into system design
- [API Reference](docs/API.md) - Complete API documentation
- [Failure Scenarios](docs/FAILURE_SCENARIOS.md) - How failures are handled

## Running the Example

```bash
# Install dependencies
npm install

# Build the SDK
npm run build

# Run the example
npm run dev
```

Or run directly:

```bash
# Install dependencies
npm install

# Run example with ts-node
npx ts-node src/example.ts
```

## Features in Detail

### State Machine

Strict state transitions prevent invalid payment states:

```typescript
// Valid transitions
payment.authenticate(); // INITIATED → AUTHENTICATED
payment.startProcessing(); // AUTHENTICATED → PROCESSING
payment.markSuccess(); // PROCESSING → SUCCESS
payment.markFailure(); // PROCESSING → FAILURE

// Invalid transition throws error
payment.markSuccess(); // INITIATED → SUCCESS ❌ Error!
```

### Gateway Registry

Manage multiple payment gateways:

```typescript
// Register gateways
registry.register(GatewayType.STRIPE, stripeGateway);
registry.register(GatewayType.RAZORPAY, razorpayGateway);

// Track metrics
const metrics = registry.getMetrics(GatewayType.STRIPE);
console.log(metrics.successRate); // 98.5%
console.log(metrics.averageLatency); // 245ms
```

### Observability

Built-in logging and metrics:

```typescript
// Structured logging
logger.info('Payment created', {
  paymentId: payment.id,
  amount: payment.amount,
  duration: 150,
});

// Metrics collection
metrics.increment('payment.created');
metrics.histogram('payment.latency', duration);

// Get metrics
const snapshot = metrics.getMetrics();
console.log(snapshot.counters['payment.created']); // 1523
```

## Extending AegisPay

### Adding New Gateways

```typescript
class StripeGateway implements PaymentGateway {
  async initiate(payment: Payment) {
    /* ... */
  }
  async authenticate(payment: Payment) {
    /* ... */
  }
  async process(payment: Payment) {
    /* ... */
  }
  async refund(payment: Payment) {
    /* ... */
  }
  async getStatus(txnId: string) {
    /* ... */
  }
  async healthCheck() {
    /* ... */
  }
}

// Register
aegisPay.registerGateway(GatewayType.STRIPE, new StripeGateway(config));
```

### Custom Fraud Checks

```typescript
eventBus.subscribe('PAYMENT_INITIATED', async (event) => {
  const fraudScore = await myFraudService.check(event.payload);
  if (fraudScore > 0.8) {
    // Block payment
    await blockPayment(event.payload.paymentId);
  }
});
```

## Project Structure

```
aegispay/
├── src/
│   ├── domain/              # Pure business logic
│   │   ├── payment.ts       # Payment aggregate
│   │   ├── types.ts         # Domain types
│   │   ├── paymentStateMachine.ts
│   │   └── events.ts        # Domain events
│   ├── orchestration/       # Routing & resilience
│   │   ├── router.ts        # Payment router
│   │   ├── retryPolicy.ts   # Retry logic
│   │   └── circuitBreaker.ts
│   ├── gateways/            # Gateway integration
│   │   ├── gateway.ts       # Gateway interface
│   │   ├── mockGateway.ts   # Mock implementation
│   │   └── registry.ts      # Gateway registry
│   ├── infra/               # Infrastructure
│   │   ├── db.ts            # Payment repository
│   │   ├── eventBus.ts      # Event bus
│   │   └── observability.ts # Logging & metrics
│   ├── api/                 # Public API
│   │   └── paymentService.ts
│   ├── config/              # Configuration
│   │   └── config.ts
│   ├── index.ts             # Main entry point
│   └── example.ts           # Usage example
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── FAILURE_SCENARIOS.md
├── package.json
├── tsconfig.json
└── README.md
```

## Contributing

Contributions are welcome! Please read our contributing guidelines first.

## License

MIT

## Acknowledgments

Inspired by production payment systems like Juspay and Hyperswitch.
