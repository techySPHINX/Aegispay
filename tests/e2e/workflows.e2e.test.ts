/**
 * E2E Tests: SDK Complete Workflows
 * Tests full payment workflows using the AegisPay SDK
 */

import { AegisPay } from '../../src/index';
import { Currency, PaymentMethodType, PaymentState, GatewayType } from '../../src/domain/types';
import { LogLevel } from '../../src/infra/observability';

describe('AegisPay E2E Workflows', () => {
  let sdk: AegisPay;

  beforeEach(() => {
    sdk = new AegisPay({
      logging: { level: LogLevel.ERROR, enabled: false },
      events: { logToConsole: false },
    });

    // Register mock gateway for testing
    sdk.registerGateway(GatewayType.MOCK, { apiKey: 'test_key' });
  });

  // Helper to generate valid idempotency keys (alphanumeric, dash, underscore only)
  const generateIdempotencyKey = (prefix: string) =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  it('should create and process payment', async () => {
    const payment = await sdk.createPayment({
      idempotencyKey: generateIdempotencyKey('idem'),
      amount: 10000,
      currency: Currency.USD,
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
        id: 'cust_001',
        email: 'john@example.com',
        name: 'John Doe',
      },
    });

    expect(payment.state).toBe(PaymentState.INITIATED);

    const processed = await sdk.processPayment({ paymentId: payment.id });
    expect(processed.state).toBe(PaymentState.SUCCESS);
  });

  it('should handle idempotency', async () => {
    const idempotencyKey = generateIdempotencyKey('idem_dup');
    const request = {
      idempotencyKey,
      amount: 5000,
      currency: Currency.USD,
      paymentMethod: {
        type: PaymentMethodType.CARD as const,
        details: {
          cardNumber: '4242424242424242',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'Jane Doe',
        },
      },
      customer: {
        id: 'cust_002',
        email: 'jane@example.com',
        name: 'Jane Doe',
      },
    };

    const payment1 = await sdk.createPayment(request);
    const payment2 = await sdk.createPayment(request);

    expect(payment1.id).toBe(payment2.id);
  });

  it('should retrieve payment', async () => {
    const payment = await sdk.createPayment({
      idempotencyKey: `idem_retrieve_${Date.now()}`,
      amount: 3000,
      currency: Currency.USD,
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'Bob Smith',
        },
      },
      customer: {
        id: 'cust_003',
        email: 'bob@example.com',
        name: 'Bob Smith',
      },
    });

    const retrieved = await sdk.getPayment(payment.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(payment.id);
  });

  it('should list customer payments', async () => {
    const customerId = `cust_list_${Date.now()}`;

    for (let i = 0; i < 3; i++) {
      await sdk.createPayment({
        idempotencyKey: generateIdempotencyKey(`idem_list_${i}`),
        amount: 1000 * (i + 1),
        currency: Currency.USD,
        paymentMethod: {
          type: PaymentMethodType.CARD,
          details: {
            cardNumber: '4242424242424242',
            expiryMonth: '12',
            expiryYear: '2025',
            cvv: '123',
            cardHolderName: 'List Test',
          },
        },
        customer: {
          id: customerId,
          email: 'list@example.com',
          name: 'List Test',
        },
      });
    }

    const payments = await sdk.getCustomerPayments(customerId);
    expect(payments.length).toBeGreaterThanOrEqual(3);
  });

  it('should handle concurrent requests', async () => {
    const promises = [];

    for (let i = 0; i < 10; i++) {
      promises.push(
        sdk.createPayment({
          idempotencyKey: generateIdempotencyKey(`idem_concurrent_${i}`),
          amount: 1000,
          currency: Currency.USD,
          paymentMethod: {
            type: PaymentMethodType.CARD,
            details: {
              cardNumber: '4242424242424242',
              expiryMonth: '12',
              expiryYear: '2025',
              cvv: '123',
              cardHolderName: `User ${i}`,
            },
          },
          customer: {
            id: `cust_${i}`,
            email: `user${i}@example.com`,
            name: `User ${i}`,
          },
        })
      );
    }

    const payments = await Promise.all(promises);
    expect(payments.length).toBe(10);

    const ids = new Set(payments.map(p => p.id));
    expect(ids.size).toBe(10);
  });

  it('should validate payment data', async () => {
    await expect(
      sdk.createPayment({
        idempotencyKey: generateIdempotencyKey('idem_invalid'),
        amount: -1000,
        currency: Currency.USD,
        paymentMethod: {
          type: PaymentMethodType.CARD,
          details: {
            cardNumber: '4242424242424242',
            expiryMonth: '12',
            expiryYear: '2025',
            cvv: '123',
            cardHolderName: 'Invalid',
          },
        },
        customer: {
          id: 'cust_invalid',
          email: 'invalid@example.com',
          name: 'Invalid',
        },
      })
    ).rejects.toThrow();
  });
});
