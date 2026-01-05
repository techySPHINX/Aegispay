import { Payment } from '../domain/payment';
import { PaymentState } from '../domain/types';

/**
 * Payment Repository interface for persistence
 * Following Repository pattern for data access
 */
export interface PaymentRepository {
  /**
   * Save a new payment
   */
  save(payment: Payment): Promise<Payment>;

  /**
   * Update an existing payment
   */
  update(payment: Payment): Promise<Payment>;

  /**
   * Find payment by ID
   */
  findById(id: string): Promise<Payment | null>;

  /**
   * Find payment by idempotency key
   */
  findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null>;

  /**
   * Find payment by gateway transaction ID
   */
  findByGatewayTransactionId(gatewayTransactionId: string): Promise<Payment | null>;

  /**
   * Find payments by customer ID
   */
  findByCustomerId(customerId: string, limit?: number): Promise<Payment[]>;

  /**
   * Find payments by state
   */
  findByState(state: PaymentState, limit?: number): Promise<Payment[]>;

  /**
   * Delete a payment (should be used carefully)
   */
  delete(id: string): Promise<boolean>;
}

/**
 * In-Memory Payment Repository
 * Useful for testing and development
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  private payments: Map<string, Payment> = new Map();
  private idempotencyIndex: Map<string, string> = new Map(); // idempotencyKey -> paymentId
  private gatewayTxnIndex: Map<string, string> = new Map(); // gatewayTxnId -> paymentId

  async save(payment: Payment): Promise<Payment> {
    // Check for duplicate idempotency key
    const existingPayment = await this.findByIdempotencyKey(payment.idempotencyKey);
    if (existingPayment) {
      throw new Error(
        `Payment with idempotency key ${payment.idempotencyKey} already exists`
      );
    }

    this.payments.set(payment.id, payment);
    this.idempotencyIndex.set(payment.idempotencyKey, payment.id);

    if (payment.gatewayTransactionId) {
      this.gatewayTxnIndex.set(payment.gatewayTransactionId, payment.id);
    }

    return payment;
  }

  async update(payment: Payment): Promise<Payment> {
    const existing = this.payments.get(payment.id);
    if (!existing) {
      throw new Error(`Payment with id ${payment.id} not found`);
    }

    this.payments.set(payment.id, payment);

    // Update gateway transaction index if changed
    if (payment.gatewayTransactionId) {
      this.gatewayTxnIndex.set(payment.gatewayTransactionId, payment.id);
    }

    return payment;
  }

  async findById(id: string): Promise<Payment | null> {
    return this.payments.get(id) || null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    const paymentId = this.idempotencyIndex.get(idempotencyKey);
    if (!paymentId) return null;
    return this.payments.get(paymentId) || null;
  }

  async findByGatewayTransactionId(gatewayTransactionId: string): Promise<Payment | null> {
    const paymentId = this.gatewayTxnIndex.get(gatewayTransactionId);
    if (!paymentId) return null;
    return this.payments.get(paymentId) || null;
  }

  async findByCustomerId(customerId: string, limit: number = 100): Promise<Payment[]> {
    const payments = Array.from(this.payments.values())
      .filter((payment) => payment.customer.id === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);

    return payments;
  }

  async findByState(state: PaymentState, limit: number = 100): Promise<Payment[]> {
    const payments = Array.from(this.payments.values())
      .filter((payment) => payment.state === state)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);

    return payments;
  }

  async delete(id: string): Promise<boolean> {
    const payment = this.payments.get(id);
    if (!payment) return false;

    this.payments.delete(id);
    this.idempotencyIndex.delete(payment.idempotencyKey);
    if (payment.gatewayTransactionId) {
      this.gatewayTxnIndex.delete(payment.gatewayTransactionId);
    }

    return true;
  }

  /**
   * Clear all payments (for testing)
   */
  clear(): void {
    this.payments.clear();
    this.idempotencyIndex.clear();
    this.gatewayTxnIndex.clear();
  }

  /**
   * Get all payments (for testing)
   */
  getAll(): Payment[] {
    return Array.from(this.payments.values());
  }

  /**
   * Get payment count
   */
  count(): number {
    return this.payments.size;
  }
}

/**
 * Transaction manager for ensuring atomicity
 */
export interface TransactionManager {
  /**
   * Execute operations within a transaction
   */
  executeInTransaction<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Simple in-memory transaction manager
 */
export class InMemoryTransactionManager implements TransactionManager {
  async executeInTransaction<T>(operation: () => Promise<T>): Promise<T> {
    // In a real implementation, this would manage database transactions
    // For in-memory, we just execute the operation
    return await operation();
  }
}
