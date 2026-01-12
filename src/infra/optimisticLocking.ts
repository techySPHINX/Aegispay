/**
 * OPTIMISTIC LOCKING FOR CONCURRENCY CONTROL
 *
 * Prevents race conditions and lost updates in concurrent environments.
 *
 * PROBLEM: Lost Update
 * ==================
 * Time  Thread-1              Thread-2
 * ----  --------------------- ---------------------
 * T1    Read payment (v=1)
 * T2                          Read payment (v=1)
 * T3    Update status → PAID
 * T4                          Update status → REFUNDED
 * T5    Write (overwrites!)   ← LOST UPDATE!
 *
 * SOLUTION: Optimistic Locking
 * ===========================
 * Time  Thread-1                    Thread-2
 * ----  --------------------------- ---------------------------
 * T1    Read payment (v=1)
 * T2                                Read payment (v=1)
 * T3    Update IF version=1 (✓)
 *       → New version=2
 * T4                                Update IF version=1 (✗)
 *                                   → CONFLICT DETECTED!
 *                                   → Retry with version=2
 *
 * KEY PRINCIPLES:
 * 1. Every entity has a version number
 * 2. Updates include version check: UPDATE WHERE id=X AND version=Y
 * 3. If no rows updated → conflict detected
 * 4. Retry with fresh read (exponential backoff)
 * 5. Maximum retry limit prevents infinite loops
 */

export class OptimisticLockError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly entityId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number | null
  ) {
    super(
      `Optimistic lock failed for ${entityType}[${entityId}]. ` +
        `Expected version ${expectedVersion}, but entity was ${
          actualVersion !== null ? `at version ${actualVersion}` : 'not found or already modified'
        }`
    );
    this.name = 'OptimisticLockError';
    Object.setPrototypeOf(this, OptimisticLockError.prototype);
  }
}

export class MaxRetriesExceededError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly entityId: string,
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(
      `Maximum retries (${attempts}) exceeded for ${entityType}[${entityId}]. ` +
        `Last error: ${lastError.message}`
    );
    this.name = 'MaxRetriesExceededError';
    Object.setPrototypeOf(this, MaxRetriesExceededError.prototype);
  }
}

// ============================================================================
// VERSIONED ENTITY
// ============================================================================

/**
 * Base interface for entities with versioning
 */
export interface Versioned {
  version: number;
}

/**
 * Result of versioned update
 */
export interface UpdateResult<T> {
  success: boolean;
  entity: T | null;
  previousVersion: number;
  newVersion: number;
  conflictDetected: boolean;
}

// ============================================================================
// OPTIMISTIC LOCK STRATEGY
// ============================================================================

export interface OptimisticLockConfig {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
  jitterFactor: number; // 0-1, randomization to prevent thundering herd
}

