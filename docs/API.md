# API Documentation

## Installation

```bash
npm install aegispay
```

## Quick Start

```typescript
import { AegisPay, Currency, PaymentMethodType, GatewayType } from 'aegispay';

// Initialize SDK
const aegisPay = new AegisPay({
  routing: {
    strategy: RoutingStrategy.HIGHEST_SUCCESS_RATE
  }
});

// Register gateway
aegisPay.registerGateway(GatewayType.MOCK, {
  apiKey: 'your_api_key',
  apiSecret: 'your_api_secret'
});

// Create payment
const payment = await aegisPay.createPayment({
  idempotencyKey: 'unique_key_123',
  amount: 100.00,
  currency: Currency.USD,
  paymentMethod: {
    type: PaymentMethodType.CARD,
    details: {
      cardNumber: '4242424242424242',
      expiryMonth: '12',
      expiryYear: '2025',
      cvv: '123',
      cardHolderName: 'John Doe'
    }
  },
  customer: {
    id: 'cust_123',
    email: 'john@example.com'
  }
});

// Process payment
const result = await aegisPay.processPayment({
  paymentId: payment.id
});
```

## API Reference

### AegisPay Class

#### Constructor

```typescript
new AegisPay(config?: Partial<AegisPayConfig>)
```

**Configuration Options**:

```typescript
interface AegisPayConfig {
  routing?: {
    strategy?: RoutingStrategy;
    rules?: RoutingRule[];
  };
  gatewayCosts?: GatewayCost[];
  retry?: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    jitterFactor?: number;
  };
  circuitBreaker?: {
    failureThreshold?: number;
    successThreshold?: number;
    timeout?: number;
    monitoringPeriod?: number;
  };
  logging?: {
    level?: LogLevel;
    enabled?: boolean;
  };
  metrics?: {
    enabled?: boolean;
  };
  events?: {
    enabled?: boolean;
    logToConsole?: boolean;
  };
}
```

#### Methods

##### registerGateway()

```typescript
registerGateway(gatewayType: GatewayType, config: GatewayConfig): void
```

Register a payment gateway.

**Parameters**:
- `gatewayType`: Gateway type (STRIPE, RAZORPAY, PAYPAL, etc.)
- `config`: Gateway configuration including API keys

**Example**:
```typescript
aegisPay.registerGateway(GatewayType.STRIPE, {
  apiKey: 'sk_test_...',
  apiSecret: 'secret_...'
});
```

##### createPayment()

```typescript
async createPayment(request: CreatePaymentRequest): Promise<Payment>
```

Create a new payment. This operation is idempotent using the `idempotencyKey`.

**Parameters**:
```typescript
interface CreatePaymentRequest {
  idempotencyKey: string;
  amount: number;
  currency: Currency;
  paymentMethod: PaymentMethod;
  customer: Customer;
  metadata?: Record<string, unknown>;
}
```

**Returns**: `Promise<Payment>`

**Throws**: Error if payment creation fails

**Example**:
```typescript
const payment = await aegisPay.createPayment({
  idempotencyKey: 'order_123_payment',
  amount: 99.99,
  currency: Currency.USD,
  paymentMethod: {
    type: PaymentMethodType.CARD,
    details: {
      cardNumber: '4242424242424242',
      expiryMonth: '12',
      expiryYear: '2025',
      cvv: '123',
      cardHolderName: 'John Doe'
    }
  },
  customer: {
    id: 'cust_123',
    email: 'john@example.com',
    name: 'John Doe'
  },
  metadata: {
    orderId: 'order_123'
  }
});
```

##### processPayment()

```typescript
async processPayment(request: ProcessPaymentRequest): Promise<Payment>
```

Process a payment through the complete payment flow.

**Parameters**:
```typescript
interface ProcessPaymentRequest {
  paymentId: string;
  gatewayType?: GatewayType; // Optional, router will select if not provided
}
```

**Returns**: `Promise<Payment>`

**Throws**: Error if payment processing fails

**Example**:
```typescript
const processedPayment = await aegisPay.processPayment({
  paymentId: payment.id
});

console.log(processedPayment.state); // 'SUCCESS' or 'FAILURE'
```

##### getPayment()

```typescript
async getPayment(paymentId: string): Promise<Payment | null>
```

Retrieve a payment by ID.

**Example**:
```typescript
const payment = await aegisPay.getPayment('pay_123');
```

##### getPaymentByIdempotencyKey()

```typescript
async getPaymentByIdempotencyKey(idempotencyKey: string): Promise<Payment | null>
```

Retrieve a payment by idempotency key.

**Example**:
```typescript
const payment = await aegisPay.getPaymentByIdempotencyKey('order_123_payment');
```

##### getCustomerPayments()

```typescript
async getCustomerPayments(customerId: string, limit?: number): Promise<Payment[]>
```

Get all payments for a customer.

**Example**:
```typescript
const payments = await aegisPay.getCustomerPayments('cust_123', 10);
```

