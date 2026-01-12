/**
 * IDEMPOTENCY ENGINE - Interview Gold ⭐
 *
 * This module implements a production-grade idempotency mechanism that guarantees
 * no double charges even under:
 * - Network retries
 * - Client retries
 * - Service crashes and restarts
 * - Concurrent duplicate requests
 * - Partial failures
 *
 * Key Guarantees:
 * 1. At-most-once execution for idempotent operations
 * 2. Consistent response for duplicate requests
 * 3. Thread-safe handling of concurrent duplicates
 * 4. Persistence across service restarts
 * 5. Request fingerprinting to detect tampering
 *
 * Based on Stripe's idempotency implementation:
 * https://stripe.com/docs/api/idempotent_requests
 */

import crypto from 'crypto';
import { LockManager } from './lockManager';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Idempotency key scoped to merchant and operation
 * Format: {merchantId}:{operation}:{uniqueKey}
 */
export interface IdempotencyKey {
  merchantId: string;
  operation: string;
  key: string;
}

/**
 * Request fingerprint - detects if request body changed
 */
export interface RequestFingerprint {
  hash: string;
  algorithm: 'sha256';
  timestamp: Date;
}

/**
 * Idempotency record states
 */
export enum IdempotencyState {
  PROCESSING = 'PROCESSING', // Request currently being processed
  COMPLETED = 'COMPLETED', // Request completed successfully
  FAILED = 'FAILED', // Request failed permanently
}

/**
 * Stored idempotency record
 */
export interface IdempotencyRecord<TRequest = unknown, TResponse = unknown> {
  idempotencyKey: string;
  merchantId: string;
  operation: string;
  state: IdempotencyState;
  requestFingerprint: RequestFingerprint;
  requestBody: TRequest;
  responseBody?: TResponse;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  expiresAt: Date;
}

/**
 * Idempotency configuration
 */
export interface IdempotencyConfig {
  /** Time-to-live for idempotency records (default: 24 hours) */
  ttl: number;
  /** Lock timeout for concurrent requests (default: 30 seconds) */
  lockTimeout: number;
  /** Retry interval when waiting for in-flight request (default: 100ms) */
  retryInterval: number;
  /** Maximum retries when waiting for in-flight request (default: 300 = 30s) */
  maxRetries: number;
}

/**
 * Idempotency result
 */
export type IdempotencyResult<TResponse> =
  | { type: 'NEW'; record: IdempotencyRecord }
  | { type: 'DUPLICATE_SUCCESS'; response: TResponse; record: IdempotencyRecord }
  | { type: 'DUPLICATE_PROCESSING'; record: IdempotencyRecord }
  | { type: 'DUPLICATE_FAILED'; error: Error; record: IdempotencyRecord }
  | { type: 'FINGERPRINT_MISMATCH'; expected: string; actual: string };

// ============================================================================
// IDEMPOTENCY STORE
// ============================================================================

/**
 * Idempotency store interface
 * In production, implement with:
 * - Redis (recommended for speed + TTL)
 * - PostgreSQL (for durability)
 * - DynamoDB (for scalability)
 */
export interface IdempotencyStore {
  /**
   * Get idempotency record by key
   */
  get(key: string): Promise<IdempotencyRecord | null>;

  /**
   * Create new idempotency record (atomic operation)
   * Returns false if key already exists
   */
  create(record: IdempotencyRecord): Promise<boolean>;

  /**
   * Update existing record (atomic operation)
   * Only updates if current state matches expectedState
   */
  updateState(
    key: string,
    expectedState: IdempotencyState,
    updates: Partial<IdempotencyRecord>
  ): Promise<boolean>;

  /**
   * Delete expired records (cleanup)
   */
  deleteExpired(): Promise<number>;
}

/**
 * In-memory idempotency store
 * For production, use Redis or PostgreSQL
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private records: Map<string, IdempotencyRecord> = new Map();

  async get(key: string): Promise<IdempotencyRecord | null> {
    const record = this.records.get(key);
    if (!record) return null;

    // Check expiration
    if (new Date() > record.expiresAt) {
      this.records.delete(key);
      return null;
    }

    return record;
  }

  async create(record: IdempotencyRecord): Promise<boolean> {
    const existing = await this.get(record.idempotencyKey);
    if (existing) return false;

    this.records.set(record.idempotencyKey, record);
    return true;
  }

  async updateState(
    key: string,
    expectedState: IdempotencyState,
    updates: Partial<IdempotencyRecord>
  ): Promise<boolean> {
    const record = await this.get(key);
    if (!record) return false;
    if (record.state !== expectedState) return false;

    const updated = {
      ...record,
      ...updates,
      updatedAt: new Date(),
    };

    this.records.set(key, updated);
    return true;
  }

  async deleteExpired(): Promise<number> {
    const now = new Date();
    let deleted = 0;

    for (const [key, record] of this.records.entries()) {
      if (now > record.expiresAt) {
        this.records.delete(key);
        deleted++;
      }
    }

    return deleted;
  }

  // Test helper
  clear(): void {
    this.records.clear();
  }
}

// ============================================================================
// IDEMPOTENCY ENGINE
// ============================================================================

/**
 * Idempotency Engine
 * Handles idempotent request processing with all safety guarantees
 */
