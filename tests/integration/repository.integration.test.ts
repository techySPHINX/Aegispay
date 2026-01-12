/**
 * Integration Tests: Basic Repository Operations
 * Tests payment repository persistence and querying
 */

import { InMemoryPaymentRepository } from '../../src/infra/db';
import { Payment } from '../../src/domain/payment';
import { PaymentState, Currency, PaymentMethodType, Money } from '../../src/domain/types';

describe('Payment Repository Integration', () => {
  let repository: InMemoryPaymentRepository;

  beforeEach(() => {
    repository = new InMemoryPaymentRepository();
  });

  it('should save and retrieve payment', async () => {
    const payment = new Payment({
      id: 'pay_001',
      idempotencyKey: 'idem_001',
      state: PaymentState.INITIATED,
      amount: new Money(5000, Currency.USD),
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'Test User',
        },
      },
      customer: {
        id: 'cust_001',
        email: 'test@example.com',
        name: 'Test User',
      },
    });

    await repository.save(payment);
    const retrieved = await repository.findById('pay_001');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('pay_001');
  });

  it('should prevent duplicate idempotency keys', async () => {
    const payment1 = new Payment({
      id: 'pay_002',
      idempotencyKey: 'idem_dup',
      state: PaymentState.INITIATED,
      amount: new Money(5000, Currency.USD),
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'Test',
        },
      },
      customer: {
        id: 'cust_002',
        email: 'test@example.com',
        name: 'Test',
      },
    });

    const payment2 = new Payment({
      id: 'pay_003',
      idempotencyKey: 'idem_dup',
      state: PaymentState.INITIATED,
      amount: new Money(5000, Currency.USD),
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'Test',
        },
      },
      customer: {
        id: 'cust_003',
        email: 'test@example.com',
        name: 'Test',
      },
    });

    await repository.save(payment1);
    await expect(repository.save(payment2)).rejects.toThrow();
  });

  it('should find payments by customer', async () => {
    const customerId = 'cust_multi';

    for (let i = 0; i < 3; i++) {
      const payment = new Payment({
        id: `pay_multi_${i}`,
        idempotencyKey: `idem_multi_${i}`,
        state: PaymentState.INITIATED,
        amount: new Money(1000, Currency.USD),
        paymentMethod: {
          type: PaymentMethodType.CARD,
          details: {
            cardNumber: '4242424242424242',
            expiryMonth: '12',
            expiryYear: '2025',
            cvv: '123',
            cardHolderName: 'Test',
          },
        },
        customer: {
          id: customerId,
          email: 'multi@example.com',
          name: 'Multi Test',
        },
      });
      await repository.save(payment);
    }

    const payments = await repository.findByCustomerId(customerId);
    expect(payments.length).toBe(3);
  });

  it('should handle concurrent operations', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      const payment = new Payment({
        id: `pay_concurrent_${i}`,
        idempotencyKey: `idem_concurrent_${i}`,
        state: PaymentState.INITIATED,
        amount: new Money(1000, Currency.USD),
        paymentMethod: {
          type: PaymentMethodType.CARD,
          details: {
            cardNumber: '4242424242424242',
            expiryMonth: '12',
            expiryYear: '2025',
            cvv: '123',
            cardHolderName: 'Test',
          },
        },
        customer: {
          id: `cust_${i}`,
          email: `test${i}@example.com`,
          name: 'Test',
        },
      });
      promises.push(repository.save(payment));
    }

    await Promise.all(promises);

    for (let i = 0; i < 10; i++) {
      const retrieved = await repository.findById(`pay_concurrent_${i}`);
      expect(retrieved).not.toBeNull();
    }
  });
});