##### getGatewayMetrics()

```typescript
getGatewayMetrics(gatewayType?: GatewayType): GatewayMetrics | GatewayMetrics[]
```

Get metrics for a specific gateway or all gateways.

**Example**:
```typescript
const metrics = aegisPay.getGatewayMetrics(GatewayType.STRIPE);
console.log(metrics.successRate);
```

##### getMetrics()

```typescript
getMetrics(): MetricsSnapshot
```

Get SDK-wide metrics.

**Example**:
```typescript
const metrics = aegisPay.getMetrics();
console.log(metrics.counters['payment.created']);
```

##### getHealthSummary()

```typescript
getHealthSummary(): { totalGateways: number; healthyGateways: number; unhealthyGateways: number }
```

Get gateway health summary.

**Example**:
```typescript
const health = aegisPay.getHealthSummary();
console.log(`${health.healthyGateways}/${health.totalGateways} gateways healthy`);
```

## Types

### Payment

```typescript
class Payment {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly state: PaymentState;
  readonly amount: Money;
  readonly paymentMethod: PaymentMethod;
  readonly customer: Customer;
  readonly metadata: PaymentMetadata;
  readonly gatewayType?: GatewayType;
  readonly gatewayTransactionId?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly failureReason?: string;
  readonly retryCount: number;
}
```

### PaymentState

```typescript
enum PaymentState {
  INITIATED = 'INITIATED',
  AUTHENTICATED = 'AUTHENTICATED',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE'
}
```

### Currency

```typescript
enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  INR = 'INR',
  AUD = 'AUD',
  CAD = 'CAD'
}
```

### PaymentMethodType

```typescript
enum PaymentMethodType {
  CARD = 'CARD',
  UPI = 'UPI',
  NET_BANKING = 'NET_BANKING',
  WALLET = 'WALLET',
  PAY_LATER = 'PAY_LATER'
}
```

### RoutingStrategy

```typescript
enum RoutingStrategy {
  ROUND_ROBIN = 'ROUND_ROBIN',
  LEAST_LATENCY = 'LEAST_LATENCY',
  HIGHEST_SUCCESS_RATE = 'HIGHEST_SUCCESS_RATE',
  COST_OPTIMIZED = 'COST_OPTIMIZED',
  RULE_BASED = 'RULE_BASED'
}
```

## Advanced Usage

### Custom Routing Rules

```typescript
const aegisPay = new AegisPay({
  routing: {
    strategy: RoutingStrategy.RULE_BASED,
    rules: [
      {
        id: 'high-value-stripe',
        priority: 10,
        conditions: [
          { field: 'amount', operator: 'greaterThan', value: 1000 }
        ],
        gatewayType: GatewayType.STRIPE,
        enabled: true
      },
      {
        id: 'india-razorpay',
        priority: 9,
        conditions: [
          { field: 'customerCountry', operator: 'equals', value: 'IN' }
        ],
        gatewayType: GatewayType.RAZORPAY,
        enabled: true
      }
    ]
  }
});
```

### Cost-Optimized Routing

```typescript
const aegisPay = new AegisPay({
  routing: {
    strategy: RoutingStrategy.COST_OPTIMIZED
  },
  gatewayCosts: [
    {
      gatewayType: GatewayType.STRIPE,
      fixedFee: 0.30,
      percentageFee: 2.9,
      currency: Currency.USD
    },
    {
      gatewayType: GatewayType.PAYPAL,
      fixedFee: 0.49,
      percentageFee: 3.49,
      currency: Currency.USD
    }
  ]
});
```

### Error Handling

```typescript
try {
  const payment = await aegisPay.createPayment(request);
  const processed = await aegisPay.processPayment({ paymentId: payment.id });
  
  if (processed.state === PaymentState.SUCCESS) {
    console.log('Payment successful!');
  } else {
    console.log('Payment failed:', processed.failureReason);
  }
} catch (error) {
  console.error('Error processing payment:', error.message);
  // Handle error appropriately
}
```

### Idempotency

Always use unique idempotency keys to prevent duplicate charges:

```typescript
// Generate idempotency key from order/user context
const idempotencyKey = `order_${orderId}_${userId}_${timestamp}`;

const payment = await aegisPay.createPayment({
  idempotencyKey,
  // ... other fields
});

// Calling again with same key returns the same payment
const samePayment = await aegisPay.createPayment({
  idempotencyKey,
  // ... other fields
});

console.log(payment.id === samePayment.id); // true
```

## Best Practices

1. **Always use idempotency keys** to prevent double-charging
2. **Handle both success and failure states** in your application
3. **Monitor gateway metrics** to detect issues early
4. **Use appropriate routing strategies** for your use case
5. **Configure retries appropriately** for your traffic patterns
6. **Log payment operations** for audit and debugging
7. **Never store CVV** or sensitive card data
8. **Use test mode** in development environments
