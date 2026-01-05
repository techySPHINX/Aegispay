import {
  PaymentState,
  PaymentMethod,
  Customer,
  Money,
  PaymentMetadata,
  GatewayType,
} from './types';

/**
 * Payment aggregate root - represents the core payment entity
 * This is an immutable domain model following DDD principles
 */
export class Payment {
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

  constructor(params: {
    id: string;
    idempotencyKey: string;
    state: PaymentState;
    amount: Money;
    paymentMethod: PaymentMethod;
    customer: Customer;
    metadata?: PaymentMetadata;
    gatewayType?: GatewayType;
    gatewayTransactionId?: string;
    createdAt?: Date;
    updatedAt?: Date;
    failureReason?: string;
    retryCount?: number;
  }) {
    this.id = params.id;
    this.idempotencyKey = params.idempotencyKey;
    this.state = params.state;
    this.amount = params.amount;
    this.paymentMethod = params.paymentMethod;
    this.customer = params.customer;
    this.metadata = params.metadata || {};
    this.gatewayType = params.gatewayType;
    this.gatewayTransactionId = params.gatewayTransactionId;
    this.createdAt = params.createdAt || new Date();
    this.updatedAt = params.updatedAt || new Date();
    this.failureReason = params.failureReason;
    this.retryCount = params.retryCount || 0;
  }

  /**
   * Create a new payment instance with updated fields (immutable update)
   */
  private withUpdates(updates: Partial<Payment>): Payment {
    return new Payment({
      id: this.id,
      idempotencyKey: this.idempotencyKey,
      state: updates.state ?? this.state,
      amount: updates.amount ?? this.amount,
      paymentMethod: updates.paymentMethod ?? this.paymentMethod,
      customer: updates.customer ?? this.customer,
      metadata: updates.metadata ?? this.metadata,
      gatewayType: updates.gatewayType ?? this.gatewayType,
      gatewayTransactionId: updates.gatewayTransactionId ?? this.gatewayTransactionId,
      createdAt: this.createdAt,
      updatedAt: new Date(),
      failureReason: updates.failureReason ?? this.failureReason,
      retryCount: updates.retryCount ?? this.retryCount,
    });
  }

  /**
   * Transition to AUTHENTICATED state
   */
  authenticate(gatewayType: GatewayType): Payment {
    if (this.state !== PaymentState.INITIATED) {
      throw new Error(
        `Invalid state transition: Cannot authenticate from ${this.state} state`
      );
    }
    return this.withUpdates({ state: PaymentState.AUTHENTICATED, gatewayType });
  }

  /**
   * Transition to PROCESSING state
   */
  startProcessing(gatewayTransactionId: string): Payment {
    if (this.state !== PaymentState.AUTHENTICATED) {
      throw new Error(
        `Invalid state transition: Cannot start processing from ${this.state} state`
      );
    }
    return this.withUpdates({ state: PaymentState.PROCESSING, gatewayTransactionId });
  }

  /**
   * Transition to SUCCESS state
   */
  markSuccess(): Payment {
    if (this.state !== PaymentState.PROCESSING) {
      throw new Error(`Invalid state transition: Cannot succeed from ${this.state} state`);
    }
    return this.withUpdates({ state: PaymentState.SUCCESS });
  }

  /**
   * Transition to FAILURE state
   */
  markFailure(reason: string): Payment {
    if (
      this.state !== PaymentState.PROCESSING &&
      this.state !== PaymentState.AUTHENTICATED &&
      this.state !== PaymentState.INITIATED
    ) {
      throw new Error(`Invalid state transition: Cannot fail from ${this.state} state`);
    }
    return this.withUpdates({ state: PaymentState.FAILURE, failureReason: reason });
  }

  /**
   * Increment retry count
   */
  incrementRetry(): Payment {
    return this.withUpdates({ retryCount: this.retryCount + 1 });
  }

  /**
   * Check if payment is in terminal state
   */
  isTerminal(): boolean {
    return this.state === PaymentState.SUCCESS || this.state === PaymentState.FAILURE;
  }

  /**
   * Check if payment can be retried
   */
  canRetry(maxRetries: number): boolean {
    return this.state === PaymentState.FAILURE && this.retryCount < maxRetries;
  }

  /**
   * Serialize to JSON for persistence
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      idempotencyKey: this.idempotencyKey,
      state: this.state,
      amount: this.amount.toJSON(),
      paymentMethod: this.paymentMethod,
      customer: this.customer,
      metadata: this.metadata,
      gatewayType: this.gatewayType,
      gatewayTransactionId: this.gatewayTransactionId,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      failureReason: this.failureReason,
      retryCount: this.retryCount,
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(json: Record<string, unknown>): Payment {
    return new Payment({
      id: json.id as string,
      idempotencyKey: json.idempotencyKey as string,
      state: json.state as PaymentState,
      amount: Money.fromJSON(json.amount as { amount: number; currency: string }),
      paymentMethod: json.paymentMethod as PaymentMethod,
      customer: json.customer as Customer,
      metadata: (json.metadata as PaymentMetadata) || {},
      gatewayType: json.gatewayType as GatewayType | undefined,
      gatewayTransactionId: json.gatewayTransactionId as string | undefined,
      createdAt: new Date(json.createdAt as string),
      updatedAt: new Date(json.updatedAt as string),
      failureReason: json.failureReason as string | undefined,
      retryCount: (json.retryCount as number) || 0,
    });
  }
}
