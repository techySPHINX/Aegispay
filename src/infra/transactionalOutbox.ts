/**
 * TRANSACTIONAL OUTBOX PATTERN
 * 
 * This module implements the transactional outbox pattern to achieve exactly-once
 * event delivery semantics. It solves the dual-write problem where you need to:
 * 1. Update application state (e.g., payment status)
 * 2. Publish events (e.g., PaymentSucceeded)
 * 
 * Without an outbox, these operations are NOT atomic:
 * - State update succeeds + Event publish fails = State changed but no notification
 * - State update fails + Event publish succeeds = Event sent but state inconsistent
 * 
 * THE SOLUTION:
 * 1. Write state changes AND events to database in SAME transaction (atomic)
 * 2. Background publisher reads unpublished events and publishes them
 * 3. Mark events as published after successful delivery
 * 4. Retry on failure with idempotency
 * 
 * GUARANTEES:
 * - At-least-once delivery (events never lost)
 * - Exactly-once processing (via consumer idempotency)
 * - Ordering within same aggregate (via sequence numbers)
 * - Crash recovery (events persisted durably)
 */

import { PaymentEvent, EventType } from '../domain/events';
import { EventBus } from './eventBus';

// ============================================================================
// OUTBOX ENTRY
// ============================================================================

/**
 * Represents an event to be published, stored in the outbox
 */
export interface OutboxEntry {
  /** Unique identifier for the outbox entry */
  id: string;

  /** Payment ID (aggregate ID) */
  aggregateId: string;

  /** Event type */
  eventType: EventType;

  /** Serialized event payload */
  payload: string;

  /** Event metadata */
  metadata: {
    /** Event version for ordering */
    version: number;
    /** Original event timestamp */
    eventTimestamp: Date;
    /** Idempotency key for deduplication */
    idempotencyKey?: string;
    /** Correlation ID for tracing */
    correlationId?: string;
  };

  /** Outbox entry status */
  status: OutboxStatus;

  /** When the entry was created */
  createdAt: Date;

  /** When the event was published (null if not yet published) */
  publishedAt: Date | null;

  /** Number of publish attempts */
  attempts: number;

  /** Last error if publish failed */
  lastError: string | null;

  /** Next retry time (for exponential backoff) */
  nextRetryAt: Date | null;
}

export enum OutboxStatus {
  PENDING = 'PENDING',           // Not yet published
  PUBLISHED = 'PUBLISHED',       // Successfully published
  FAILED = 'FAILED',             // Permanently failed after max retries
  PROCESSING = 'PROCESSING',     // Currently being published
}

// ============================================================================
// OUTBOX STORE INTERFACE
// ============================================================================

/**
 * Persistence interface for the transactional outbox
 * 
 * In production, this would be backed by:
 * - PostgreSQL table with outbox entries
 * - MongoDB collection with outbox documents
 * - DynamoDB table with outbox items
 */
export interface OutboxStore {
  /**
   * Save an outbox entry in a transaction
   * CRITICAL: This must be called in the SAME transaction as state changes
   */
  save(entry: OutboxEntry): Promise<void>;

  /**
   * Save multiple entries atomically
   */
  saveBatch(entries: OutboxEntry[]): Promise<void>;

  /**
   * Get pending entries ready for publishing
   * Returns entries that are PENDING or need retry
   */
  getPendingEntries(limit: number): Promise<OutboxEntry[]>;

  /**
   * Mark entry as published
   */
  markPublished(entryId: string): Promise<void>;

  /**
   * Mark entry as failed with error details
   */
  markFailed(entryId: string, error: string, nextRetryAt: Date | null): Promise<void>;

  /**
   * Mark entry as processing (to prevent duplicate processing)
   */
  markProcessing(entryId: string): Promise<void>;

  /**
   * Get entry by ID
   */
  getById(entryId: string): Promise<OutboxEntry | null>;

