# AegisPay Architecture

## Overview

AegisPay is a production-grade payment orchestration SDK designed for high-volume payment traffic with correctness, reliability, and extensibility as first-class concerns.

## Architecture Principles

### 1. Layered Architecture

```
┌─────────────────────────────────────┐
│         API Layer                   │
│    (PaymentService)                 │
├─────────────────────────────────────┤
│      Orchestration Layer            │
│  (Router, Retry, CircuitBreaker)    │
├─────────────────────────────────────┤
│       Gateway Layer                 │
│  (Gateway Interface, Registry)      │
├─────────────────────────────────────┤
│       Domain Layer                  │
│  (Payment, StateMachine, Events)    │
├─────────────────────────────────────┤
│    Infrastructure Layer             │
│  (DB, EventBus, Observability)      │
└─────────────────────────────────────┘
```

### 2. Domain-Driven Design

- **Aggregate Root**: `Payment` is the main aggregate
- **Value Objects**: `Money` for safe monetary calculations
- **Domain Events**: Capture all state changes
- **State Machine**: Enforces valid state transitions

### 3. Functional Programming

- Immutability by default
- Pure functions wherever possible
- Result types for error handling
- No shared mutable state

## Core Components

### Domain Layer

#### Payment Aggregate
The `Payment` class is an immutable aggregate root that represents a payment entity. All state changes create new instances.

**State Transitions**:
```
INITIATED → AUTHENTICATED → PROCESSING → SUCCESS | FAILURE
```

**Key Methods**:
- `authenticate()`: Move to AUTHENTICATED state
- `startProcessing()`: Move to PROCESSING state
- `markSuccess()`: Move to SUCCESS state
- `markFailure()`: Move to FAILURE state

#### State Machine
The `PaymentStateMachine` enforces valid state transitions and prevents invalid state changes.

```typescript
// Valid transitions
INITIATED → [AUTHENTICATED, FAILURE]
AUTHENTICATED → [PROCESSING, FAILURE]
PROCESSING → [SUCCESS, FAILURE]
SUCCESS → [] (terminal)
FAILURE → [] (terminal)
```

#### Domain Events
Events represent facts that have happened:
- `PaymentInitiatedEvent`
- `PaymentAuthenticatedEvent`
- `PaymentProcessingEvent`
- `PaymentSucceededEvent`
- `PaymentFailedEvent`
- `PaymentRetryAttemptedEvent`

### Gateway Layer

#### Gateway Interface
All payment gateways implement the `PaymentGateway` interface:

```typescript
interface PaymentGateway {
  initiate(payment: Payment): Promise<Result<GatewayInitiateResponse>>;
  authenticate(payment: Payment): Promise<Result<GatewayAuthResponse>>;
  process(payment: Payment): Promise<Result<GatewayProcessResponse>>;
  refund(payment: Payment): Promise<Result<GatewayRefundResponse>>;
  getStatus(txnId: string): Promise<Result<GatewayStatusResponse>>;
  healthCheck(): Promise<boolean>;
}
```

#### Gateway Registry
Manages all registered gateways and tracks their metrics:
- Success rate
- Average latency
- Request count
- Failure tracking

### Orchestration Layer

#### Payment Router
Routes payments to the best gateway based on configurable strategies:

**Strategies**:
1. **ROUND_ROBIN**: Distribute evenly
2. **LEAST_LATENCY**: Route to fastest gateway
3. **HIGHEST_SUCCESS_RATE**: Route to most reliable gateway
4. **COST_OPTIMIZED**: Route to cheapest gateway
5. **RULE_BASED**: Custom routing rules

**Routing Context**:
```typescript
{
  amount: number;
  currency: Currency;
  paymentMethod: string;
  customerCountry?: string;
  merchantId?: string;
}
```

#### Retry Policy
Implements exponential backoff with jitter:

```typescript
delay = initialDelay * (backoffMultiplier ^ attemptNumber)
delay = min(delay, maxDelay)
delay = delay + (jitter * random(-0.5, 0.5))
```

**Configuration**:
- `maxRetries`: Maximum retry attempts
- `initialDelayMs`: Starting delay
- `maxDelayMs`: Maximum delay cap
- `backoffMultiplier`: Exponential multiplier
- `jitterFactor`: Random jitter (0-1)