export class IdempotencyEngine {
  private store: IdempotencyStore;
  private lockManager: LockManager;
  private config: IdempotencyConfig;

  constructor(
    store: IdempotencyStore,
    lockManager: LockManager,
    config?: Partial<IdempotencyConfig>
  ) {
    this.store = store;
    this.lockManager = lockManager;
    this.config = {
      ttl: config?.ttl ?? 24 * 60 * 60 * 1000, // 24 hours
      lockTimeout: config?.lockTimeout ?? 30000, // 30 seconds
      retryInterval: config?.retryInterval ?? 100, // 100ms
      maxRetries: config?.maxRetries ?? 300, // 30 seconds total
    };
  }

  /**
   * Generate scoped idempotency key
   */
  generateKey(merchantId: string, operation: string, key: string): string {
    return `${merchantId}:${operation}:${key}`;
  }

  /**
   * Parse scoped idempotency key
   */
  parseKey(idempotencyKey: string): IdempotencyKey | null {
    const parts = idempotencyKey.split(':');
    if (parts.length !== 3) return null;

    return {
      merchantId: parts[0],
      operation: parts[1],
      key: parts[2],
    };
  }

  /**
   * Generate request fingerprint
   * Detects if request body changed between retries
   */
  generateFingerprint(requestBody: unknown): RequestFingerprint {
    const bodyAsRecord = requestBody as Record<string, unknown>;
    const normalized = JSON.stringify(requestBody, Object.keys(bodyAsRecord).sort());
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');

    return {
      hash,
      algorithm: 'sha256',
      timestamp: new Date(),
    };
  }

  /**
   * Verify request fingerprint matches
   */
  verifyFingerprint(requestBody: unknown, storedFingerprint: RequestFingerprint): boolean {
    const currentFingerprint = this.generateFingerprint(requestBody);
    return currentFingerprint.hash === storedFingerprint.hash;
  }

  /**
   * Check idempotency and return appropriate action
   * This is the core of the idempotency engine
   */
  async check<TRequest, TResponse>(
    merchantId: string,
    operation: string,
    idempotencyKey: string,
    requestBody: TRequest
  ): Promise<IdempotencyResult<TResponse>> {
    const scopedKey = this.generateKey(merchantId, operation, idempotencyKey);
    const existingRecord = await this.store.get(scopedKey);

    // CASE 1: New request - no existing record
    if (!existingRecord) {
      const fingerprint = this.generateFingerprint(requestBody);
      const now = new Date();

      const newRecord: IdempotencyRecord<TRequest, TResponse> = {
        idempotencyKey: scopedKey,
        merchantId,
        operation,
        state: IdempotencyState.PROCESSING,
        requestFingerprint: fingerprint,
        requestBody,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + this.config.ttl),
      };

      const created = await this.store.create(newRecord);
      if (!created) {
        // Race condition: another process created it
        // Retry the check
        return this.check(merchantId, operation, idempotencyKey, requestBody);
      }

      return { type: 'NEW', record: newRecord };
    }

    // CASE 2: Verify request fingerprint
    if (!this.verifyFingerprint(requestBody, existingRecord.requestFingerprint)) {
      return {
        type: 'FINGERPRINT_MISMATCH',
        expected: existingRecord.requestFingerprint.hash,
        actual: this.generateFingerprint(requestBody).hash,
      };
    }

    // CASE 3: Request completed successfully - return cached response
    if (existingRecord.state === IdempotencyState.COMPLETED) {
      return {
        type: 'DUPLICATE_SUCCESS',
        response: existingRecord.responseBody as TResponse,
        record: existingRecord,
      };
    }

    // CASE 4: Request failed permanently - return cached error
    if (existingRecord.state === IdempotencyState.FAILED) {
      const error = new IdempotencyError(
        existingRecord.error?.code || 'UNKNOWN_ERROR',
        existingRecord.error?.message || 'Request failed',
        existingRecord.error?.details
      );
      return {
        type: 'DUPLICATE_FAILED',
        error,
        record: existingRecord,
      };
    }

    // CASE 5: Request still processing - wait for completion
    if (existingRecord.state === IdempotencyState.PROCESSING) {
      return {
        type: 'DUPLICATE_PROCESSING',
        record: existingRecord,
      };
    }