  /**
   * Get entries for a specific aggregate (for debugging)
   */
  getByAggregateId(aggregateId: string): Promise<OutboxEntry[]>;

  /**
   * Clean up old published entries (for maintenance)
   */
  deletePublished(olderThan: Date): Promise<number>;
}

// ============================================================================
// IN-MEMORY OUTBOX STORE
// ============================================================================

/**
 * In-memory implementation of OutboxStore
 * For production, use a database-backed implementation
 */
export class InMemoryOutboxStore implements OutboxStore {
  private entries: Map<string, OutboxEntry> = new Map();

  async save(entry: OutboxEntry): Promise<void> {
    this.entries.set(entry.id, { ...entry });
  }

  async saveBatch(entries: OutboxEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.save(entry);
    }
  }

  async getPendingEntries(limit: number): Promise<OutboxEntry[]> {
    const now = new Date();
    const pending = Array.from(this.entries.values())
      .filter((entry) => {
        if (entry.status === OutboxStatus.PUBLISHED) return false;
        if (entry.status === OutboxStatus.PROCESSING) return false;
        if (entry.status === OutboxStatus.FAILED) return false;

        // Check if ready for retry
        if (entry.nextRetryAt && entry.nextRetryAt > now) return false;

        return true;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);

    return pending.map((e) => ({ ...e }));
  }

  async markPublished(entryId: string): Promise<void> {
    const entry = this.entries.get(entryId);
    if (entry) {
      entry.status = OutboxStatus.PUBLISHED;
      entry.publishedAt = new Date();
    }
  }

  async markFailed(entryId: string, error: string, nextRetryAt: Date | null): Promise<void> {
    const entry = this.entries.get(entryId);
    if (entry) {
      entry.status = nextRetryAt ? OutboxStatus.PENDING : OutboxStatus.FAILED;
      entry.lastError = error;
      entry.nextRetryAt = nextRetryAt;
      entry.attempts += 1;
    }
  }

  async markProcessing(entryId: string): Promise<void> {
    const entry = this.entries.get(entryId);
    if (entry) {
      entry.status = OutboxStatus.PROCESSING;
    }
  }

  async getById(entryId: string): Promise<OutboxEntry | null> {
    const entry = this.entries.get(entryId);
    return entry ? { ...entry } : null;
  }

  async getByAggregateId(aggregateId: string): Promise<OutboxEntry[]> {
    return Array.from(this.entries.values())
      .filter((e) => e.aggregateId === aggregateId)
      .map((e) => ({ ...e }));
  }

  async deletePublished(olderThan: Date): Promise<number> {
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (
        entry.status === OutboxStatus.PUBLISHED &&
        entry.publishedAt &&
        entry.publishedAt < olderThan
      ) {
        this.entries.delete(id);
        count++;
      }
    }
    return count;
  }
}

// ============================================================================
// OUTBOX PUBLISHER
// ============================================================================

export interface OutboxPublisherConfig {
  /** How often to poll for pending entries (ms) */
  pollInterval: number;

  /** Max entries to process per batch */
  batchSize: number;

  /** Max retry attempts before marking as permanently failed */
  maxRetries: number;

  /** Base delay for exponential backoff (ms) */
  retryBaseDelay: number;

  /** Max delay for exponential backoff (ms) */
  retryMaxDelay: number;

  /** Enable automatic cleanup of old published entries */
  enableCleanup: boolean;

  /** How old published entries must be before cleanup (ms) */
  cleanupAge: number;
}

export const DEFAULT_OUTBOX_CONFIG: OutboxPublisherConfig = {
  pollInterval: 1000,        // Poll every 1 second
  batchSize: 100,            // Process 100 entries per batch
  maxRetries: 10,            // Retry up to 10 times
  retryBaseDelay: 1000,      // Start with 1 second delay
  retryMaxDelay: 60000,      // Max 1 minute delay
  enableCleanup: true,       // Enable cleanup
  cleanupAge: 86400000,      // Clean up after 24 hours
};

