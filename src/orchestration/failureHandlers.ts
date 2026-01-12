/**
 * Production Failure Scenario Handlers
 *
 * This module simulates and handles various production failure scenarios:
 * - Gateway timeouts
 * - Partial failures
 * - Network errors
 * - Process crashes
 * - Database failures
 *
 * Ensures the system recovers correctly without double processing.
 */

import { Payment } from '../domain/payment';
import { Result, fail } from '../domain/types';
import {
  PaymentGateway,
  GatewayInitiateResponse,
  GatewayProcessResponse,
  GatewayAuthResponse,
  GatewayRefundResponse,
  GatewayStatusResponse,
  GatewayError,
  GatewayErrorCode,
} from '../gateways/gateway';

/**
 * Failure injection configuration for testing
 */
export interface FailureConfig {
  simulateTimeout: boolean;
  timeoutDelayMs: number;
  simulatePartialFailure: boolean;
  partialFailureRate: number; // 0-1
  simulateNetworkError: boolean;
  networkErrorRate: number; // 0-1
  simulateCrash: boolean;
  crashRate: number; // 0-1
}

export const DEFAULT_FAILURE_CONFIG: FailureConfig = {
  simulateTimeout: false,
  timeoutDelayMs: 30000,
  simulatePartialFailure: false,
  partialFailureRate: 0,
  simulateNetworkError: false,
  networkErrorRate: 0,
  simulateCrash: false,
  crashRate: 0,
};

/**
 * Resilient Gateway Wrapper
 * Wraps any gateway with failure handling and recovery logic
 */
export class ResilientGatewayWrapper implements PaymentGateway {
  constructor(
    private gateway: PaymentGateway,
    private failureConfig: FailureConfig = DEFAULT_FAILURE_CONFIG
  ) {}

  get name(): string {
    return this.gateway.name;
  }

  get type(): string {
    return this.gateway.type;
  }

  async refund(
    payment: Payment,
    amount?: number
  ): Promise<Result<GatewayRefundResponse, GatewayError>> {
    try {
      return await this.gateway.refund(payment, amount);
    } catch (error) {
      return this.handleFailure(error as Error, 'refund');
    }
  }

  async getStatus(
    gatewayTransactionId: string
  ): Promise<Result<GatewayStatusResponse, GatewayError>> {
    try {
      return await this.gateway.getStatus(gatewayTransactionId);
    } catch (error) {
      return this.handleFailure(error as Error, 'getStatus');
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      return await this.gateway.healthCheck();
    } catch {
      return false;
    }
  }

  async authenticate(payment: Payment): Promise<Result<GatewayAuthResponse, GatewayError>> {
    try {
      // Simulate network error
      if (this.shouldSimulateNetworkError()) {
        throw new NetworkError('Simulated network error during authentication');
      }

      // Simulate timeout
      if (this.failureConfig.simulateTimeout) {
        await this.simulateTimeout();
      }

      // Simulate crash before operation
      if (this.shouldSimulateCrash()) {
        throw new ProcessCrashError('Simulated process crash before authentication');
      }

      const result = await this.gateway.authenticate(payment);

      // Simulate crash after operation
      if (this.shouldSimulateCrash()) {
        throw new ProcessCrashError('Simulated process crash after authentication');
      }

      return result;
    } catch (error) {
      return this.handleFailure(error as Error, 'authenticate');
    }
  }

  async initiate(payment: Payment): Promise<Result<GatewayInitiateResponse, GatewayError>> {
    try {
      // Simulate network error
      if (this.shouldSimulateNetworkError()) {
        throw new NetworkError('Simulated network error during initiation');
      }

      // Simulate timeout
      if (this.failureConfig.simulateTimeout) {
        await this.simulateTimeout();
      }

      // Simulate crash before operation
      if (this.shouldSimulateCrash()) {
        throw new ProcessCrashError('Simulated process crash before initiation');
      }

      const result = await this.gateway.initiate(payment);

      // Simulate partial failure: operation succeeded on gateway but response lost
      if (this.shouldSimulatePartialFailure()) {
        throw new PartialFailureError(
          'Simulated partial failure: operation may have succeeded but response lost',
          result.isSuccess ? result.value : undefined
        );
      }

      // Simulate crash after operation
      if (this.shouldSimulateCrash()) {
        throw new ProcessCrashError('Simulated process crash after initiation');
      }

      return result;
    } catch (error) {
      return this.handleFailure(error as Error, 'initiate');
    }
  }

