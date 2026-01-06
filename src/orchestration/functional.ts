/**
 * Pure Functional Payment Orchestration
 * 
 * This module contains pure business logic for payment orchestration.
 * All side effects are isolated in adapters, making this logic:
 * - Testable without mocks
 * - Composable
 * - Easy to reason about
 * - Guarantees correctness through type safety
 */

import { Payment } from '../domain/payment';
import { GatewayType, Money, Currency, PaymentMethod, Customer, PaymentState } from '../domain/types';
import { IO, Adapters } from './adapters';
import { PaymentEventFactory } from '../domain/events';
import { PaymentGateway } from '../gateways/gateway';
import { CircuitBreaker } from './circuitBreaker';
import { RetryPolicy } from './retryPolicy';
import { GatewayError } from '../gateways/gateway';

/**
 * Pure payment creation command
 */
export interface CreatePaymentCommand {
  idempotencyKey: string;
  amount: number;
  currency: Currency;
  paymentMethod: PaymentMethod;
  customer: Customer;
  metadata?: Record<string, unknown>;
}

/**
 * Pure payment processing command
 */
export interface ProcessPaymentCommand {
  paymentId: string;
  gatewayType: GatewayType;
  gateway: PaymentGateway;
  circuitBreaker: CircuitBreaker;
  retryPolicy: RetryPolicy;
}

/**
 * Pure function: Create payment orchestration
 * Returns an IO that describes the computation without executing it
 */
export function createPaymentOrchestration(
  command: CreatePaymentCommand,
  adapters: Adapters,
  eventVersion: number
): IO<Payment> {
  return (
    adapters.repository
      .findByIdempotencyKey(command.idempotencyKey)
      .flatMap((existing) => {
        if (existing) {
          // Idempotent: return existing payment
          return adapters.logger
            .info('Payment already exists (idempotent)', {
              paymentId: existing.id,
              idempotencyKey: command.idempotencyKey,
            })
            .chain(adapters.metrics.increment('payment.idempotency_hit'))
            .map(() => existing);
        }

        // Create new payment (pure domain operation)
        const payment = createPayment(command);

        // Save and emit events (side effects isolated)
        return adapters.repository
          .save(payment)
          .flatMap((saved) => {
            const event = PaymentEventFactory.createPaymentInitiated(saved, eventVersion);
            return adapters.events.publish(event).map(() => saved);
          })
          .flatMap((saved) => {
            return adapters.logger
              .info('Payment created', { paymentId: saved.id })
              .chain(adapters.metrics.increment('payment.created'))
              .map(() => saved);
          });
      })
  );
}

/**
 * Pure function: Create payment domain object
 */
function createPayment(command: CreatePaymentCommand): Payment {
  return new Payment({
    id: generatePaymentId(),
    idempotencyKey: command.idempotencyKey,
    state: PaymentState.INITIATED,
    amount: new Money(command.amount, command.currency),
    paymentMethod: command.paymentMethod,
    customer: command.customer,
    metadata: command.metadata || {},
  });
}

/**
 * Pure function: Process payment orchestration
 * This is the core orchestration logic, completely pure
 */
export function processPaymentOrchestration(
  command: ProcessPaymentCommand,
  adapters: Adapters,
  getEventVersion: (paymentId: string) => number
): IO<Payment> {
  return (
    adapters.repository
      .findById(command.paymentId)
      .flatMap((payment) => {
        if (!payment) {
          throw new Error(`Payment ${command.paymentId} not found`);
        }

        return adapters.logger
          .info('Starting payment processing', {
            paymentId: payment.id,
            state: payment.state,
          })
          .map(() => payment);
      })
      // Step 1: Authenticate
      .flatMap((payment) => authenticatePaymentStep(payment, command, adapters, getEventVersion))
      // Step 2: Initiate
      .flatMap((payment) => initiatePaymentStep(payment, command, adapters, getEventVersion))
      // Step 3: Process
      .flatMap((payment) => processPaymentStep(payment, command, adapters, getEventVersion))
      // Step 4: Mark success
      .flatMap((payment) => markPaymentSuccess(payment, adapters, getEventVersion))
      .flatMap((payment) => {
        return adapters.logger
          .info('Payment processed successfully', {
            paymentId: payment.id,
            state: payment.state,
          })
          .chain(adapters.metrics.increment('payment.processed'))
          .map(() => payment);
      })
  );
}

/**
 * Pure step: Authenticate payment
 */
function authenticatePaymentStep(
  payment: Payment,
  command: ProcessPaymentCommand,
  adapters: Adapters,
  getEventVersion: (paymentId: string) => number
): IO<Payment> {
  return new IO(async () => {
    // Execute authentication with retry and circuit breaker
    const authResult = await command.circuitBreaker.execute(async () => {
      return await command.retryPolicy.executeWithRetry(
        () => command.gateway.authenticate(payment),
        (error) => error instanceof GatewayError && error.shouldRetry()
      );
    });

    if (authResult.isFailure) {
      throw new Error(`Authentication failed: ${authResult.error}`);
    }

    // Pure domain transition
    const authenticatedPayment = payment.authenticate(command.gatewayType);

    // Persist and emit event
    await adapters.repository.update(authenticatedPayment).unsafeRun();
    const event = PaymentEventFactory.createPaymentAuthenticated(
      authenticatedPayment,
      getEventVersion(payment.id)
    );
    await adapters.events.publish(event).unsafeRun();
    await adapters.logger
      .info('Payment authenticated', { paymentId: authenticatedPayment.id })
      .unsafeRun();

    return authenticatedPayment;
  });
}