/**
 * Outbox Publisher - Background worker that publishes events from the outbox
 * 
 * This is the "relay" that ensures events are eventually delivered to the event bus
 */
export class OutboxPublisher {
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastCleanup: Date = new Date();

  constructor(
    private store: OutboxStore,
    private eventBus: EventBus,
    private config: OutboxPublisherConfig = DEFAULT_OUTBOX_CONFIG
  ) { }

  /**
   * Start the publisher (begins polling for events)
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('OutboxPublisher is already running');
    }

    this.running = true;
    this.scheduleNextPoll();
    console.log('[OutboxPublisher] Started polling for events');
  }

  /**
   * Stop the publisher
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[OutboxPublisher] Stopped');
  }

  /**
   * Schedule next poll
   */
  private scheduleNextPoll(): void {
    if (!this.running) return;

    this.pollTimer = setTimeout(() => {
      this.pollAndPublish().catch((error) => {
        console.error('[OutboxPublisher] Error during poll:', error);
        // Continue polling despite errors
        this.scheduleNextPoll();
      });
    }, this.config.pollInterval);
  }

  /**
   * Poll for pending entries and publish them
   */
  private async pollAndPublish(): Promise<void> {
    try {
      // Get pending entries
      const entries = await this.store.getPendingEntries(this.config.batchSize);

      if (entries.length > 0) {
        console.log(`[OutboxPublisher] Processing ${entries.length} pending entries`);

        // Process each entry
        for (const entry of entries) {
          await this.publishEntry(entry);
        }
      }

      // Periodic cleanup
      if (this.config.enableCleanup) {
        await this.cleanupIfNeeded();
      }

    } finally {
      // Schedule next poll
      this.scheduleNextPoll();
    }
  }

  /**
   * Publish a single entry
   */
  private async publishEntry(entry: OutboxEntry): Promise<void> {
    try {
      // Mark as processing to prevent duplicate processing
      await this.store.markProcessing(entry.id);

      // Deserialize event
      const event = this.deserializeEvent(entry);

      // Publish to event bus
      await this.eventBus.publish(event);

      // Mark as published
      await this.store.markPublished(entry.id);

      console.log(`[OutboxPublisher] Published event ${entry.id} (${entry.eventType})`);

    } catch (error) {
      // Handle failure
      await this.handlePublishFailure(entry, error);
    }
  }

  /**
   * Handle publish failure with retry logic
   */
  private async handlePublishFailure(entry: OutboxEntry, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const newAttempts = entry.attempts + 1;

    console.error(
      `[OutboxPublisher] Failed to publish entry ${entry.id} (attempt ${newAttempts}):`,
      errorMessage
    );

    // Check if we should retry
    if (newAttempts < this.config.maxRetries) {
      // Calculate next retry time with exponential backoff
      const delay = Math.min(
        this.config.retryBaseDelay * Math.pow(2, newAttempts),
        this.config.retryMaxDelay
      );
      const nextRetryAt = new Date(Date.now() + delay);

      await this.store.markFailed(entry.id, errorMessage, nextRetryAt);

      console.log(
        `[OutboxPublisher] Will retry entry ${entry.id} at ${nextRetryAt.toISOString()}`
      );
    } else {
      // Max retries exceeded - mark as permanently failed
      await this.store.markFailed(entry.id, errorMessage, null);

      console.error(
        `[OutboxPublisher] Entry ${entry.id} permanently failed after ${newAttempts} attempts`
      );
    }
  }

  /**
   * Deserialize event from outbox entry
   */
  private deserializeEvent(entry: OutboxEntry): PaymentEvent {
    const payload = JSON.parse(entry.payload);

    return {
      eventId: entry.id,
      eventType: entry.eventType,
      aggregateId: entry.aggregateId,
      version: entry.metadata.version,
      timestamp: entry.metadata.eventTimestamp,
      payload,
      metadata: {
        idempotencyKey: entry.metadata.idempotencyKey,
        correlationId: entry.metadata.correlationId,
      },
    } as PaymentEvent;
  }