    throw new Error(`Unknown idempotency state: ${existingRecord.state}`);
  }

  /**
   * Mark idempotency request as completed successfully
   */
  async complete<TResponse>(idempotencyKey: string, response: TResponse): Promise<void> {
    await this.store.updateState(idempotencyKey, IdempotencyState.PROCESSING, {
      state: IdempotencyState.COMPLETED,
      responseBody: response,
      completedAt: new Date(),
    });
  }

  /**
   * Mark idempotency request as failed
   */
  async fail(idempotencyKey: string, error: Error): Promise<void> {
    await this.store.updateState(idempotencyKey, IdempotencyState.PROCESSING, {
      state: IdempotencyState.FAILED,
      error: {
        code: error.name,
        message: error.message,
        details: (error as Error & { details?: unknown }).details,
      },
      completedAt: new Date(),
    });
  }

  /**
   * Execute operation with idempotency protection
   * This is the main entry point for idempotent operations
   */
  async executeIdempotent<TRequest, TResponse>(
    merchantId: string,
    operation: string,
    idempotencyKey: string,
    requestBody: TRequest,
    executor: () => Promise<TResponse>
  ): Promise<TResponse> {
    const scopedKey = this.generateKey(merchantId, operation, idempotencyKey);

    // Acquire distributed lock to handle concurrent duplicates
    const lockAcquired = await this.lockManager.acquire(
      scopedKey,
      this.config.lockTimeout,
      'idempotency-coordinator'
    );

    if (!lockAcquired) {
      throw new IdempotencyLockError(scopedKey, 'Failed to acquire lock');
    }

    try {
      // Check idempotency
      const result = await this.check<TRequest, TResponse>(
        merchantId,
        operation,
        idempotencyKey,
        requestBody
      );

      switch (result.type) {
        case 'NEW':
          // Execute the operation
          try {
            const response = await executor();
            await this.complete(scopedKey, response);
            return response;
          } catch (error) {
            await this.fail(scopedKey, error as Error);
            throw error;
          }

        case 'DUPLICATE_SUCCESS':
          // Return cached response
          return result.response;

        case 'DUPLICATE_PROCESSING':
          // Wait for in-flight request to complete
          return await this.waitForCompletion<TResponse>(scopedKey);

        case 'DUPLICATE_FAILED':
          // Return cached error
          throw result.error;

        case 'FINGERPRINT_MISMATCH':
          throw new IdempotencyFingerprintMismatchError(
            idempotencyKey,
            result.expected,
            result.actual
          );

        default:
          throw new Error('Unknown idempotency result type');
      }
    } finally {
      await this.lockManager.release(scopedKey, 'idempotency-coordinator');
    }
  }

  /**
   * Wait for in-flight request to complete
   * Polls the idempotency store until request completes or times out
   */
  private async waitForCompletion<TResponse>(idempotencyKey: string): Promise<TResponse> {
    let retries = 0;

    while (retries < this.config.maxRetries) {
      await this.sleep(this.config.retryInterval);

      const record = await this.store.get(idempotencyKey);
      if (!record) {
        throw new Error('Idempotency record disappeared while waiting');
      }

      if (record.state === IdempotencyState.COMPLETED) {
        return record.responseBody as TResponse;
      }

      if (record.state === IdempotencyState.FAILED) {
        throw new IdempotencyError(
          record.error?.code || 'UNKNOWN_ERROR',
          record.error?.message || 'Request failed',
          record.error?.details
        );
      }

      retries++;
    }

    throw new IdempotencyTimeoutError(
      idempotencyKey,
      this.config.maxRetries * this.config.retryInterval
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cleanup expired idempotency records
   * Should be run periodically (e.g., every hour)
   */
  async cleanup(): Promise<number> {
    return await this.store.deleteExpired();
  }
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base idempotency error
 */
export class IdempotencyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'IdempotencyError';
    Object.setPrototypeOf(this, IdempotencyError.prototype);
  }
}

/**
 * Request fingerprint mismatch error
 * Thrown when request body changed between retries
 */
export class IdempotencyFingerprintMismatchError extends Error {
  constructor(
    public readonly idempotencyKey: string,
    public readonly expectedHash: string,
    public readonly actualHash: string
  ) {
    super(
      `Idempotency key "${idempotencyKey}" was reused with different request body. ` +
        `Expected hash: ${expectedHash}, Got: ${actualHash}. ` +
        `This indicates the client changed the request parameters while reusing the same idempotency key.`
    );
    this.name = 'IdempotencyFingerprintMismatchError';
    Object.setPrototypeOf(this, IdempotencyFingerprintMismatchError.prototype);
  }
}

/**
 * Failed to acquire idempotency lock
 */
export class IdempotencyLockError extends Error {
  constructor(
    public readonly key: string,
    message: string
  ) {
    super(`Failed to acquire lock for key "${key}": ${message}`);
    this.name = 'IdempotencyLockError';
    Object.setPrototypeOf(this, IdempotencyLockError.prototype);
  }
}

/**
 * Timeout waiting for in-flight request
 */
export class IdempotencyTimeoutError extends Error {
  constructor(
    public readonly idempotencyKey: string,
    public readonly timeoutMs: number
  ) {
    super(
      `Timeout waiting for in-flight request with idempotency key "${idempotencyKey}" ` +
        `to complete after ${timeoutMs}ms`
    );
    this.name = 'IdempotencyTimeoutError';
    Object.setPrototypeOf(this, IdempotencyTimeoutError.prototype);
  }
}