#### Circuit Breaker
Prevents cascading failures using the Circuit Breaker pattern:

**States**:
- **CLOSED**: Normal operation
- **OPEN**: Failing fast (circuit broken)
- **HALF_OPEN**: Testing recovery

**Transitions**:
```
CLOSED --[failures >= threshold]--> OPEN
OPEN --[timeout elapsed]--> HALF_OPEN
HALF_OPEN --[success >= threshold]--> CLOSED
HALF_OPEN --[any failure]--> OPEN
```

### Infrastructure Layer

#### PaymentRepository
Handles persistence with idempotency support:
- Find by ID
- Find by idempotency key
- Find by gateway transaction ID
- Find by customer ID
- Find by state

#### EventBus
Publishes domain events to subscribers:
- **InMemoryEventBus**: For testing
- **ConsoleEventBus**: For debugging
- **CompositeEventBus**: Multiple buses

#### Observability
- **Logger**: Structured logging with context
- **MetricsCollector**: Counters, gauges, histograms

### API Layer

#### PaymentService
Main orchestration engine that coordinates all operations:

**Key Operations**:
1. `createPayment()`: Create new payment (idempotent)
2. `processPayment()`: Execute payment flow
3. `getPayment()`: Retrieve payment
4. `getCustomerPayments()`: Get customer history

**Processing Flow**:
```
1. Select Gateway (Router)
2. Authenticate (Gateway + Circuit Breaker + Retry)
3. Initiate (Gateway + Circuit Breaker + Retry)
4. Process (Gateway + Circuit Breaker + Retry)
5. Update State
6. Emit Events
7. Record Metrics
```

## Failure Handling

### 1. Idempotency
- All create operations use idempotency keys
- Duplicate requests return the same payment
- Prevents double-charging

### 2. Retries
- Transient failures are retried automatically
- Exponential backoff prevents overload
- Jitter prevents thundering herd

### 3. Circuit Breakers
- Failing gateways are isolated
- Fast failure when gateway is down
- Automatic recovery testing

### 4. State Machine
- Invalid state transitions throw errors
- State changes are atomic
- Terminal states prevent further changes

### 5. Domain Events
- All state changes emit events
- Events are immutable facts
- Enable audit trail and replay

## Extensibility

### Adding New Gateways

```typescript
class StripeGateway implements PaymentGateway {
  // Implement interface methods
}

// Register
registry.register(GatewayType.STRIPE, new StripeGateway(config));
```

### Custom Routing Rules

```typescript
router.addRule({
  id: 'high-value-rule',
  priority: 10,
  conditions: [
    { field: 'amount', operator: 'greaterThan', value: 10000 }
  ],
  gatewayType: GatewayType.STRIPE,
  enabled: true
});
```

### Custom Event Handlers

```typescript
eventBus.subscribe('PAYMENT_SUCCEEDED', async (event) => {
  // Send email
  // Update analytics
  // Trigger fulfillment
});
```

## Performance Considerations

### 1. Connection Pooling
- Gateways should reuse HTTP connections
- Connection pools should be configured

### 2. Caching
- Gateway credentials can be cached
- Routing decisions can be cached

### 3. Async Processing
- Event publishing is non-blocking
- Metrics collection is async

### 4. Database
- Use connection pooling
- Index on idempotency keys
- Index on gateway transaction IDs

## Security Considerations

### 1. Sensitive Data
- Card details should be tokenized
- CVV should never be stored
- Use PCI-compliant encryption

### 2. Idempotency Keys
- Generate cryptographically secure keys
- Store securely with payments

### 3. API Keys
- Store gateway credentials securely
- Rotate keys regularly
- Use environment variables

### 4. Audit Trail
- Domain events provide complete audit trail
- Log all payment operations
- Track all state changes

## Monitoring & Observability

### Metrics to Track
- Payment success rate
- Payment latency (p50, p95, p99)
- Gateway success rate by provider
- Gateway latency by provider
- Circuit breaker state changes
- Retry attempts
- Idempotency hits

### Logs to Collect
- Payment created
- Payment state transitions
- Gateway requests/responses
- Retry attempts
- Circuit breaker events
- Errors with context

### Alerts to Configure
- Payment success rate drop
- Gateway success rate drop
- High payment latency
- Circuit breaker opened
- High error rate
- Idempotency conflicts