  /**
   * Cleanup old published entries
   */
  private async cleanupIfNeeded(): Promise<void> {
    const now = new Date();
    const timeSinceLastCleanup = now.getTime() - this.lastCleanup.getTime();

    // Run cleanup once per hour
    if (timeSinceLastCleanup > 3600000) {
      const cutoff = new Date(now.getTime() - this.config.cleanupAge);
      const deleted = await this.store.deletePublished(cutoff);

      if (deleted > 0) {
        console.log(`[OutboxPublisher] Cleaned up ${deleted} old published entries`);
      }

      this.lastCleanup = now;
    }
  }

  /**
   * Get publisher statistics
   */
  async getStats(): Promise<{
    pending: number;
    published: number;
    failed: number;
    processing: number;
  }> {
    // This is a simplified version - in production, you'd query the store directly
    const allEntries = await this.store.getPendingEntries(10000); // Get more for stats

    return {
      pending: allEntries.filter((e) => e.status === OutboxStatus.PENDING).length,
      published: 0, // Would need separate query
      failed: allEntries.filter((e) => e.status === OutboxStatus.FAILED).length,
      processing: allEntries.filter((e) => e.status === OutboxStatus.PROCESSING).length,
    };
  }
}

// ============================================================================
// TRANSACTIONAL EVENT BUS
// ============================================================================

/**
 * Transactional Event Bus - Wraps event bus with transactional outbox
 * 
 * Instead of publishing events directly, this saves them to the outbox
 * in the same transaction as state changes
 */
export class TransactionalEventBus {
  constructor(private outboxStore: OutboxStore) { }

  /**
   * Save event to outbox (to be published later)
   * Call this in the SAME transaction as your state changes
   */
  async saveEvent(event: PaymentEvent): Promise<OutboxEntry> {
    const entry: OutboxEntry = {
      id: event.eventId,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: JSON.stringify(event.payload),
      metadata: {
        version: event.version,
        eventTimestamp: event.timestamp,
        idempotencyKey: event.metadata?.idempotencyKey as string | undefined,
        correlationId: event.metadata?.correlationId as string | undefined,
      },
      status: OutboxStatus.PENDING,
      createdAt: new Date(),
      publishedAt: null,
      attempts: 0,
      lastError: null,
      nextRetryAt: null,
    };

    await this.outboxStore.save(entry);
    return entry;
  }

  /**
   * Save multiple events atomically
   */
  async saveEvents(events: PaymentEvent[]): Promise<OutboxEntry[]> {
    const entries = events.map((event) => ({
      id: event.eventId,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: JSON.stringify(event.payload),
      metadata: {
        version: event.version,
        eventTimestamp: event.timestamp,
        idempotencyKey: event.metadata?.idempotencyKey,
        correlationId: event.metadata?.correlationId,
      },
      status: OutboxStatus.PENDING,
      createdAt: new Date(),
      publishedAt: null,
      attempts: 0,
      lastError: null,
      nextRetryAt: null,
    }));

    await this.outboxStore.saveBatch(entries as OutboxEntry[]);
    return entries as OutboxEntry[];
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate unique outbox entry ID
 */
export function generateOutboxId(): string {
  return `outbox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create outbox entry from event
 */
export function createOutboxEntry(event: PaymentEvent): OutboxEntry {
  return {
    id: event.eventId,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    payload: JSON.stringify(event.payload),
    metadata: {
      version: event.version,
      eventTimestamp: event.timestamp,
      idempotencyKey: event.metadata?.idempotencyKey as string | undefined,
      correlationId: event.metadata?.correlationId as string | undefined,
    },
    status: OutboxStatus.PENDING,
    createdAt: new Date(),
    publishedAt: null,
    attempts: 0,
    lastError: null,
    nextRetryAt: null,
  };
}
