/**
 * Core types for the AegisPay payment orchestration system
 */

// ============================================================================
// PAYMENT STATES
// ============================================================================

/**
 * Payment lifecycle states following a strict state machine
 */
export enum PaymentState {
  INITIATED = 'INITIATED',
  AUTHENTICATED = 'AUTHENTICATED',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

// ============================================================================
// PAYMENT METHOD TYPES
// ============================================================================

export enum PaymentMethodType {
  CARD = 'CARD',
  UPI = 'UPI',
  NET_BANKING = 'NET_BANKING',
  WALLET = 'WALLET',
  PAY_LATER = 'PAY_LATER',
}

// ============================================================================
// CURRENCY
// ============================================================================

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  INR = 'INR',
  AUD = 'AUD',
  CAD = 'CAD',
}

// ============================================================================
// GATEWAY TYPES
// ============================================================================

export enum GatewayType {
  STRIPE = 'STRIPE',
  RAZORPAY = 'RAZORPAY',
  PAYPAL = 'PAYPAL',
  ADYEN = 'ADYEN',
  MOCK = 'MOCK',
}

// ============================================================================
// MONEY VALUE OBJECT
// ============================================================================

/**
 * Immutable Money value object to handle monetary calculations safely
 */
export class Money {
  readonly amount: number;
  readonly currency: Currency;

  constructor(amount: number, currency: Currency) {
    if (amount < 0) {
      throw new Error('Money amount cannot be negative');
    }
    if (!Number.isFinite(amount)) {
      throw new Error('Money amount must be a finite number');
    }
    this.amount = Math.round(amount * 100) / 100; // Round to 2 decimal places
    this.currency = currency;
  }

  add(other: Money): Money {
    this.ensureSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.ensureSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  multiply(factor: number): Money {
    return new Money(this.amount * factor, this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  isGreaterThan(other: Money): boolean {
    this.ensureSameCurrency(other);
    return this.amount > other.amount;
  }

  private ensureSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  toJSON(): { amount: number; currency: string } {
    return {
      amount: this.amount,
      currency: this.currency,
    };
  }

  static fromJSON(json: { amount: number; currency: string }): Money {
    return new Money(json.amount, json.currency as Currency);
  }
}

// ============================================================================
// CARD DETAILS
// ============================================================================

export interface CardDetails {
  cardNumber: string; // Should be encrypted/tokenized in production
  expiryMonth: string;
  expiryYear: string;
  cvv: string; // Should never be stored
  cardHolderName: string;
}

// ============================================================================
// PAYMENT METHOD
// ============================================================================

export type PaymentMethod =
  | { type: PaymentMethodType.CARD; details: CardDetails }
  | { type: PaymentMethodType.UPI; details: { vpa: string } }
  | { type: PaymentMethodType.NET_BANKING; details: { bankCode: string } }
  | { type: PaymentMethodType.WALLET; details: { walletProvider: string } }
  | { type: PaymentMethodType.PAY_LATER; details: { provider: string } };

// ============================================================================
// CUSTOMER INFO
// ============================================================================

export interface Customer {
  id: string;
  email: string;
  phone?: string;
  name?: string;
  billingAddress?: Address;
  shippingAddress?: Address;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

// ============================================================================
// PAYMENT METADATA
// ============================================================================

export interface PaymentMetadata {
  orderId?: string;
  orderItems?: string[];
  customFields?: Record<string, string | number | boolean>;
  merchantData?: Record<string, unknown>;
}

// ============================================================================
// GATEWAY RESPONSE
// ============================================================================

export interface GatewayResponse {
  success: boolean;
  gatewayTransactionId?: string;
  message?: string;
  errorCode?: string;
  rawResponse?: Record<string, unknown>;
}

// ============================================================================
// RESULT TYPE (Functional Error Handling)
// ============================================================================

export type Result<T, E = Error> = Success<T> | Failure<E>;

export class Success<T> {
  readonly isSuccess = true;
  readonly isFailure = false;

  constructor(readonly value: T) { }

  map<U>(fn: (value: T) => U): Result<U, never> {
    return new Success(fn(this.value));
  }

  flatMap<U, E>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return fn(this.value);
  }
}

export class Failure<E> {
  readonly isSuccess = false;
  readonly isFailure = true;

  constructor(readonly error: E) { }

  map<U>(_fn: (value: never) => U): Result<U, E> {
    return this as unknown as Result<U, E>;
  }

  flatMap<U>(_fn: (value: never) => Result<U, E>): Result<U, E> {
    return this as unknown as Result<U, E>;
  }
}

export const ok = <T>(value: T): Result<T, never> => new Success(value);
export const fail = <E>(error: E): Result<never, E> => new Failure(error);
