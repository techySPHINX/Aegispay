/**
 * Lock Manager for ensuring idempotency and preventing race conditions
 * 
 * This implements distributed locking semantics to ensure that concurrent
 * payment requests with the same idempotency key are serialized.
 */

export interface Lock {
  key: string;
  acquiredAt: Date;
  expiresAt: Date;
  ownerId: string;
}

export interface LockManager {
  /**
   * Acquire a lock for the given key
   * Returns true if lock was acquired, false if already locked
   */
  acquire(key: string, ttlMs: number, ownerId: string): Promise<boolean>;

  /**
   * Release a lock for the given key
   */
  release(key: string, ownerId: string): Promise<boolean>;

  /**
   * Check if a key is locked
   */
  isLocked(key: string): Promise<boolean>;

  /**
   * Extend the lock TTL
   */
  extend(key: string, ownerId: string, ttlMs: number): Promise<boolean>;
}

/**
 * In-Memory Lock Manager
 * For production, use Redis or DynamoDB with atomic operations
 */
export class InMemoryLockManager implements LockManager {
  private locks: Map<string, Lock> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup expired locks every 5 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredLocks();
    }, 5000);
  }

  async acquire(key: string, ttlMs: number, ownerId: string): Promise<boolean> {
    const now = new Date();
    const existingLock = this.locks.get(key);

    // Check if lock exists and is not expired
    if (existingLock) {
      if (existingLock.expiresAt > now) {
        // Lock is held by another owner
        if (existingLock.ownerId !== ownerId) {
          return false;
        }
        // Same owner, extend the lock
        existingLock.expiresAt = new Date(now.getTime() + ttlMs);
        return true;
      }
      // Lock expired, clean it up
      this.locks.delete(key);
    }

    // Acquire new lock
    const lock: Lock = {
      key,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      ownerId,
    };

    this.locks.set(key, lock);
    return true;
  }

  async release(key: string, ownerId: string): Promise<boolean> {
    const lock = this.locks.get(key);
    if (!lock) {
      return false;
    }

    // Only release if owner matches
    if (lock.ownerId !== ownerId) {
      return false;
    }

    this.locks.delete(key);
    return true;
  }

  async isLocked(key: string): Promise<boolean> {
    const lock = this.locks.get(key);
    if (!lock) {
      return false;
    }

    const now = new Date();
    if (lock.expiresAt <= now) {
      // Lock expired
      this.locks.delete(key);
      return false;
    }

    return true;
  }

  async extend(key: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const lock = this.locks.get(key);
    if (!lock) {
      return false;
    }

    // Only extend if owner matches
    if (lock.ownerId !== ownerId) {
      return false;
    }

    const now = new Date();
    lock.expiresAt = new Date(now.getTime() + ttlMs);
    return true;
  }

  private cleanupExpiredLocks(): void {
    const now = new Date();
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }

  /**
   * Get current locks (for testing/debugging)
   */
  getCurrentLocks(): Lock[] {
    return Array.from(this.locks.values());
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.locks.clear();
  }
}

/**
 * Execute a function with a lock
 * Automatically acquires and releases the lock
 */
export async function withLock<T>(
  lockManager: LockManager,
  key: string,
  ownerId: string,
  ttlMs: number,
  fn: () => Promise<T>,
  options: {
    maxWaitMs?: number;
    retryIntervalMs?: number;
  } = {}
): Promise<T> {
  const { maxWaitMs = 30000, retryIntervalMs = 100 } = options;
  const startTime = Date.now();

  // Try to acquire lock with retries
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const acquired = await lockManager.acquire(key, ttlMs, ownerId);

    if (acquired) {
      try {
        // Execute the function
        return await fn();
      } finally {
        // Always release the lock
        await lockManager.release(key, ownerId);
      }
    }

    // Check if we've exceeded max wait time
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxWaitMs) {
      throw new LockTimeoutError(key, maxWaitMs);
    }

    // Wait before retrying
    await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
  }
}

/**
 * Lock timeout error
 */
export class LockTimeoutError extends Error {
  constructor(
    public readonly key: string,
    public readonly timeoutMs: number
  ) {
    super(`Failed to acquire lock for key "${key}" within ${timeoutMs}ms`);
    this.name = 'LockTimeoutError';
    Object.setPrototypeOf(this, LockTimeoutError.prototype);
  }
}
