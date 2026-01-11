/**
 * PRODUCTION-GRADE INPUT VALIDATION
 * 
 * Comprehensive validation for all inputs to prevent security issues
 * and ensure data integrity.
 */

import { Currency, PaymentMethod, PaymentMethodType, Customer } from '../domain/types';

/**
 * Validation error with detailed context
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown,
    public readonly constraints?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate payment amount
 */
export function validateAmount(amount: number): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof amount !== 'number') {
    errors.push(
      new ValidationError(
        'Amount must be a number',
        'amount',
        amount,
        { type: 'number' }
      )
    );
  } else {
    if (!Number.isFinite(amount)) {
      errors.push(
        new ValidationError(
          'Amount must be a finite number',
          'amount',
          amount,
          { finite: true }
        )
      );
    }

    if (amount <= 0) {
      errors.push(
        new ValidationError(
          'Amount must be greater than zero',
          'amount',
          amount,
          { min: 0, exclusive: true }
        )
      );
    }

    if (amount > 999999999) {
      errors.push(
        new ValidationError(
          'Amount exceeds maximum allowed value',
          'amount',
          amount,
          { max: 999999999 }
        )
      );
    }

    // Check for reasonable precision (2 decimal places max for most currencies)
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 2) {
      errors.push(
        new ValidationError(
          'Amount has too many decimal places',
          'amount',
          amount,
          { maxDecimalPlaces: 2, actual: decimalPlaces }
        )
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate currency code
 */
export function validateCurrency(currency: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof currency !== 'string') {
    errors.push(
      new ValidationError(
        'Currency must be a string',
        'currency',
        currency,
        { type: 'string' }
      )
    );
  } else {
    if (!Object.values(Currency).includes(currency as Currency)) {
      errors.push(
        new ValidationError(
          `Invalid currency code: ${currency}`,
          'currency',
          currency,
          { allowedValues: Object.values(Currency) }
        )
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate idempotency key
 */
export function validateIdempotencyKey(key: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof key !== 'string') {
    errors.push(
      new ValidationError(
        'Idempotency key must be a string',
        'idempotencyKey',
        key,
        { type: 'string' }
      )
    );
  } else {
    if (key.length === 0) {
      errors.push(
        new ValidationError(
          'Idempotency key cannot be empty',
          'idempotencyKey',
          key,
          { minLength: 1 }
        )
      );
    }

    if (key.length > 255) {
      errors.push(
        new ValidationError(
          'Idempotency key is too long',
          'idempotencyKey',
          key,
          { maxLength: 255, actual: key.length }
        )
      );
    }

    // Check for valid characters (alphanumeric, dash, underscore)
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      errors.push(
        new ValidationError(
          'Idempotency key contains invalid characters',
          'idempotencyKey',
          key,
          { allowedPattern: '^[a-zA-Z0-9_-]+$' }
        )
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate customer information
 */
export function validateCustomer(customer: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!customer || typeof customer !== 'object') {
    errors.push(
      new ValidationError(
        'Customer must be an object',
        'customer',
        customer,
        { type: 'object' }
      )
    );
    return { valid: false, errors };
  }

  const cust = customer as Customer;

  // Validate ID
  if (!cust.id || typeof cust.id !== 'string' || cust.id.trim().length === 0) {
    errors.push(
      new ValidationError(
        'Customer ID is required and must be a non-empty string',
        'customer.id',
        cust.id,
        { required: true, type: 'string', minLength: 1 }
      )
    );
  }

  // Validate email
  if (!cust.email || typeof cust.email !== 'string') {
    errors.push(
      new ValidationError(
        'Customer email is required and must be a string',
        'customer.email',
        cust.email,
        { required: true, type: 'string' }
      )
    );
  } else {
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cust.email)) {
      errors.push(
        new ValidationError(
          'Invalid email format',
          'customer.email',
          cust.email,
          { pattern: emailRegex.source }
        )
      );
    }
  }

  // Validate phone if provided
  if (cust.phone !== undefined) {
    if (typeof cust.phone !== 'string') {
      errors.push(
        new ValidationError(
          'Customer phone must be a string',
          'customer.phone',
          cust.phone,
          { type: 'string' }
        )
      );
    } else if (cust.phone.length > 0 && cust.phone.length < 10) {
      errors.push(
        new ValidationError(
          'Customer phone number is too short',
          'customer.phone',
          cust.phone,
          { minLength: 10 }
        )
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate payment method
 */
export function validatePaymentMethod(paymentMethod: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!paymentMethod || typeof paymentMethod !== 'object') {
    errors.push(
      new ValidationError(
        'Payment method must be an object',
        'paymentMethod',
        paymentMethod,
        { type: 'object' }
      )
    );
    return { valid: false, errors };
  }

  const pm = paymentMethod as PaymentMethod;

  if (!pm.type || !Object.values(PaymentMethodType).includes(pm.type)) {
    errors.push(
      new ValidationError(
        'Invalid payment method type',
        'paymentMethod.type',
        pm.type,
        { allowedValues: Object.values(PaymentMethodType) }
      )
    );
  }

  // Validate method-specific details
  if (pm.type === PaymentMethodType.CARD) {
    const details = pm.details;
    if (!details || typeof details !== 'object') {
      errors.push(
        new ValidationError(
          'Card details are required',
          'paymentMethod.details',
          details,
          { required: true, type: 'object' }
        )
      );
    } else {
      // Basic card validation (in production, use proper validation library)
      if (!details.cardNumber || typeof details.cardNumber !== 'string') {
        errors.push(
          new ValidationError(
            'Card number is required',
            'paymentMethod.details.cardNumber',
            details.cardNumber,
            { required: true, type: 'string' }
          )
        );
      }

      if (!details.expiryMonth || !details.expiryYear) {
        errors.push(
          new ValidationError(
            'Card expiry date is required',
            'paymentMethod.details.expiry',
            { month: details.expiryMonth, year: details.expiryYear },
            { required: true }
          )
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate payment ID format
 */
export function validatePaymentId(paymentId: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof paymentId !== 'string') {
    errors.push(
      new ValidationError(
        'Payment ID must be a string',
        'paymentId',
        paymentId,
        { type: 'string' }
      )
    );
  } else {
    if (paymentId.length === 0) {
      errors.push(
        new ValidationError(
          'Payment ID cannot be empty',
          'paymentId',
          paymentId,
          { minLength: 1 }
        )
      );
    }

    // Validate format if using generated IDs
    if (!paymentId.startsWith('pay_')) {
      errors.push(
        new ValidationError(
          'Payment ID must start with "pay_"',
          'paymentId',
          paymentId,
          { prefix: 'pay_' }
        )
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize metadata to prevent injection attacks
 */
export function sanitizeMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    // Limit key length
    if (key.length > 128) {
      continue;
    }

    // Only allow alphanumeric keys with underscores
    if (!/^[a-zA-Z0-9_]+$/.test(key)) {
      continue;
    }

    // Sanitize values based on type
    if (typeof value === 'string') {
      // Limit string length
      sanitized[key] = value.length > 1000 ? value.substring(0, 1000) : value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (typeof value === 'boolean') {
      sanitized[key] = value;
    }
    // Ignore complex objects, arrays, etc.
  }

  return sanitized;
}
