/**
 * AegisPay - Production-grade Payment Orchestration SDK
 * Main entry point
 */

import { PaymentService, CreatePaymentRequest, ProcessPaymentRequest } from './api/paymentService';
import { InMemoryPaymentRepository, PaymentRepository } from './infra/db';
import { InMemoryEventBus, ConsoleEventBus, CompositeEventBus, EventBus } from './infra/eventBus';
import { GatewayRegistry } from './gateways/registry';
import { MockGateway } from './gateways/mockGateway';
import { PaymentRouter, RoutingRule } from './orchestration/router';
import { RetryPolicy, RetryConfig } from './orchestration/retryPolicy';
import { ConsoleLogger, InMemoryMetricsCollector } from './infra/observability';
import { AegisPayConfig, mergeConfig } from './config/config';
import { GatewayConfig } from './gateways/gateway';
import { GatewayType } from './domain/types';
import { Payment } from './domain/payment';

/**
 * AegisPay SDK
 */
export class AegisPay {
  private paymentService: PaymentService;
  private repository: PaymentRepository;
  private eventBus: EventBus;
  private gatewayRegistry: GatewayRegistry;
  private router: PaymentRouter;
  private logger: ConsoleLogger;
  private metrics: InMemoryMetricsCollector;

  constructor(config?: Partial<AegisPayConfig>) {
    const finalConfig = mergeConfig(config);

    // Initialize infrastructure
    this.repository = new InMemoryPaymentRepository();
    this.metrics = new InMemoryMetricsCollector();
    this.logger = new ConsoleLogger(finalConfig.logging?.level);

    // Initialize event bus
    const buses: EventBus[] = [new InMemoryEventBus()];
    if (finalConfig.events?.logToConsole) {
      buses.push(new ConsoleEventBus());
    }
    this.eventBus = buses.length > 1 ? new CompositeEventBus(buses) : buses[0];

    // Initialize gateway registry and router
    this.gatewayRegistry = new GatewayRegistry();
    this.router = new PaymentRouter(this.gatewayRegistry, finalConfig.routing?.strategy);

    // Apply routing rules
    if (finalConfig.routing?.rules) {
      finalConfig.routing.rules.forEach((rule) => this.router.addRule(rule as RoutingRule));
    }

    // Apply gateway costs
    if (finalConfig.gatewayCosts) {
      finalConfig.gatewayCosts.forEach((cost) => this.router.setGatewayCost(cost));
    }

    // Initialize retry policy
    const retryPolicy = new RetryPolicy(finalConfig.retry as RetryConfig);

    // Initialize payment service
    this.paymentService = new PaymentService(
      this.repository,
      this.eventBus,
      this.gatewayRegistry,
      this.router,
      retryPolicy,
      this.logger,
      this.metrics
    );

    this.logger.info('AegisPay SDK initialized', {
      routing: finalConfig.routing?.strategy,
      maxRetries: finalConfig.retry?.maxRetries,
    });
  }

  /**
   * Register a payment gateway
   */
  registerGateway(gatewayType: GatewayType, config: GatewayConfig): void {
    // For now, we only support MockGateway
    // In production, this would instantiate real gateways based on type
    if (gatewayType === GatewayType.MOCK) {
      const gateway = new MockGateway(config, {
        successRate: 0.95,
        latency: 100,
      });
      this.gatewayRegistry.register(gatewayType, gateway);
      this.logger.info('Gateway registered', { gatewayType });
    } else {
      throw new Error(`Gateway type ${gatewayType} not yet implemented`);
    }
  }

  /**
   * Create a payment
   */
  async createPayment(request: CreatePaymentRequest): Promise<Payment> {
    const result = await this.paymentService.createPayment(request);
    if (result.isFailure) {
      throw result.error;
    }
    return result.value;
  }

  /**
   * Process a payment
   */
  async processPayment(request: ProcessPaymentRequest): Promise<Payment> {
    const result = await this.paymentService.processPayment(request);
    if (result.isFailure) {
      throw result.error;
    }
    return result.value;
  }

  /**
   * Get payment by ID
   */
  async getPayment(paymentId: string): Promise<Payment | null> {
    return await this.paymentService.getPayment(paymentId);
  }

  /**
   * Get payment by idempotency key
   */
  async getPaymentByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    return await this.paymentService.getPaymentByIdempotencyKey(idempotencyKey);
  }

  /**
   * Get customer payments
   */
  async getCustomerPayments(customerId: string, limit?: number): Promise<Payment[]> {
    return await this.paymentService.getCustomerPayments(customerId, limit);
  }

  /**
   * Get gateway metrics
   */
  getGatewayMetrics(gatewayType?: GatewayType): unknown {
    if (gatewayType) {
      return this.gatewayRegistry.getMetrics(gatewayType);
    }
    return this.gatewayRegistry.getAllMetrics();
  }

  /**
   * Get SDK metrics
   */
  getMetrics(): unknown {
    return this.metrics.getMetrics();
  }

  /**
   * Get gateway health summary
   */
  getHealthSummary(): unknown {
    return this.gatewayRegistry.getHealthSummary();
  }
}

// Export types and classes for production use
export * from './domain/types';
export * from './domain/payment';
export * from './domain/paymentStateMachine';
export * from './domain/events';
export * from './gateways/gateway';
export * from './orchestration/router';
export * from './orchestration/enhancedCircuitBreaker';
export * from './infra/observability';
export * from './infra/validation';
export * from './infra/lockManager';
export * from './infra/eventSourcing';
export {
  GatewayMetricsCollector,
  MetricsSnapshot,
  IntelligentRoutingEngine,
  ScoringWeights,
  DEFAULT_WEIGHTS,
  createHighValueRule,
  createLowLatencyRule,
  createCostOptimizationRule,
} from './orchestration/intelligentRouting';
export * from './orchestration/chaosEngineering';
export {
  HookRegistry,
  HookExecutor,
  HighValueFraudCheck,
  GeographicFraudCheck,
  PaymentLoggingListener,
} from './orchestration/hooks';
export * from './infra/optimisticLocking';
export * from './infra/idempotency';
export * from './infra/transactionalOutbox';
export * from './config/config';
export type { CreatePaymentRequest, ProcessPaymentRequest };
