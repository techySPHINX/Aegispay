/**
 * Unit Tests: Result Type and Domain Types
 * Tests the functional Result type and core domain enums
 */

import {
  Result,
  Success,
  Failure,
  ok,
  fail,
  PaymentState,
  PaymentMethodType,
  Currency,
  GatewayType,
} from '../../src/domain/types';

describe('Result Type (Functional Error Handling)', () => {
  describe('Success', () => {
    it('should create success result', () => {
      const result = ok(42);

      expect(result).toBeInstanceOf(Success);
      expect(result.isSuccess).toBe(true);
      expect(result.isFailure).toBe(false);
      expect((result as Success<number>).value).toBe(42);
    });

    it('should map success value', () => {
      const result = ok(10);
      const mapped = result.map((x) => x * 2);

      expect((mapped as Success<number>).value).toBe(20);
    });

    it('should flatMap success value', () => {
      const result = ok(10);
      const mapped = (result as Success<number>).flatMap((x: number) => ok(x * 2));

      expect((mapped as Success<number>).value).toBe(20);
    });

    it('should flatMap to failure', () => {
      const result = ok(10);
      const mapped = (result as Success<number>).flatMap((x: number) =>
        x > 5 ? fail(new Error('Too large')) : ok(x)
      );

      expect(mapped.isFailure).toBe(true);
      expect((mapped as Failure<Error>).error.message).toBe('Too large');
    });

    it('should handle string values', () => {
      const result = ok('hello');
      expect((result as Success<string>).value).toBe('hello');
    });

    it('should handle object values', () => {
      const data = { id: 1, name: 'test' };
      const result = ok(data);
      expect((result as Success<typeof data>).value).toEqual(data);
    });
  });

  describe('Failure', () => {
    it('should create failure result', () => {
      const error = new Error('Something went wrong');
      const result = fail(error);

      expect(result).toBeInstanceOf(Failure);
      expect(result.isSuccess).toBe(false);
      expect(result.isFailure).toBe(true);
      expect((result as Failure<Error>).error).toBe(error);
    });

    it('should map failure (no-op)', () => {
      const result = fail(new Error('Error'));
      const mapped = result.map((x: never) => x);

      expect(mapped.isFailure).toBe(true);
    });

    it('should flatMap failure (no-op)', () => {
      const result = fail(new Error('Error'));
      const mapped = (result as Failure<Error>).flatMap(() => ok(42));

      expect(mapped.isFailure).toBe(true);
    });

    it('should handle string errors', () => {
      const result = fail('Error message');
      expect((result as Failure<string>).error).toBe('Error message');
    });

    it('should handle custom error types', () => {
      class CustomError extends Error {
        constructor(
          message: string,
          public code: string
        ) {
          super(message);
        }
      }

      const error = new CustomError('Custom error', 'ERR_001');
      const result = fail(error);

      expect((result as Failure<CustomError>).error.code).toBe('ERR_001');
    });
  });

  describe('Type narrowing', () => {
    it('should narrow type with isSuccess', () => {
      const result: Result<number, Error> = ok(42);

      if (result.isSuccess) {
        expect((result as Success<number>).value).toBe(42);
      }
    });

    it('should narrow type with isFailure', () => {
      const result: Result<number, Error> = fail(new Error('Error'));

      if (result.isFailure) {
        expect((result as Failure<Error>).error.message).toBe('Error');
      }
    });
  });

  describe('Chaining operations', () => {
    it('should chain map operations on success', () => {
      const result = ok(10).map((x) => x * 2).map((x) => x + 5);

      expect((result as Success<number>).value).toBe(25);
    });

    it('should chain flatMap operations on success', () => {
      const step1 = (ok(10) as Success<number>).flatMap((x: number) => ok(x * 2));
      const result = (step1 as Success<number>).flatMap((x: number) => ok(x + 5));

      expect((result as Success<number>).value).toBe(25);
    });

    it('should short-circuit on first failure', () => {
      const step1 = (ok(10) as Success<number>).flatMap((x: number) => ok(x * 2));
      const step2 = (step1 as Success<number>).flatMap(() => fail(new Error('Failed')));
      const result = (step2 as Failure<Error>).flatMap((x: number) => ok(x + 5));

      expect(result.isFailure).toBe(true);
      expect((result as Failure<Error>).error.message).toBe('Failed');
    });
  });
});

describe('PaymentState Enum', () => {
  it('should have INITIATED state', () => {
    expect(PaymentState.INITIATED).toBe('INITIATED');
  });

  it('should have AUTHENTICATED state', () => {
    expect(PaymentState.AUTHENTICATED).toBe('AUTHENTICATED');
  });

  it('should have PROCESSING state', () => {
    expect(PaymentState.PROCESSING).toBe('PROCESSING');
  });

  it('should have SUCCESS state', () => {
    expect(PaymentState.SUCCESS).toBe('SUCCESS');
  });

  it('should have FAILURE state', () => {
    expect(PaymentState.FAILURE).toBe('FAILURE');
  });

  it('should have all 5 states', () => {
    const states = Object.values(PaymentState);
    expect(states).toHaveLength(5);
  });
});

describe('PaymentMethodType Enum', () => {
  it('should have CARD type', () => {
    expect(PaymentMethodType.CARD).toBe('CARD');
  });

  it('should have UPI type', () => {
    expect(PaymentMethodType.UPI).toBe('UPI');
  });

  it('should have NET_BANKING type', () => {
    expect(PaymentMethodType.NET_BANKING).toBe('NET_BANKING');
  });

  it('should have WALLET type', () => {
    expect(PaymentMethodType.WALLET).toBe('WALLET');
  });

  it('should have PAY_LATER type', () => {
    expect(PaymentMethodType.PAY_LATER).toBe('PAY_LATER');
  });

  it('should have all 5 payment method types', () => {
    const types = Object.values(PaymentMethodType);
    expect(types).toHaveLength(5);
  });
});

describe('Currency Enum', () => {
  it('should have all supported currencies', () => {
    expect(Currency.USD).toBe('USD');
    expect(Currency.EUR).toBe('EUR');
    expect(Currency.GBP).toBe('GBP');
    expect(Currency.INR).toBe('INR');
    expect(Currency.AUD).toBe('AUD');
    expect(Currency.CAD).toBe('CAD');
  });

  it('should have 6 currencies', () => {
    const currencies = Object.values(Currency);
    expect(currencies).toHaveLength(6);
  });
});

describe('GatewayType Enum', () => {
  it('should have STRIPE gateway', () => {
    expect(GatewayType.STRIPE).toBe('STRIPE');
  });

  it('should have RAZORPAY gateway', () => {
    expect(GatewayType.RAZORPAY).toBe('RAZORPAY');
  });

  it('should have PAYPAL gateway', () => {
    expect(GatewayType.PAYPAL).toBe('PAYPAL');
  });

  it('should have ADYEN gateway', () => {
    expect(GatewayType.ADYEN).toBe('ADYEN');
  });

  it('should have MOCK gateway for testing', () => {
    expect(GatewayType.MOCK).toBe('MOCK');
  });

  it('should have all 5 gateway types', () => {
    const gateways = Object.values(GatewayType);
    expect(gateways).toHaveLength(5);
  });
});
