import { Payment } from '../domain/payment';
import { ok, fail, Result } from '../domain/types';
import {
  PaymentGateway,
  GatewayInitiateResponse,
  GatewayAuthResponse,
  GatewayProcessResponse,
  GatewayRefundResponse,
  GatewayStatusResponse,
  GatewayError,
  GatewayErrorCode,
  GatewayConfig,
} from './gateway';

/**
 * Mock Gateway for testing and development
 * Simulates payment processing with configurable success/failure rates
 */
export class MockGateway implements PaymentGateway {
  readonly name = 'Mock Gateway';
  readonly type = 'MOCK';

  private successRate: number;
  private latency: number;

  constructor(
    private config: GatewayConfig,
    options: {
      successRate?: number; // 0-1
      latency?: number; // milliseconds
    } = {}
  ) {
    this.successRate = options.successRate ?? 0.95;
    this.latency = options.latency ?? 100;
  }

  async initiate(payment: Payment): Promise<Result<GatewayInitiateResponse, GatewayError>> {
    await this.simulateLatency();

    if (!this.shouldSucceed()) {
      return fail(
        new GatewayError(
          GatewayErrorCode.GATEWAY_ERROR,
          'Mock gateway initiation failed',
          this.name,
          true
        )
      );
    }

    return ok({
      gatewayTransactionId: this.generateTransactionId(),
      clientSecret: this.generateSecret(),
      metadata: {
        mockGateway: true,
        paymentId: payment.id,
      },
    });
  }

  async authenticate(payment: Payment): Promise<Result<GatewayAuthResponse, GatewayError>> {
    await this.simulateLatency();

    if (!this.shouldSucceed()) {
      return fail(
        new GatewayError(
          GatewayErrorCode.AUTHENTICATION_FAILED,
          'Mock gateway authentication failed',
          this.name,
          true
        )
      );
    }

    return ok({
      success: true,
      authenticationToken: this.generateToken(),
      requiresAction: false,
      metadata: {
        mockGateway: true,
        paymentId: payment.id,
      },
    });
  }

  async process(payment: Payment): Promise<Result<GatewayProcessResponse, GatewayError>> {
    await this.simulateLatency();

    // Simulate different failure scenarios
    if (!this.shouldSucceed()) {
      const errorCode = this.getRandomErrorCode();
      return fail(
        new GatewayError(
          errorCode,
          `Mock gateway processing failed: ${errorCode}`,
          this.name,
          this.isErrorRetryable(errorCode)
        )
      );
    }

    return ok({
      success: true,
      transactionId: payment.gatewayTransactionId || this.generateTransactionId(),
      status: 'success',
      message: 'Payment processed successfully',
      metadata: {
        mockGateway: true,
        paymentId: payment.id,
        amount: payment.amount.toJSON(),
      },
    });
  }

  async refund(
    payment: Payment,
    amount?: number
  ): Promise<Result<GatewayRefundResponse, GatewayError>> {
    await this.simulateLatency();

    if (!this.shouldSucceed()) {
      return fail(
        new GatewayError(
          GatewayErrorCode.GATEWAY_ERROR,
          'Mock gateway refund failed',
          this.name,
          true
        )
      );
    }

    const refundAmount = amount ?? payment.amount.amount;

    return ok({
      success: true,
      refundId: this.generateRefundId(),
      amount: refundAmount,
      status: 'success',
      metadata: {
        mockGateway: true,
        originalPaymentId: payment.id,
      },
    });
  }

  async getStatus(
    gatewayTransactionId: string
  ): Promise<Result<GatewayStatusResponse, GatewayError>> {
    await this.simulateLatency();

    if (!this.shouldSucceed()) {
      return fail(
        new GatewayError(
          GatewayErrorCode.GATEWAY_ERROR,
          'Mock gateway status check failed',
          this.name,
          true
        )
      );
    }

    return ok({
      transactionId: gatewayTransactionId,
      status: 'success',
      metadata: {
        mockGateway: true,
      },
    });
  }

  async healthCheck(): Promise<boolean> {
    await this.simulateLatency(50);
    return this.shouldSucceed();
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private shouldSucceed(): boolean {
    return Math.random() < this.successRate;
  }

  private async simulateLatency(customLatency?: number): Promise<void> {
    const delay = customLatency ?? this.latency;
    const jitter = Math.random() * 50; // Add some jitter
    await new Promise((resolve) => setTimeout(resolve, delay + jitter));
  }

  private generateTransactionId(): string {
    return `mock_txn_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private generateSecret(): string {
    return `mock_secret_${Math.random().toString(36).substring(2)}`;
  }

  private generateToken(): string {
    return `mock_token_${Math.random().toString(36).substring(2)}`;
  }

  private generateRefundId(): string {
    return `mock_refund_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private getRandomErrorCode(): GatewayErrorCode {
    const errorCodes = [
      GatewayErrorCode.NETWORK_ERROR,
      GatewayErrorCode.TIMEOUT,
      GatewayErrorCode.CARD_DECLINED,
      GatewayErrorCode.INSUFFICIENT_FUNDS,
      GatewayErrorCode.INVALID_CARD,
      GatewayErrorCode.GATEWAY_ERROR,
    ];
    return errorCodes[Math.floor(Math.random() * errorCodes.length)];
  }

  private isErrorRetryable(errorCode: GatewayErrorCode): boolean {
    const retryableErrors = [
      GatewayErrorCode.NETWORK_ERROR,
      GatewayErrorCode.TIMEOUT,
      GatewayErrorCode.GATEWAY_ERROR,
      GatewayErrorCode.RATE_LIMIT_EXCEEDED,
    ];
    return retryableErrors.includes(errorCode);
  }
}
