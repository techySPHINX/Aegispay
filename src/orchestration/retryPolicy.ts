/**
 * Retry Policy for handling transient failures
 * Implements exponential backoff with jitter
 */

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number; // 0-1
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/**
 * Retry Policy Implementation
 */
export class RetryPolicy {
  constructor(private config: RetryConfig = DEFAULT_RETRY_CONFIG) { }

  /**
   * Calculate delay for next retry attempt
   */
  calculateDelay(attemptNumber: number): number {
    const baseDelay =
      this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attemptNumber);

    const cappedDelay = Math.min(baseDelay, this.config.maxDelayMs);

    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * this.config.jitterFactor * (Math.random() - 0.5);

    return Math.max(0, cappedDelay + jitter);
  }

  /**
   * Check if retry should be attempted
   */
  shouldRetry(attemptNumber: number, isRetryable: boolean): boolean {
    return isRetryable && attemptNumber < this.config.maxRetries;
  }

  /**
   * Execute an operation with retries
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    isRetryableError: (error: Error) => boolean
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        const shouldRetry = this.shouldRetry(
          attempt,
          isRetryableError(error as Error)
        );

        if (!shouldRetry) {
          throw error;
        }

        // Wait before retrying
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get maximum possible delay
   */
  getMaxDelay(): number {
    return this.config.maxDelayMs;
  }

  /**
   * Get retry configuration
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }
}

/**
 * Retry context for tracking retry attempts
 */
export interface RetryContext {
  attemptNumber: number;
  lastError?: Error;
  nextRetryDelay?: number;
  totalElapsedTime: number;
  startTime: Date;
}

/**
 * Create a new retry context
 */
export function createRetryContext(): RetryContext {
  return {
    attemptNumber: 0,
    totalElapsedTime: 0,
    startTime: new Date(),
  };
}
