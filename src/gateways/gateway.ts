import { Payment } from '../domain/payment';
import { GatewayResponse, Result } from '../domain/types';

/**
 * Gateway interface that all payment gateways must implement
 * This provides a unified abstraction over different payment providers
 */
export interface PaymentGateway {
  /**
   * Unique identifier for the gateway
   */
  readonly name: string;

  /**
   * Gateway type
   */
  readonly type: string;

  /**
   * Initialize a payment with the gateway
   * This may involve creating a payment intent, session, or order
   */
  initiate(payment: Payment): Promise<Result<GatewayInitiateResponse, GatewayError>>;

  /**
   * Authenticate the payment (e.g., 3DS authentication)
   */
  authenticate(payment: Payment): Promise<Result<GatewayAuthResponse, GatewayError>>;

  /**
   * Process the payment (capture/charge)
   */
  process(payment: Payment): Promise<Result<GatewayProcessResponse, GatewayError>>;

  /**
   * Refund a payment
   */
  refund(
    payment: Payment,
    amount?: number
  ): Promise<Result<GatewayRefundResponse, GatewayError>>;

  /**
   * Get payment status from gateway
   */
  getStatus(gatewayTransactionId: string): Promise<Result<GatewayStatusResponse, GatewayError>>;

  /**
   * Health check for the gateway
   */
  healthCheck(): Promise<boolean>;
}

// ============================================================================
// GATEWAY RESPONSE TYPES
// ============================================================================

export interface GatewayInitiateResponse {
  gatewayTransactionId: string;
  clientSecret?: string;
  redirectUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayAuthResponse {
  success: boolean;
  authenticationToken?: string;
  requiresAction?: boolean;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayProcessResponse {
  success: boolean;
  transactionId: string;
  status: 'success' | 'pending' | 'failed';
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayRefundResponse {
  success: boolean;
  refundId: string;
  amount: number;
  status: 'success' | 'pending' | 'failed';
  metadata?: Record<string, unknown>;
}

export interface GatewayStatusResponse {
  transactionId: string;
  status: 'success' | 'pending' | 'failed' | 'cancelled';
  amount?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// GATEWAY ERROR TYPES
// ============================================================================

export enum GatewayErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  INVALID_CARD = 'INVALID_CARD',
  CARD_DECLINED = 'CARD_DECLINED',
  FRAUD_DETECTED = 'FRAUD_DETECTED',
  GATEWAY_ERROR = 'GATEWAY_ERROR',
  INVALID_REQUEST = 'INVALID_REQUEST',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    public readonly message: string,
    public readonly gatewayName: string,
    public readonly isRetryable: boolean = false,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'GatewayError';
    Object.setPrototypeOf(this, GatewayError.prototype);
  }

  /**
   * Check if this error should trigger a retry
   */
  shouldRetry(): boolean {
    return this.isRetryable;
  }

  /**
   * Check if this is a network-related error
   */
  isNetworkError(): boolean {
    return (
      this.code === GatewayErrorCode.NETWORK_ERROR ||
      this.code === GatewayErrorCode.TIMEOUT ||
      this.code === GatewayErrorCode.RATE_LIMIT_EXCEEDED
    );
  }

  /**
   * Check if this is a payment method error
   */
  isPaymentMethodError(): boolean {
    return (
      this.code === GatewayErrorCode.INVALID_CARD ||
      this.code === GatewayErrorCode.CARD_DECLINED ||
      this.code === GatewayErrorCode.INSUFFICIENT_FUNDS
    );
  }
}

// ============================================================================
// GATEWAY CONFIGURATION
// ============================================================================

export interface GatewayConfig {
  apiKey: string;
  apiSecret?: string;
  webhookSecret?: string;
  baseUrl?: string;
  timeout?: number; // milliseconds
  retryAttempts?: number;
  additionalConfig?: Record<string, unknown>;
}

// ============================================================================
// GATEWAY METRICS
// ============================================================================

export interface GatewayMetrics {
  gatewayName: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number; // milliseconds
  successRate: number; // percentage
  lastUpdated: Date;
}
