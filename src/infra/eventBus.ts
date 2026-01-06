import { PaymentEvent } from '../domain/events';

/**
 * Event Bus interface for publishing domain events
 * Supports multiple backend implementations (Kafka, Redis Streams, In-Memory)
 */
export interface EventBus {
  /**
   * Publish a single event
   */
  publish(event: PaymentEvent): Promise<void>;

  /**
   * Publish multiple events
   */
  publishBatch(events: PaymentEvent[]): Promise<void>;

  /**
   * Subscribe to events
   */
  subscribe(
    eventType: string,
    handler: (event: PaymentEvent) => Promise<void>
  ): Promise<void>;

  /**
   * Unsubscribe from events
   */
  unsubscribe(eventType: string, handler: (event: PaymentEvent) => Promise<void>): Promise<void>;

  /**
   * Close the event bus connection
   */
  close(): Promise<void>;
}

/**
 * In-Memory Event Bus Implementation
 * Useful for testing and development
 */
export class InMemoryEventBus implements EventBus {
  private handlers: Map<string, Array<(event: PaymentEvent) => Promise<void>>> = new Map();
  private eventLog: PaymentEvent[] = [];

  async publish(event: PaymentEvent): Promise<void> {
    // Store event in log
    this.eventLog.push(event);

    // Call all registered handlers
    const handlers = this.handlers.get(event.eventType) || [];
    await Promise.all(handlers.map((handler) => handler(event)));
  }

  async publishBatch(events: PaymentEvent[]): Promise<void> {
    await Promise.all(events.map((event) => this.publish(event)));
  }

  async subscribe(
    eventType: string,
    handler: (event: PaymentEvent) => Promise<void>
  ): Promise<void> {
    const handlers = this.handlers.get(eventType) || [];
    handlers.push(handler);
    this.handlers.set(eventType, handlers);
  }

  async unsubscribe(
    eventType: string,
    handler: (event: PaymentEvent) => Promise<void>
  ): Promise<void> {
    const handlers = this.handlers.get(eventType) || [];
    const filteredHandlers = handlers.filter((h) => h !== handler);
    this.handlers.set(eventType, filteredHandlers);
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }

  /**
   * Get all published events (for testing)
   */
  getEventLog(): PaymentEvent[] {
    return [...this.eventLog];
  }

  /**
   * Clear event log (for testing)
   */
  clearEventLog(): void {
    this.eventLog = [];
  }

  /**
   * Get events by type
   */
  getEventsByType(eventType: string): PaymentEvent[] {
    return this.eventLog.filter((event) => event.eventType === eventType);
  }
}

/**
 * Console Event Bus - Logs events to console
 * Useful for debugging
 */
export class ConsoleEventBus implements EventBus {
  async publish(event: PaymentEvent): Promise<void> {
    console.log('[EVENT]', JSON.stringify(event, null, 2));
  }

  async publishBatch(events: PaymentEvent[]): Promise<void> {
    console.log('[BATCH EVENTS]', JSON.stringify(events, null, 2));
  }

  async subscribe(
    eventType: string,
    handler: (event: PaymentEvent) => Promise<void>
  ): Promise<void> {
    void eventType; // Satisfy type system
    void handler; // Satisfy type system
    console.warn('ConsoleEventBus does not support subscriptions');
  }

  async unsubscribe(
    eventType: string,
    handler: (event: PaymentEvent) => Promise<void>
  ): Promise<void> {
    void eventType; // Satisfy type system
    void handler; // Satisfy type system
    // No-op
  }

  async close(): Promise<void> {
    console.log('[EVENT BUS] Closed');
  }
}

/**
 * Composite Event Bus - Publishes to multiple event buses
 */
export class CompositeEventBus implements EventBus {
  constructor(private buses: EventBus[]) { }

  async publish(event: PaymentEvent): Promise<void> {
    await Promise.all(this.buses.map((bus) => bus.publish(event)));
  }

  async publishBatch(events: PaymentEvent[]): Promise<void> {
    await Promise.all(this.buses.map((bus) => bus.publishBatch(events)));
  }

  async subscribe(
    eventType: string,
    handler: (event: PaymentEvent) => Promise<void>
  ): Promise<void> {
    await Promise.all(this.buses.map((bus) => bus.subscribe(eventType, handler)));
  }

  async unsubscribe(
    eventType: string,
    handler: (event: PaymentEvent) => Promise<void>
  ): Promise<void> {
    await Promise.all(this.buses.map((bus) => bus.unsubscribe(eventType, handler)));
  }

  async close(): Promise<void> {
    await Promise.all(this.buses.map((bus) => bus.close()));
  }
}
