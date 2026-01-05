import { Payment } from './payment';
import { GatewayType } from './types';

/**
 * Domain Events for Payment Lifecycle
 * These events represent facts that have happened in the domain
 */

export enum EventType {
  PAYMENT_INITIATED = 'PAYMENT_INITIATED',
  PAYMENT_AUTHENTICATED = 'PAYMENT_AUTHENTICATED',
  PAYMENT_PROCESSING = 'PAYMENT_PROCESSING',
  PAYMENT_SUCCEEDED = 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_RETRY_ATTEMPTED = 'PAYMENT_RETRY_ATTEMPTED',
}

/**
 * Base interface for all domain events
 */
export interface DomainEvent {
  eventId: string;
  eventType: EventType;
  timestamp: Date;
  aggregateId: string; // Payment ID
  version: number;
  metadata?: Record<string, unknown>;
}

/**
 * Payment Initiated Event
 */
export interface PaymentInitiatedEvent extends DomainEvent {
  eventType: EventType.PAYMENT_INITIATED;
  payload: {
    paymentId: string;
    idempotencyKey: string;
    amount: { amount: number; currency: string };
    customerId: string;
    paymentMethodType: string;
  };
}

/**
 * Payment Authenticated Event
 */
export interface PaymentAuthenticatedEvent extends DomainEvent {
  eventType: EventType.PAYMENT_AUTHENTICATED;
  payload: {
    paymentId: string;
    gatewayType: GatewayType;
  };
}

/**
 * Payment Processing Event
 */
export interface PaymentProcessingEvent extends DomainEvent {
  eventType: EventType.PAYMENT_PROCESSING;
  payload: {
    paymentId: string;
    gatewayType: GatewayType;
    gatewayTransactionId: string;
  };
}

/**
 * Payment Succeeded Event
 */
export interface PaymentSucceededEvent extends DomainEvent {
  eventType: EventType.PAYMENT_SUCCEEDED;
  payload: {
    paymentId: string;
    gatewayTransactionId: string;
    amount: { amount: number; currency: string };
    completedAt: Date;
  };
}

/**
 * Payment Failed Event
 */
export interface PaymentFailedEvent extends DomainEvent {
  eventType: EventType.PAYMENT_FAILED;
  payload: {
    paymentId: string;
    reason: string;
    gatewayType?: GatewayType;
    gatewayTransactionId?: string;
    retryCount: number;
    canRetry: boolean;
  };
}

/**
 * Payment Retry Attempted Event
 */
export interface PaymentRetryAttemptedEvent extends DomainEvent {
  eventType: EventType.PAYMENT_RETRY_ATTEMPTED;
  payload: {
    paymentId: string;
    retryCount: number;
    previousFailureReason: string;
  };
}

/**
 * Union type for all payment events
 */
export type PaymentEvent =
  | PaymentInitiatedEvent
  | PaymentAuthenticatedEvent
  | PaymentProcessingEvent
  | PaymentSucceededEvent
  | PaymentFailedEvent
  | PaymentRetryAttemptedEvent;

/**
 * Event Factory - Creates domain events from payment state changes
 */
export class PaymentEventFactory {
  private static eventCounter = 0;

  /**
   * Create a unique event ID
   */
  private static generateEventId(): string {
    this.eventCounter++;
    return `evt_${Date.now()}_${this.eventCounter}`;
  }

  /**
   * Create base event properties
   */
  private static createBaseEvent(
    _eventType: EventType,
    aggregateId: string,
    version: number
  ): Omit<DomainEvent, 'eventType'> {
    return {
      eventId: this.generateEventId(),
      timestamp: new Date(),
      aggregateId,
      version,
    };
  }

  /**
   * Create Payment Initiated Event
   */
  static createPaymentInitiated(payment: Payment, version: number): PaymentInitiatedEvent {
    return {
      ...this.createBaseEvent(EventType.PAYMENT_INITIATED, payment.id, version),
      eventType: EventType.PAYMENT_INITIATED,
      payload: {
        paymentId: payment.id,
        idempotencyKey: payment.idempotencyKey,
        amount: payment.amount.toJSON(),
        customerId: payment.customer.id,
        paymentMethodType: payment.paymentMethod.type,
      },
    };
  }

  /**
   * Create Payment Authenticated Event
   */
  static createPaymentAuthenticated(
    payment: Payment,
    version: number
  ): PaymentAuthenticatedEvent {
    if (!payment.gatewayType) {
      throw new Error('Gateway type must be set for authenticated payment');
    }
    return {
      ...this.createBaseEvent(EventType.PAYMENT_AUTHENTICATED, payment.id, version),
      eventType: EventType.PAYMENT_AUTHENTICATED,
      payload: {
        paymentId: payment.id,
        gatewayType: payment.gatewayType,
      },
    };
  }

  /**
   * Create Payment Processing Event
   */
  static createPaymentProcessing(payment: Payment, version: number): PaymentProcessingEvent {
    if (!payment.gatewayType || !payment.gatewayTransactionId) {
      throw new Error('Gateway info must be set for processing payment');
    }
    return {
      ...this.createBaseEvent(EventType.PAYMENT_PROCESSING, payment.id, version),
      eventType: EventType.PAYMENT_PROCESSING,
      payload: {
        paymentId: payment.id,
        gatewayType: payment.gatewayType,
        gatewayTransactionId: payment.gatewayTransactionId,
      },
    };
  }

  /**
   * Create Payment Succeeded Event
   */
  static createPaymentSucceeded(payment: Payment, version: number): PaymentSucceededEvent {
    if (!payment.gatewayTransactionId) {
      throw new Error('Gateway transaction ID must be set for succeeded payment');
    }
    return {
      ...this.createBaseEvent(EventType.PAYMENT_SUCCEEDED, payment.id, version),
      eventType: EventType.PAYMENT_SUCCEEDED,
      payload: {
        paymentId: payment.id,
        gatewayTransactionId: payment.gatewayTransactionId,
        amount: payment.amount.toJSON(),
        completedAt: new Date(),
      },
    };
  }

  /**
   * Create Payment Failed Event
   */
  static createPaymentFailed(
    payment: Payment,
    version: number,
    canRetry: boolean
  ): PaymentFailedEvent {
    return {
      ...this.createBaseEvent(EventType.PAYMENT_FAILED, payment.id, version),
      eventType: EventType.PAYMENT_FAILED,
      payload: {
        paymentId: payment.id,
        reason: payment.failureReason || 'Unknown error',
        gatewayType: payment.gatewayType,
        gatewayTransactionId: payment.gatewayTransactionId,
        retryCount: payment.retryCount,
        canRetry,
      },
    };
  }

  /**
   * Create Payment Retry Attempted Event
   */
  static createPaymentRetryAttempted(
    payment: Payment,
    version: number
  ): PaymentRetryAttemptedEvent {
    return {
      ...this.createBaseEvent(EventType.PAYMENT_RETRY_ATTEMPTED, payment.id, version),
      eventType: EventType.PAYMENT_RETRY_ATTEMPTED,
      payload: {
        paymentId: payment.id,
        retryCount: payment.retryCount,
        previousFailureReason: payment.failureReason || 'Unknown',
      },
    };
  }
}
