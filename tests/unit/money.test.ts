/**
 * Unit Tests: Money Value Object
 * Tests the immutable Money value object for monetary calculations
 */

import { Money, Currency } from '../../src/domain/types';

describe('Money Value Object', () => {
  describe('Constructor', () => {
    it('should create money with valid amount and currency', () => {
      const money = new Money(100, Currency.USD);
      expect(money.amount).toBe(100);
      expect(money.currency).toBe(Currency.USD);
    });

    it('should round amount to 2 decimal places', () => {
      const money = new Money(100.999, Currency.USD);
      expect(money.amount).toBe(101);
    });

    it('should throw error for negative amount', () => {
      expect(() => new Money(-100, Currency.USD)).toThrow(
        'Money amount cannot be negative'
      );
    });

    it('should throw error for non-finite amount', () => {
      expect(() => new Money(Infinity, Currency.USD)).toThrow(
        'Money amount must be a finite number'
      );
      expect(() => new Money(NaN, Currency.USD)).toThrow(
        'Money amount must be a finite number'
      );
    });

    it('should handle zero amount', () => {
      const money = new Money(0, Currency.USD);
      expect(money.amount).toBe(0);
    });
  });

  describe('add', () => {
    it('should add two money objects with same currency', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(50, Currency.USD);
      const result = money1.add(money2);

      expect(result.amount).toBe(150);
      expect(result.currency).toBe(Currency.USD);
    });

    it('should throw error when adding different currencies', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(50, Currency.EUR);

      expect(() => money1.add(money2)).toThrow('Currency mismatch: USD vs EUR');
    });

    it('should not mutate original objects', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(50, Currency.USD);
      const result = money1.add(money2);

      expect(money1.amount).toBe(100);
      expect(money2.amount).toBe(50);
      expect(result).not.toBe(money1);
      expect(result).not.toBe(money2);
    });
  });

  describe('subtract', () => {
    it('should subtract two money objects with same currency', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(30, Currency.USD);
      const result = money1.subtract(money2);

      expect(result.amount).toBe(70);
      expect(result.currency).toBe(Currency.USD);
    });

    it('should throw error when subtraction results in negative amount', () => {
      const money1 = new Money(50, Currency.USD);
      const money2 = new Money(100, Currency.USD);

      expect(() => money1.subtract(money2)).toThrow(
        'Money amount cannot be negative'
      );
    });

    it('should throw error when subtracting different currencies', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(50, Currency.GBP);

      expect(() => money1.subtract(money2)).toThrow('Currency mismatch: USD vs GBP');
    });
  });

  describe('multiply', () => {
    it('should multiply money by a factor', () => {
      const money = new Money(100, Currency.USD);
      const result = money.multiply(2);

      expect(result.amount).toBe(200);
      expect(result.currency).toBe(Currency.USD);
    });

    it('should handle fractional multiplication', () => {
      const money = new Money(100, Currency.USD);
      const result = money.multiply(0.5);

      expect(result.amount).toBe(50);
    });

    it('should round result to 2 decimal places', () => {
      const money = new Money(100, Currency.USD);
      const result = money.multiply(1.333);

      expect(result.amount).toBe(133.3);
    });

    it('should handle zero multiplication', () => {
      const money = new Money(100, Currency.USD);
      const result = money.multiply(0);

      expect(result.amount).toBe(0);
    });
  });

  describe('equals', () => {
    it('should return true for equal money objects', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(100, Currency.USD);

      expect(money1.equals(money2)).toBe(true);
    });

    it('should return false for different amounts', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(200, Currency.USD);

      expect(money1.equals(money2)).toBe(false);
    });

    it('should return false for different currencies', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(100, Currency.EUR);

      expect(money1.equals(money2)).toBe(false);
    });
  });

  describe('isGreaterThan', () => {
    it('should return true when amount is greater', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(50, Currency.USD);

      expect(money1.isGreaterThan(money2)).toBe(true);
    });

    it('should return false when amount is less', () => {
      const money1 = new Money(50, Currency.USD);
      const money2 = new Money(100, Currency.USD);

      expect(money1.isGreaterThan(money2)).toBe(false);
    });

    it('should return false when amounts are equal', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(100, Currency.USD);

      expect(money1.isGreaterThan(money2)).toBe(false);
    });

    it('should throw error for different currencies', () => {
      const money1 = new Money(100, Currency.USD);
      const money2 = new Money(50, Currency.INR);

      expect(() => money1.isGreaterThan(money2)).toThrow(
        'Currency mismatch: USD vs INR'
      );
    });
  });

  describe('JSON serialization', () => {
    it('should serialize to JSON', () => {
      const money = new Money(100, Currency.USD);
      const json = money.toJSON();

      expect(json).toEqual({
        amount: 100,
        currency: 'USD',
      });
    });

    it('should deserialize from JSON', () => {
      const json = { amount: 100, currency: 'USD' };
      const money = Money.fromJSON(json);

      expect(money.amount).toBe(100);
      expect(money.currency).toBe(Currency.USD);
    });

    it('should round-trip through JSON', () => {
      const original = new Money(123.45, Currency.EUR);
      const json = original.toJSON();
      const restored = Money.fromJSON(json);

      expect(restored.equals(original)).toBe(true);
    });
  });

  describe('All supported currencies', () => {
    it('should support USD currency', () => {
      const money = new Money(100, Currency.USD);
      expect(money.currency).toBe(Currency.USD);
    });

    it('should support EUR currency', () => {
      const money = new Money(100, Currency.EUR);
      expect(money.currency).toBe(Currency.EUR);
    });

    it('should support GBP currency', () => {
      const money = new Money(100, Currency.GBP);
      expect(money.currency).toBe(Currency.GBP);
    });

    it('should support INR currency', () => {
      const money = new Money(100, Currency.INR);
      expect(money.currency).toBe(Currency.INR);
    });

    it('should support AUD currency', () => {
      const money = new Money(100, Currency.AUD);
      expect(money.currency).toBe(Currency.AUD);
    });

    it('should support CAD currency', () => {
      const money = new Money(100, Currency.CAD);
      expect(money.currency).toBe(Currency.CAD);
    });
  });
});