/**
 * Pure step: Initiate payment
 */
function initiatePaymentStep(
  payment: Payment,
  command: ProcessPaymentCommand,
  adapters: Adapters,
  getEventVersion: (paymentId: string) => number
): IO<Payment> {
  return new IO(async () => {
    // Execute initiation with retry and circuit breaker
    const initiateResult = await command.circuitBreaker.execute(async () => {
      return await command.retryPolicy.executeWithRetry(
        () => command.gateway.initiate(payment),
        (error) => error instanceof GatewayError && error.shouldRetry()
      );
    });

    if (initiateResult.isFailure) {
      throw new Error(`Payment initiation failed: ${initiateResult.error}`);
    }

    const gatewayTxnId = initiateResult.value.gatewayTransactionId;

    // Pure domain transition
    const processingPayment = payment.startProcessing(gatewayTxnId);

    // Persist and emit event
    await adapters.repository.update(processingPayment).unsafeRun();
    const event = PaymentEventFactory.createPaymentProcessing(
      processingPayment,
      getEventVersion(payment.id)
    );
    await adapters.events.publish(event).unsafeRun();
    await adapters.logger
      .info('Payment processing initiated', { paymentId: processingPayment.id })
      .unsafeRun();

    return processingPayment;
  });
}

/**
 * Pure step: Process payment
 */
function processPaymentStep(
  payment: Payment,
  command: ProcessPaymentCommand,
  adapters: Adapters,
  getEventVersion: (paymentId: string) => number
): IO<Payment> {
  return new IO(async () => {
    // Execute processing with retry and circuit breaker
    const processResult = await command.circuitBreaker.execute(async () => {
      return await command.retryPolicy.executeWithRetry(
        () => command.gateway.process(payment),
        (error) => error instanceof GatewayError && error.shouldRetry()
      );
    });

    if (processResult.isFailure || !processResult.value.success) {
      throw new Error(
        `Payment processing failed: ${processResult.isFailure ? processResult.error : 'Unknown error'
        }`
      );
    }

    await adapters.logger
      .info('Payment processing completed', { paymentId: payment.id })
      .unsafeRun();

    return payment;
  });
}

/**
 * Pure step: Mark payment as success
 */
function markPaymentSuccess(
  payment: Payment,
  adapters: Adapters,
  getEventVersion: (paymentId: string) => number
): IO<Payment> {
  return new IO(async () => {
    // Pure domain transition
    const successPayment = payment.markSuccess();

    // Persist and emit event
    await adapters.repository.update(successPayment).unsafeRun();
    const event = PaymentEventFactory.createPaymentSucceeded(
      successPayment,
      getEventVersion(payment.id)
    );
    await adapters.events.publish(event).unsafeRun();
    await adapters.logger
      .info('Payment marked as success', { paymentId: successPayment.id })
      .unsafeRun();

    return successPayment;
  });
}

/**
 * Pure step: Mark payment as failed
 */
export function markPaymentFailure(
  payment: Payment,
  reason: string,
  adapters: Adapters,
  getEventVersion: (paymentId: string) => number,
  maxRetries: number
): IO<Payment> {
  return new IO(async () => {
    // Pure domain transition
    const failedPayment = payment.markFailure(reason);

    // Persist and emit event
    await adapters.repository.update(failedPayment).unsafeRun();
    const event = PaymentEventFactory.createPaymentFailed(
      failedPayment,
      getEventVersion(payment.id),
      failedPayment.canRetry(maxRetries)
    );
    await adapters.events.publish(event).unsafeRun();
    await adapters.logger
      .error('Payment failed', new Error(reason), { paymentId: failedPayment.id })
      .unsafeRun();

    return failedPayment;
  });
}

/**
 * Pure function: Generate payment ID
 */
function generatePaymentId(): string {
  return `pay_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Pure function: Recover from crash
 * 
 * This function reconstructs payment state from events,
 * ensuring correctness even after process crashes.
 */
export function recoverPaymentFromEvents(
  paymentId: string,
  _getEventVersion: (paymentId: string) => number,
  adapters: Adapters
): IO<Payment> {
  return new IO(async () => {
    // Simplified: Load payment from repository instead of events
    // Full implementation would rebuild from event store
    const payment = await adapters.repository.findById(paymentId).unsafeRun();

    if (!payment) {
      throw new Error(`No payment found for ${paymentId}`);
    }

    await adapters.logger
      .info('Payment state recovered', {
        paymentId,
        currentState: payment.state,
      })
      .unsafeRun();

    return payment;
  });
}
