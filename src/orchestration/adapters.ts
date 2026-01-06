/**
 * Functional Programming Adapters
 * 
 * This module implements IO adapters following FP principles.
 * All side effects are isolated into these adapters, making the
 * core orchestration logic pure and testable.
 */

import { Payment } from '../domain/payment';
import { Result } from '../domain/types';
import { PaymentGateway, GatewayInitiateResponse, GatewayAuthResponse, GatewayProcessResponse } from '../gateways/gateway';
import { PaymentRepository } from '../infra/db';
import { EventBus } from '../infra/eventBus';
import { PaymentEvent } from '../domain/events';

/**
 * IO monad representing a deferred computation with side effects
 */
export class IO<T> {
  constructor(private readonly effect: () => Promise<T>) { }

  /**
   * Execute the IO computation
   */
  async unsafeRun(): Promise<T> {
    return this.effect();
  }

  /**
   * Map over the result
   */
  map<U>(fn: (value: T) => U): IO<U> {
    return new IO(async () => {
      const result = await this.effect();
      return fn(result);
    });
  }

  /**
   * FlatMap for composing IO operations
   */
  flatMap<U>(fn: (value: T) => IO<U>): IO<U> {
    return new IO(async () => {
      const result = await this.effect();
      const nextIO = fn(result);
      return nextIO.unsafeRun();
    });
  }

  /**
   * Combine two IO operations sequentially
   */
  chain<U>(other: IO<U>): IO<U> {
    return new IO(async () => {
      await this.effect();
      return other.unsafeRun();
    });
  }

  /**
   * Handle errors
   */
  catchError(handler: (error: Error) => T): IO<T> {
    return new IO(async () => {
      try {
        return await this.effect();
      } catch (error) {
        return handler(error as Error);
      }
    });
  }

  /**
   * Create an IO from a pure value
   */
  static of<T>(value: T): IO<T> {
    return new IO(async () => value);
  }

  /**
   * Sequence multiple IO operations
   */
  static sequence<T>(ios: IO<T>[]): IO<T[]> {
    return new IO(async () => {
      const results: T[] = [];
      for (const io of ios) {
        results.push(await io.unsafeRun());
      }
      return results;
    });
  }

  /**
   * Run multiple IO operations in parallel
   */
  static parallel<T>(ios: IO<T>[]): IO<T[]> {
    return new IO(async () => {
      return Promise.all(ios.map((io) => io.unsafeRun()));
    });
  }
}

/**
 * Repository Adapter - Isolates database operations
 */
export interface RepositoryAdapter {
  findById(id: string): IO<Payment | null>;
  findByIdempotencyKey(key: string): IO<Payment | null>;
  save(payment: Payment): IO<Payment>;
  update(payment: Payment): IO<Payment>;
}

export class RepositoryAdapterImpl implements RepositoryAdapter {
  constructor(private repository: PaymentRepository) { }

  findById(id: string): IO<Payment | null> {
    return new IO(() => this.repository.findById(id));
  }

  findByIdempotencyKey(key: string): IO<Payment | null> {
    return new IO(() => this.repository.findByIdempotencyKey(key));
  }

  save(payment: Payment): IO<Payment> {
    return new IO(() => this.repository.save(payment));
  }

  update(payment: Payment): IO<Payment> {
    return new IO(() => this.repository.update(payment));
  }
}

/**
 * Event Adapter - Isolates event publishing
 */
export interface EventAdapter {
  publish(event: PaymentEvent): IO<void>;
  publishBatch(events: PaymentEvent[]): IO<void>;
}

export class EventAdapterImpl implements EventAdapter {
  constructor(private eventBus: EventBus) { }

  publish(event: PaymentEvent): IO<void> {
    return new IO(() => this.eventBus.publish(event));
  }

  publishBatch(events: PaymentEvent[]): IO<void> {
    return new IO(() => this.eventBus.publishBatch(events));
  }
}

/**
 * Gateway Adapter - Isolates gateway operations
 */
export interface GatewayAdapter {
  authenticate(payment: Payment, gateway: PaymentGateway): IO<Result<GatewayAuthResponse, Error>>;
  initiate(payment: Payment, gateway: PaymentGateway): IO<Result<GatewayInitiateResponse, Error>>;
  process(payment: Payment, gateway: PaymentGateway): IO<Result<GatewayProcessResponse, Error>>;
}