export const DEFAULT_OPTIMISTIC_CONFIG: OptimisticLockConfig = {
  maxRetries: 5,
  initialBackoffMs: 10,
  maxBackoffMs: 1000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/**
 * Optimistic Locking Manager
 */
export class OptimisticLockManager {
  constructor(private config: OptimisticLockConfig = DEFAULT_OPTIMISTIC_CONFIG) {}

  /**
   * Execute operation with optimistic locking and automatic retry
   *
   * @param entityType - Type of entity (for logging)
   * @param entityId - Entity ID
   * @param operation - Function that reads, modifies, and writes entity
   * @returns Final result after successful update
   */
  async executeWithRetry<R>(
    entityType: string,
    entityId: string,
    operation: () => Promise<UpdateResult<R>>
  ): Promise<R> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.config.maxRetries) {
      attempt++;

      try {
        const result = await operation();

        if (result.success) {
          console.log(
            `[OptimisticLock] ${entityType}[${entityId}]: ` +
              `Update succeeded on attempt ${attempt} ` +
              `(v${result.previousVersion} → v${result.newVersion})`
          );

          if (!result.entity) {
            throw new Error(`Operation succeeded but returned null entity`);
          }

          return result.entity;
        }

        if (result.conflictDetected) {
          console.warn(
            `[OptimisticLock] ${entityType}[${entityId}]: ` +
              `Conflict detected on attempt ${attempt} ` +
              `(expected v${result.previousVersion}). Retrying...`
          );

          // Exponential backoff with jitter
          const backoff = this.calculateBackoff(attempt);
          await this.sleep(backoff);

          continue;
        }

        // Unknown failure
        throw new Error(`Operation failed without conflict detection`);
      } catch (error) {
        lastError = error as Error;

        if (error instanceof OptimisticLockError) {
          console.warn(
            `[OptimisticLock] ${entityType}[${entityId}]: ` +
              `Lock error on attempt ${attempt}: ${error.message}`
          );

          // Retry on lock errors
          const backoff = this.calculateBackoff(attempt);
          await this.sleep(backoff);

          continue;
        }

        // Non-retryable error
        throw error;
      }
    }

    throw new MaxRetriesExceededError(
      entityType,
      entityId,
      attempt,
      lastError || new Error('Unknown error')
    );
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoff(attempt: number): number {
    const exponential = Math.min(
      this.config.initialBackoffMs * Math.pow(this.config.backoffMultiplier, attempt - 1),
      this.config.maxBackoffMs
    );

    // Add jitter to prevent thundering herd
    const jitter = exponential * this.config.jitterFactor * (Math.random() * 2 - 1);

    return Math.max(0, exponential + jitter);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// REPOSITORY PATTERN WITH OPTIMISTIC LOCKING
// ============================================================================

/**
 * Repository interface with versioned operations
 */
export interface VersionedRepository<T extends Versioned> {
  /**
   * Find entity by ID
   */
  findById(id: string): Promise<T | null>;

  /**
   * Update entity with version check
   * Returns success=false if version mismatch
   */
  updateWithVersion(id: string, entity: T, expectedVersion: number): Promise<UpdateResult<T>>;

  /**
   * Insert new entity (version = 1)
   */
  insert(entity: T): Promise<T>;
}

/**
 * In-memory implementation for testing
 */
export class InMemoryVersionedRepository<
  T extends Versioned & { id: string },
> implements VersionedRepository<T> {
  private store: Map<string, T> = new Map();

  async findById(id: string): Promise<T | null> {
    const entity = this.store.get(id);

    // Return deep copy to simulate database isolation
    return entity ? JSON.parse(JSON.stringify(entity)) : null;
  }

  async updateWithVersion(
    id: string,
    entity: T,
    expectedVersion: number
  ): Promise<UpdateResult<T>> {
    const existing = this.store.get(id);

    if (!existing) {
      return {
        success: false,
        entity: null,
        previousVersion: expectedVersion,
        newVersion: expectedVersion,
        conflictDetected: true,
      };
    }

    // Check version
    if (existing.version !== expectedVersion) {
      return {
        success: false,
        entity: null,
        previousVersion: expectedVersion,
        newVersion: existing.version,
        conflictDetected: true,
      };
    }

    // Update with new version
    const updated = {
      ...entity,
      version: existing.version + 1,
    };

    this.store.set(id, updated);

    return {
      success: true,
      entity: JSON.parse(JSON.stringify(updated)),
      previousVersion: existing.version,
      newVersion: updated.version,
      conflictDetected: false,
    };
  }

  async insert(entity: T): Promise<T> {
    const versioned = {
      ...entity,
      version: 1,
    };

    this.store.set(entity.id, versioned);

    return JSON.parse(JSON.stringify(versioned));
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get all entities (for testing)
   */
  getAll(): T[] {
    return Array.from(this.store.values()).map((e) => JSON.parse(JSON.stringify(e)));
  }
}

// ============================================================================
// EXAMPLE: PAYMENT WITH VERSIONING
// ============================================================================

export interface VersionedPayment extends Versioned {
  id: string;
  amount: number;
  status: string;
  updatedAt: Date;
}

/**
 * Service that uses optimistic locking
 */
export class VersionedPaymentService {
  private lockManager: OptimisticLockManager;

  constructor(
    private repository: VersionedRepository<VersionedPayment>,
    config?: OptimisticLockConfig
  ) {
    this.lockManager = new OptimisticLockManager(config);
  }

  /**
   * Update payment status with automatic retry on conflicts
   */
  async updateStatus(paymentId: string, newStatus: string): Promise<VersionedPayment> {
    return this.lockManager.executeWithRetry('Payment', paymentId, async () => {
      // 1. Read current version
      const payment = await this.repository.findById(paymentId);

      if (!payment) {
        throw new Error(`Payment ${paymentId} not found`);
      }

      // 2. Modify
      const updated: VersionedPayment = {
        ...payment,
        status: newStatus,
        updatedAt: new Date(),
      };

      // 3. Write with version check
      return await this.repository.updateWithVersion(paymentId, updated, payment.version);
    });
  }

  /**
   * Conditional update: only update if current status matches expected
   */
  async conditionalUpdate(
    paymentId: string,
    expectedStatus: string,
    newStatus: string
  ): Promise<VersionedPayment> {
    return this.lockManager.executeWithRetry('Payment', paymentId, async () => {
      const payment = await this.repository.findById(paymentId);

      if (!payment) {
        throw new Error(`Payment ${paymentId} not found`);
      }

      // Business logic check
      if (payment.status !== expectedStatus) {
        throw new Error(
          `Cannot update: expected status '${expectedStatus}' but found '${payment.status}'`
        );
      }

      const updated: VersionedPayment = {
        ...payment,
        status: newStatus,
        updatedAt: new Date(),
      };

      return await this.repository.updateWithVersion(paymentId, updated, payment.version);
    });
  }
}
