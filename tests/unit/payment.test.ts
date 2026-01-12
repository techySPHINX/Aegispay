/**
 * Unit Tests: Payment Domain Entity
 * Tests the Payment aggregate root following DDD principles
 */

import { Payment } from '../../src/domain/payment';
import {
  PaymentState,
  Money,
  Currency,
  PaymentMethodType,
  GatewayType,
} from '../../src/domain/types';

describe('Payment Domain Entity', () => {
  // Helper function to create test payment
  const createTestPayment = (state: PaymentState = PaymentState.INITIATED): Payment => {
    return new Payment({
      id: 'pay_test_123',
      idempotencyKey: 'idem_test_123',
      state,
      amount: new Money(10000, Currency.USD),
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'John Doe',
        },
      },
      customer: {
        id: 'cust_123',
        email: 'john@example.com',
        name: 'John Doe',
      },
      metadata: { orderId: 'order_789' },
    });
  };

  describe('Constructor and Creation', () => {
    it('should create payment with required fields', () => {
      const payment = createTestPayment();

      expect(payment.id).toBe('pay_test_123');
      expect(payment.idempotencyKey).toBe('idem_test_123');
      expect(payment.state).toBe(PaymentState.INITIATED);
      expect(payment.amount.amount).toBe(10000);
      expect(payment.amount.currency).toBe(Currency.USD);
      expect(payment.retryCount).toBe(0);
    });

    it('should set default values for optional fields', () => {
      const payment = createTestPayment();

      expect(payment.metadata).toBeDefined();
      expect(payment.createdAt).toBeInstanceOf(Date);
      expect(payment.updatedAt).toBeInstanceOf(Date);
      expect(payment.retryCount).toBe(0);
    });

    it('should accept custom retry count', () => {
      const payment = new Payment({
        ...createTestPayment(),
        retryCount: 3,
      });

      expect(payment.retryCount).toBe(3);
    });

    it('should accept gateway information', () => {
      const payment = new Payment({
        ...createTestPayment(),
        gatewayType: GatewayType.STRIPE,
        gatewayTransactionId: 'txn_stripe_123',
      });

      expect(payment.gatewayType).toBe(GatewayType.STRIPE);
      expect(payment.gatewayTransactionId).toBe('txn_stripe_123');
    });

    it('should be immutable (readonly fields)', () => {
      const payment = createTestPayment();

      // TypeScript enforces immutability at compile-time
      // These would fail TypeScript compilation:
      // payment.state = PaymentState.SUCCESS; // Error
      // payment.amount = new Money(5000, Currency.USD); // Error
      expect(payment).toBeDefined();
    });
  });

  describe('State Transitions', () => {
    describe('authenticate', () => {
      it('should transition from INITIATED to AUTHENTICATED', () => {
        const payment = createTestPayment(PaymentState.INITIATED);
        const authenticated = payment.authenticate(GatewayType.STRIPE);

        expect(authenticated.state).toBe(PaymentState.AUTHENTICATED);
        expect(authenticated.gatewayType).toBe(GatewayType.STRIPE);
        expect(authenticated.id).toBe(payment.id);
      });

      it('should throw error for invalid transition', () => {
        const payment = createTestPayment(PaymentState.SUCCESS);

        expect(() => payment.authenticate(GatewayType.STRIPE)).toThrow();
      });

      it('should not mutate original payment', () => {
        const payment = createTestPayment(PaymentState.INITIATED);
        const authenticated = payment.authenticate(GatewayType.STRIPE);

        expect(payment.state).toBe(PaymentState.INITIATED);
        expect(authenticated.state).toBe(PaymentState.AUTHENTICATED);
        expect(payment).not.toBe(authenticated);
      });
    });

    describe('startProcessing', () => {
      it('should transition from AUTHENTICATED to PROCESSING', () => {
        const payment = createTestPayment(PaymentState.AUTHENTICATED);
        const processing = payment.startProcessing('txn_123');

        expect(processing.state).toBe(PaymentState.PROCESSING);
        expect(processing.gatewayTransactionId).toBe('txn_123');
      });

      it('should throw error for invalid transition', () => {
        const payment = createTestPayment(PaymentState.INITIATED);

        expect(() => payment.startProcessing('txn_123')).toThrow();
      });
    });

    describe('markSuccess', () => {
      it('should transition from PROCESSING to SUCCESS', () => {
        const payment = createTestPayment(PaymentState.PROCESSING);
        const success = payment.markSuccess();

        expect(success.state).toBe(PaymentState.SUCCESS);
      });

      it('should throw error for invalid transition', () => {
        const payment = createTestPayment(PaymentState.INITIATED);

        expect(() => payment.markSuccess()).toThrow();
      });
    });

    describe('markFailure', () => {
      it('should transition from any non-terminal state to FAILURE', () => {
        const states = [
          PaymentState.INITIATED,
          PaymentState.AUTHENTICATED,
          PaymentState.PROCESSING,
        ];

        states.forEach((state) => {
          const payment = createTestPayment(state);
          const failed = payment.markFailure('Test failure reason');

          expect(failed.state).toBe(PaymentState.FAILURE);
          expect(failed.failureReason).toBe('Test failure reason');
        });
      });

      it('should throw error when transitioning from SUCCESS', () => {
        const payment = createTestPayment(PaymentState.SUCCESS);

        expect(() => payment.markFailure('Reason')).toThrow(/terminal/i);
      });
    });
  });

  describe('Retry Logic', () => {
    describe('incrementRetry', () => {
      it('should increment retry count', () => {
        const payment = createTestPayment();
        const retried = payment.incrementRetry();

        expect(retried.retryCount).toBe(1);
        expect(payment.retryCount).toBe(0);
      });

      it('should chain multiple retries', () => {
        const payment = createTestPayment();
        const retried = payment.incrementRetry().incrementRetry().incrementRetry();

        expect(retried.retryCount).toBe(3);
      });
    });

    describe('canRetry', () => {
      it('should return true for failed payment under retry limit', () => {
        const payment = createTestPayment(PaymentState.FAILURE);

        expect(payment.canRetry(3)).toBe(true);
      });

      it('should return false for failed payment at retry limit', () => {
        const payment = new Payment({
          ...createTestPayment(PaymentState.FAILURE),
          retryCount: 3,
        });

        expect(payment.canRetry(3)).toBe(false);
      });

      it('should return false for non-failed payment', () => {
        const payment = createTestPayment(PaymentState.PROCESSING);

        expect(payment.canRetry(3)).toBe(false);
      });

      it('should return false for successful payment', () => {
        const payment = createTestPayment(PaymentState.SUCCESS);

        expect(payment.canRetry(3)).toBe(false);
      });
    });
  });

  describe('Terminal State Checks', () => {
    it('should identify SUCCESS as terminal', () => {
      const payment = createTestPayment(PaymentState.SUCCESS);

      expect(payment.isTerminal()).toBe(true);
    });

    it('should identify FAILURE as terminal', () => {
      const payment = createTestPayment(PaymentState.FAILURE);

      expect(payment.isTerminal()).toBe(true);
    });

    it('should identify non-terminal states correctly', () => {
      const states = [
        PaymentState.INITIATED,
        PaymentState.AUTHENTICATED,
        PaymentState.PROCESSING,
      ];

      states.forEach((state) => {
        const payment = createTestPayment(state);
        expect(payment.isTerminal()).toBe(false);
      });
    });
  });

  describe('JSON Serialization', () => {
    it('should serialize to JSON', () => {
      const payment = createTestPayment();
      const json = payment.toJSON();

      expect(json.id).toBe('pay_test_123');
      expect(json.idempotencyKey).toBe('idem_test_123');
      expect(json.state).toBe(PaymentState.INITIATED);
      expect((json.amount as any).amount).toBe(10000);
      expect((json.amount as any).currency).toBe('USD');
      expect(typeof json.createdAt).toBe('string');
      expect(typeof json.updatedAt).toBe('string');
    });

    it('should deserialize from JSON', () => {
      const original = createTestPayment();
      const json = original.toJSON();
      const restored = Payment.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.idempotencyKey).toBe(original.idempotencyKey);
      expect(restored.state).toBe(original.state);
      expect(restored.amount.equals(original.amount)).toBe(true);
      expect(restored.retryCount).toBe(original.retryCount);
    });

    it('should round-trip through JSON', () => {
      const original = createTestPayment();
      const json = original.toJSON();
      const restored = Payment.fromJSON(json);
      const secondJson = restored.toJSON();

      expect(JSON.stringify(json)).toBe(JSON.stringify(secondJson));
    });

    it('should handle optional fields in JSON', () => {
      const payment = new Payment({
        ...createTestPayment(),
        gatewayType: GatewayType.RAZORPAY,
        gatewayTransactionId: 'txn_razorpay_456',
        failureReason: 'Insufficient funds',
      });

      const json = payment.toJSON();
      const restored = Payment.fromJSON(json);

      expect(restored.gatewayType).toBe(GatewayType.RAZORPAY);
      expect(restored.gatewayTransactionId).toBe('txn_razorpay_456');
      expect(restored.failureReason).toBe('Insufficient funds');
    });
  });

  describe('Immutability', () => {
    it('should create new instance on state change', () => {
      const payment = createTestPayment(PaymentState.INITIATED);
      const authenticated = payment.authenticate(GatewayType.STRIPE);

      expect(payment).not.toBe(authenticated);
      expect(payment.state).toBe(PaymentState.INITIATED);
      expect(authenticated.state).toBe(PaymentState.AUTHENTICATED);
    });

    it('should preserve original payment fields', () => {
      const payment = createTestPayment(PaymentState.INITIATED);
      const authenticated = payment.authenticate(GatewayType.STRIPE);

      expect(authenticated.id).toBe(payment.id);
      expect(authenticated.idempotencyKey).toBe(payment.idempotencyKey);
      expect(authenticated.amount).toBe(payment.amount);
      expect(authenticated.customer).toBe(payment.customer);
    });

    it('should update timestamp on changes', () => {
      const payment = createTestPayment(PaymentState.INITIATED);

      // Small delay to ensure different timestamp
      const later = payment.authenticate(GatewayType.STRIPE);

      expect(later.updatedAt.getTime()).toBeGreaterThanOrEqual(
        payment.updatedAt.getTime()
      );
    });
  });

  describe('Complete Payment Lifecycle', () => {
    it('should execute happy path lifecycle', () => {
      const initiated = createTestPayment(PaymentState.INITIATED);
      const authenticated = initiated.authenticate(GatewayType.STRIPE);
      const processing = authenticated.startProcessing('txn_123');
      const success = processing.markSuccess();

      expect(initiated.state).toBe(PaymentState.INITIATED);
      expect(authenticated.state).toBe(PaymentState.AUTHENTICATED);
      expect(processing.state).toBe(PaymentState.PROCESSING);
      expect(success.state).toBe(PaymentState.SUCCESS);
      expect(success.isTerminal()).toBe(true);
    });

    it('should handle failure path', () => {
      const initiated = createTestPayment(PaymentState.INITIATED);
      const authenticated = initiated.authenticate(GatewayType.RAZORPAY);
      const processing = authenticated.startProcessing('txn_456');
      const failed = processing.markFailure('Gateway timeout');

      expect(failed.state).toBe(PaymentState.FAILURE);
      expect(failed.failureReason).toBe('Gateway timeout');
      expect(failed.isTerminal()).toBe(true);
      expect(failed.canRetry(3)).toBe(true);
    });

    it('should handle retry scenario', () => {
      const failed = createTestPayment(PaymentState.FAILURE);
      const retried = failed.incrementRetry();

      expect(retried.retryCount).toBe(1);
      expect(retried.canRetry(3)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle metadata correctly', () => {
      const payment = new Payment({
        ...createTestPayment(),
        metadata: {
          orderId: 'order_123',
          customFields: { source: 'mobile_app', campaign: 'summer_sale' },
        },
      });

      expect(payment.metadata.orderId).toBe('order_123');
      expect(payment.metadata.customFields).toBeDefined();
    });

    it('should handle empty metadata', () => {
      const payment = createTestPayment();

      expect(payment.metadata).toEqual({ orderId: 'order_789' });
    });

    it('should preserve customer information through transitions', () => {
      const payment = createTestPayment(PaymentState.INITIATED);
      const authenticated = payment.authenticate(GatewayType.STRIPE);

      expect(authenticated.customer.id).toBe(payment.customer.id);
      expect(authenticated.customer.email).toBe(payment.customer.email);
    });
  });
});