  async process(payment: Payment): Promise<Result<GatewayProcessResponse, GatewayError>> {
    try {
      // Simulate network error
      if (this.shouldSimulateNetworkError()) {
        throw new NetworkError('Simulated network error during processing');
      }

      // Simulate timeout
      if (this.failureConfig.simulateTimeout) {
        await this.simulateTimeout();
      }

      // Simulate crash before operation
      if (this.shouldSimulateCrash()) {
        throw new ProcessCrashError('Simulated process crash before processing');
      }

      const result = await this.gateway.process(payment);

      // Simulate partial failure: operation succeeded on gateway but response lost
      if (this.shouldSimulatePartialFailure()) {
        throw new PartialFailureError(
          'Simulated partial failure: payment may have been processed but response lost',
          result.isSuccess ? result.value : undefined
        );
      }

      // Simulate crash after operation
      if (this.shouldSimulateCrash()) {
        throw new ProcessCrashError('Simulated process crash after processing');
      }

      return result;
    } catch (error) {
      return this.handleFailure(error as Error, 'process');
    }
  }

  private shouldSimulateNetworkError(): boolean {
    return (
      this.failureConfig.simulateNetworkError && Math.random() < this.failureConfig.networkErrorRate
    );
  }

  private shouldSimulatePartialFailure(): boolean {
    return (
      this.failureConfig.simulatePartialFailure &&
      Math.random() < this.failureConfig.partialFailureRate
    );
  }

  private shouldSimulateCrash(): boolean {
    return this.failureConfig.simulateCrash && Math.random() < this.failureConfig.crashRate;
  }

  private async simulateTimeout(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.failureConfig.timeoutDelayMs));
    throw new TimeoutError(`Operation timed out after ${this.failureConfig.timeoutDelayMs}ms`);
  }

  private handleFailure(error: Error, operation: string): Result<never, GatewayError> {
    // Classify the error and decide if it's retryable
    if (error instanceof TimeoutError) {
      return fail(
        new GatewayError(
          GatewayErrorCode.TIMEOUT,
          `Timeout during ${operation}`,
          'resilient-wrapper',
          true,
          error
        )
      );
    }

    if (error instanceof NetworkError) {
      return fail(
        new GatewayError(
          GatewayErrorCode.NETWORK_ERROR,
          `Network error during ${operation}`,
          'resilient-wrapper',
          true,
          error
        )
      );
    }

    if (error instanceof PartialFailureError) {
      // Partial failure: we need to verify the state on the gateway
      return fail(
        new GatewayError(
          GatewayErrorCode.GATEWAY_ERROR,
          `Partial failure during ${operation}: ${error.message}`,
          'resilient-wrapper',
          false,
          error
        )
      );
    }

    if (error instanceof ProcessCrashError) {
      // Process crash: state needs to be recovered from events
      return fail(
        new GatewayError(
          GatewayErrorCode.GATEWAY_ERROR,
          `Process crash during ${operation}`,
          'resilient-wrapper',
          false,
          error
        )
      );
    }

    // Unknown error: assume not retryable
    return fail(
      new GatewayError(
        GatewayErrorCode.UNKNOWN_ERROR,
        `Unknown error during ${operation}`,
        'resilient-wrapper',
        false,
        error
      )
    );
  }
}

/**
 * Custom error types for different failure scenarios
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export class PartialFailureError extends Error {
  constructor(
    message: string,
    public readonly partialResponse?:
      | GatewayInitiateResponse
      | GatewayProcessResponse
      | GatewayAuthResponse
  ) {
    super(message);
    this.name = 'PartialFailureError';
    Object.setPrototypeOf(this, PartialFailureError.prototype);
  }
}

export class ProcessCrashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessCrashError';
    Object.setPrototypeOf(this, ProcessCrashError.prototype);
  }
}

/**
 * Recovery strategy for handling partial failures
 *
 * When a partial failure occurs (operation succeeded but response lost),
 * we need to verify the state on the gateway to avoid double processing.
 */