export class GatewayAdapterImpl implements GatewayAdapter {
  authenticate(payment: Payment, gateway: PaymentGateway): IO<Result<GatewayAuthResponse, Error>> {
    return new IO(() => gateway.authenticate(payment) as Promise<Result<GatewayAuthResponse, Error>>);
  }

  initiate(payment: Payment, gateway: PaymentGateway): IO<Result<GatewayInitiateResponse, Error>> {
    return new IO(() => gateway.initiate(payment) as Promise<Result<GatewayInitiateResponse, Error>>);
  }

  process(payment: Payment, gateway: PaymentGateway): IO<Result<GatewayProcessResponse, Error>> {
    return new IO(() => gateway.process(payment) as Promise<Result<GatewayProcessResponse, Error>>);
  }
}

/**
 * Logger Adapter - Isolates logging
 */
export interface LoggerAdapter {
  info(message: string, context?: Record<string, unknown>): IO<void>;
  error(message: string, error: Error, context?: Record<string, unknown>): IO<void>;
  warn(message: string, context?: Record<string, unknown>): IO<void>;
  debug(message: string, context?: Record<string, unknown>): IO<void>;
}

export class LoggerAdapterImpl implements LoggerAdapter {
  constructor(
    private logger: {
      info: (msg: string, ctx?: Record<string, unknown>) => void;
      error: (msg: string, err: Error, ctx?: Record<string, unknown>) => void;
      warn: (msg: string, ctx?: Record<string, unknown>) => void;
      debug: (msg: string, ctx?: Record<string, unknown>) => void;
    }
  ) { }

  info(message: string, context?: Record<string, unknown>): IO<void> {
    return new IO(async () => {
      this.logger.info(message, context);
    });
  }

  error(message: string, error: Error, context?: Record<string, unknown>): IO<void> {
    return new IO(async () => {
      this.logger.error(message, error, context);
    });
  }

  warn(message: string, context?: Record<string, unknown>): IO<void> {
    return new IO(async () => {
      this.logger.warn(message, context);
    });
  }

  debug(message: string, context?: Record<string, unknown>): IO<void> {
    return new IO(async () => {
      this.logger.debug(message, context);
    });
  }
}

/**
 * Metrics Adapter - Isolates metrics collection
 */
export interface MetricsAdapter {
  increment(metric: string, tags?: Record<string, string>): IO<void>;
  histogram(metric: string, value: number, tags?: Record<string, string>): IO<void>;
  gauge(metric: string, value: number, tags?: Record<string, string>): IO<void>;
}

export class MetricsAdapterImpl implements MetricsAdapter {
  constructor(
    private metrics: {
      increment: (metric: string, tags?: Record<string, string>) => void;
      histogram: (metric: string, value: number, tags?: Record<string, string>) => void;
      gauge: (metric: string, value: number, tags?: Record<string, string>) => void;
    }
  ) { }

  increment(metric: string, tags?: Record<string, string>): IO<void> {
    return new IO(async () => {
      this.metrics.increment(metric, tags);
    });
  }

  histogram(metric: string, value: number, tags?: Record<string, string>): IO<void> {
    return new IO(async () => {
      this.metrics.histogram(metric, value, tags);
    });
  }

  gauge(metric: string, value: number, tags?: Record<string, string>): IO<void> {
    return new IO(async () => {
      this.metrics.gauge(metric, value, tags);
    });
  }
}

/**
 * All adapters combined
 */
export interface Adapters {
  repository: RepositoryAdapter;
  events: EventAdapter;
  gateway: GatewayAdapter;
  logger: LoggerAdapter;
  metrics: MetricsAdapter;
}

/**
 * Create adapters from concrete implementations
 */
export function createAdapters(deps: {
  repository: PaymentRepository;
  eventBus: EventBus;
  logger: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    error: (msg: string, err: Error, ctx?: Record<string, unknown>) => void;
    warn: (msg: string, ctx?: Record<string, unknown>) => void;
    debug: (msg: string, ctx?: Record<string, unknown>) => void;
  };
  metrics: {
    increment: (metric: string, tags?: Record<string, string>) => void;
    histogram: (metric: string, value: number, tags?: Record<string, string>) => void;
    gauge: (metric: string, value: number, tags?: Record<string, string>) => void;
  };
}): Adapters {
  return {
    repository: new RepositoryAdapterImpl(deps.repository),
    events: new EventAdapterImpl(deps.eventBus),
    gateway: new GatewayAdapterImpl(),
    logger: new LoggerAdapterImpl(deps.logger),
    metrics: new MetricsAdapterImpl(deps.metrics),
  };
}
