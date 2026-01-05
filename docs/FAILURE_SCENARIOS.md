# Failure Scenarios and Handling

This document describes how AegisPay handles various failure scenarios to ensure correctness and reliability.

## 1. Network Failures

### Scenario
Network timeout or connection error when communicating with payment gateway.

### How AegisPay Handles It

**Detection**:
- Gateway throws `GatewayError` with code `NETWORK_ERROR` or `TIMEOUT`
- Error is marked as retryable

**Recovery**:
1. **Retry Policy** kicks in with exponential backoff
2. Waits: 1s → 2s → 4s (with jitter)
3. Maximum 3 retries by default
4. If all retries fail, payment marked as FAILURE

**Circuit Breaker**:
- Multiple network failures open circuit breaker
- Future requests fail fast for 60 seconds
- After timeout, circuit moves to HALF_OPEN
- Test request to check if service recovered

**Code Path**:
```typescript
// RetryPolicy catches retryable errors
await retryPolicy.executeWithRetry(
  () => gateway.process(payment),
  (error) => error instanceof GatewayError && error.shouldRetry()
);

// CircuitBreaker wraps gateway calls
await circuitBreaker.execute(() => gateway.process(payment));
```

**Observability**:
- Logs: "Gateway network error, retrying..."
- Metrics: `payment.retry_attempted`, `gateway.network_error`
- Events: `PaymentRetryAttemptedEvent`

---

## 2. Gateway Downtime

### Scenario
Payment gateway is completely down or returning 5xx errors.

### How AegisPay Handles It

**Detection**:
- Multiple consecutive failures
- Circuit breaker failure threshold reached (5 failures)

**Recovery**:
1. **Circuit Breaker Opens**
   - All future requests fail immediately
   - No load on failing gateway
   
2. **Automatic Recovery Test**
   - After 60 seconds, circuit moves to HALF_OPEN
   - Next request is a test request
   - Success closes circuit, failure re-opens

3. **Alternative Gateway**
   - Router can select different gateway
   - Routing metrics exclude failing gateway

**Code Path**:
```typescript
// Circuit breaker prevents overload
if (circuitBreaker.getState() === CircuitState.OPEN) {
  throw new CircuitBreakerOpenError(gatewayType);
}

// Router selects healthy gateway
const gatewayType = router.route(context);
```

**Observability**:
- Logs: "Circuit breaker OPENED for STRIPE"
- Metrics: `circuit_breaker.state_change`, `gateway.failure_count`
- Alerts should trigger on circuit breaker open

---

## 3. Duplicate Requests

### Scenario
Client retries request due to network issues, risking double-charge.

### How AegisPay Handles It

**Prevention**:
- Every payment creation requires `idempotencyKey`
- Keys are stored and checked before creating payment

**Detection**:
```typescript
const existingPayment = await repository.findByIdempotencyKey(idempotencyKey);
if (existingPayment) {
  return ok(existingPayment); // Return existing, don't create new
}
```

**Guarantees**:
1. Same idempotency key always returns same payment
2. No duplicate payments created
3. No double-charging

**Best Practice**:
```typescript
// Generate idempotency key from stable identifiers
const idempotencyKey = `order_${orderId}_user_${userId}_${timestamp}`;
```

**Observability**:
- Logs: "Payment already exists with idempotency key"
- Metrics: `payment.idempotency_hit`

---

## 4. Partial State Updates

### Scenario
Payment is partially processed - gateway succeeded but database update failed.

### How AegisPay Handles It

**Prevention**:
- Use transaction boundaries where possible
- State updates are atomic

**Recovery**:
1. Gateway returns transaction ID
2. If database update fails, can query gateway status
3. Reconciliation process can recover state

**Code Pattern**:
```typescript
// Save gateway transaction ID immediately
const payment = payment.startProcessing(gatewayTransactionId);
await repository.update(payment);

// Then process
const result = await gateway.process(payment);
```

**Reconciliation**:
```typescript
// Can always query gateway for status
const status = await gateway.getStatus(gatewayTransactionId);
// Update payment state based on gateway truth
```

**Observability**:
- All state changes emit events
- Events provide audit trail
- Can replay events to recover state

---

## 5. Race Conditions

### Scenario
Concurrent requests try to update same payment.

### How AegisPay Handles It

**Prevention**:
1. **Idempotency Keys**: Prevent duplicate payments
2. **Repository Constraints**: Unique index on idempotency keys
3. **State Machine**: Invalid transitions throw errors
4. **Immutable Updates**: Each update creates new instance

**Database Level**:
```sql
CREATE UNIQUE INDEX idx_idempotency_key ON payments(idempotency_key);
```

**Application Level**:
```typescript
// State machine prevents invalid transitions
if (!PaymentStateMachine.isValidTransition(from, to)) {
  throw new InvalidStateTransitionError(from, to);
}
```

**Transaction Pattern** (for SQL databases):
```typescript
await transactionManager.executeInTransaction(async () => {
  const payment = await repository.findById(id);
  // Lock for update
  const updated = payment.markSuccess();
  await repository.update(updated);
});
```

---

## 6. Invalid Card Details

### Scenario
Customer provides invalid or declined card.

### How AegisPay Handles It

**Detection**:
- Gateway returns error: `INVALID_CARD` or `CARD_DECLINED`
- Error is NOT retryable

**Handling**:
1. Payment immediately marked as FAILURE
2. No retries attempted
3. Failure reason stored in payment

**Code Path**:
```typescript
if (error.code === GatewayErrorCode.INVALID_CARD) {
  // Don't retry, fail immediately
  const failedPayment = payment.markFailure(error.message);
  await repository.update(failedPayment);
  return fail(error);
}
```