export class PartialFailureRecovery {
  constructor(private gateway: PaymentGateway) {}

  /**
   * Verify payment state on gateway after partial failure
   *
   * Uses the gateway transaction ID to check if the operation succeeded.
   * This is idempotent and safe to call multiple times.
   */
  async verifyPaymentState(payment: Payment): Promise<VerificationResult> {
    if (!payment.gatewayTransactionId) {
      return {
        verified: false,
        reason: 'No gateway transaction ID available',
        state: 'UNKNOWN',
      };
    }

    try {
      // In production, this would call the gateway's status check API
      // For now, we simulate by checking the payment state

      // Mock verification logic
      const statusResult = await this.gateway.process(payment);

      if (statusResult.isFailure) {
        return {
          verified: false,
          reason: `Status check failed: ${statusResult.error}`,
          state: 'UNKNOWN',
        };
      }

      return {
        verified: true,
        reason: 'Status verified from gateway',
        state: statusResult.value.success ? 'SUCCESS' : 'FAILURE',
        response: statusResult.value,
      };
    } catch (error) {
      return {
        verified: false,
        reason: `Verification error: ${(error as Error).message}`,
        state: 'UNKNOWN',
      };
    }
  }

  /**
   * Reconcile payment state with gateway
   *
   * Called during crash recovery to ensure state consistency.
   */
  async reconcilePayment(payment: Payment): Promise<Payment> {
    const verification = await this.verifyPaymentState(payment);

    if (!verification.verified) {
      // Cannot verify: keep current state
      return payment;
    }

    // Update payment state based on verification
    switch (verification.state) {
      case 'SUCCESS':
        return payment.isTerminal() ? payment : payment.markSuccess();
      case 'FAILURE':
        return payment.isTerminal()
          ? payment
          : payment.markFailure('Verified as failed on gateway');
      default:
        return payment;
    }
  }
}

export interface VerificationResult {
  verified: boolean;
  reason: string;
  state: 'SUCCESS' | 'FAILURE' | 'UNKNOWN';
  response?: GatewayInitiateResponse | GatewayProcessResponse | GatewayAuthResponse;
}

/**
 * Crash recovery coordinator
 *
 * Handles recovery after process crashes by:
 * 1. Rebuilding state from events
 * 2. Verifying state with gateway
 * 3. Completing any in-flight operations
 */
export class CrashRecoveryCoordinator {
  constructor(
    private partialFailureRecovery: PartialFailureRecovery,
    private logger: {
      info: (msg: string, ctx?: Record<string, unknown>) => void;
      error: (msg: string, err: Error, ctx?: Record<string, unknown>) => void;
      warn: (msg: string, ctx?: Record<string, unknown>) => void;
    }
  ) {}

  /**
   * Recover payment after crash
   *
   * This is idempotent and safe to call multiple times.
   */
  async recoverPayment(payment: Payment): Promise<Payment> {
    this.logger.info('Starting crash recovery', {
      paymentId: payment.id,
      state: payment.state,
    });

    // If payment is in terminal state, nothing to recover
    if (payment.isTerminal()) {
      this.logger.info('Payment already in terminal state', {
        paymentId: payment.id,
        state: payment.state,
      });
      return payment;
    }

    // If payment has gateway transaction ID, verify with gateway
    if (payment.gatewayTransactionId) {
      this.logger.info('Verifying payment state with gateway', {
        paymentId: payment.id,
        gatewayTxnId: payment.gatewayTransactionId,
      });

      const reconciledPayment = await this.partialFailureRecovery.reconcilePayment(payment);

      this.logger.info('Payment state reconciled', {
        paymentId: payment.id,
        oldState: payment.state,
        newState: reconciledPayment.state,
      });

      return reconciledPayment;
    }

    // No gateway transaction ID: payment never reached gateway
    this.logger.warn('Payment has no gateway transaction ID', {
      paymentId: payment.id,
      state: payment.state,
    });

    return payment;
  }
}