**Client Response**:
```typescript
if (payment.state === PaymentState.FAILURE) {
  switch (payment.failureReason) {
    case 'Invalid card':
      // Show card error to user
      break;
    case 'Insufficient funds':
      // Show balance error to user
      break;
  }
}
```

**Observability**:
- Logs: "Payment failed: Invalid card"
- Metrics: `payment.failure.invalid_card`
- Event: `PaymentFailedEvent` with reason

---

## 7. Timeout During Processing

### Scenario
Gateway takes too long to respond, request times out.

### How AegisPay Handles It

**Detection**:
- Gateway request exceeds timeout (30s default)
- Throws `GatewayError` with code `TIMEOUT`

**Recovery**:
1. **Check Gateway Status**
   ```typescript
   // Payment might have succeeded at gateway
   const status = await gateway.getStatus(gatewayTransactionId);
   ```

2. **Retry if Retryable**
   - If no transaction ID yet, retry initiation
   - If transaction ID exists, check status first

3. **Reconciliation**
   - Background job queries gateway for pending payments
   - Updates payment state based on gateway truth

**Code Path**:
```typescript
try {
  const result = await withTimeout(gateway.process(payment), 30000);
} catch (TimeoutError) {
  // Check if payment went through
  if (payment.gatewayTransactionId) {
    const status = await gateway.getStatus(payment.gatewayTransactionId);
    // Update state based on status
  }
}
```

**Observability**:
- Logs: "Gateway timeout, checking status..."
- Metrics: `gateway.timeout`, `payment.status_check`

---

## 8. Insufficient Funds

### Scenario
Customer has insufficient funds in account.

### How AegisPay Handles It

**Detection**:
- Gateway returns `INSUFFICIENT_FUNDS` error
- Error is NOT retryable (customer needs to add funds)

**Handling**:
```typescript
if (error.code === GatewayErrorCode.INSUFFICIENT_FUNDS) {
  const failedPayment = payment.markFailure('Insufficient funds');
  await repository.update(failedPayment);
  
  // Emit event for notification
  await eventBus.publish(
    PaymentEventFactory.createPaymentFailed(failedPayment, version, false)
  );
}
```

**Client Action**:
- Show clear error message
- Offer alternative payment methods
- Don't retry automatically

---

## 9. Fraud Detection

### Scenario
Gateway flags transaction as fraudulent.

### How AegisPay Handles It

**Detection**:
- Gateway returns `FRAUD_DETECTED` error
- Payment marked as FAILURE

**Handling**:
1. **Immediate Failure**
   ```typescript
   if (error.code === GatewayErrorCode.FRAUD_DETECTED) {
     const failedPayment = payment.markFailure('Fraud detected');
     await repository.update(failedPayment);
   }
   ```

2. **Audit Trail**
   - Event logged with full context
   - Customer details recorded
   - Alert triggered for review

3. **No Retries**
   - Fraud checks are deterministic
   - Retrying won't change outcome

**Extensibility**:
```typescript
// Custom fraud check hook
eventBus.subscribe('PAYMENT_INITIATED', async (event) => {
  const fraudScore = await customFraudCheck(event.payload);
  if (fraudScore > threshold) {
    // Block payment
  }
});
```

---

## 10. Database Connection Loss

### Scenario
Database becomes unavailable during operation.

### How AegisPay Handles It

**Detection**:
- Repository operations throw connection errors
- Affects all database operations

**Handling**:
1. **Connection Retry**
   - Database clients should have connection retry logic
   - Connection pools handle reconnection

2. **Transaction Rollback**
   - Incomplete transactions are rolled back
   - Payment state remains consistent

3. **Service Degradation**
   - Can't create new payments
   - Can still query gateway status
   - Can rebuild state from events

**Recovery**:
```typescript
// Events provide source of truth
const events = await eventBus.getEventsByPaymentId(paymentId);
const payment = Payment.fromEvents(events);
```

**Observability**:
- Logs: "Database connection lost"
- Metrics: `db.connection_error`
- Alerts: Critical - immediate action needed

---

## Summary Table

| Failure Scenario | Retry? | Circuit Breaker? | Recovery Strategy |
|-----------------|--------|------------------|-------------------|
| Network Error | ✓ Yes | ✓ Yes | Exponential backoff retry |
| Gateway Downtime | ✓ Yes | ✓ Yes | Circuit breaker + alternate gateway |
| Duplicate Request | ✗ No | ✗ No | Idempotency key check |
| Partial Update | ✓ Yes | ✗ No | Status reconciliation |
| Race Condition | ✗ No | ✗ No | Database constraints + immutability |
| Invalid Card | ✗ No | ✗ No | Immediate failure |
| Timeout | ✓ Yes | ✓ Yes | Status check + retry |
| Insufficient Funds | ✗ No | ✗ No | User action required |
| Fraud Detection | ✗ No | ✗ No | Block + audit |
| DB Connection Loss | ✓ Yes | ✗ No | Connection retry + event replay |

## Testing Failure Scenarios

```typescript
// Test network failure
const mockGateway = new MockGateway(config, {
  successRate: 0.3, // 70% failure rate
  latency: 5000 // High latency
});

// Test circuit breaker
for (let i = 0; i < 10; i++) {
  await processPayment(); // First 5 fail, circuit opens
}

// Test idempotency
const key = 'test_key';
const payment1 = await createPayment({ idempotencyKey: key });
const payment2 = await createPayment({ idempotencyKey: key });
assert(payment1.id === payment2.id);
```
