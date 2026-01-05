import { v4 as uuidv4 } from 'uuid';
import { Payment } from '../domain/payment';
import {
  PaymentState,
  Currency,
  PaymentMethod,
  Customer,
  Money,
  ok,
  fail,
  Result,
  GatewayType,
} from '../domain/types';
import { PaymentEventFactory, EventType } from '../domain/events';
import { PaymentRepository } from '../infra/db';
import { EventBus } from '../infra/eventBus';
import { GatewayRegistry } from '../gateways/registry';
import { PaymentRouter, RoutingContext } from '../orchestration/router';
import { RetryPolicy } from '../orchestration/retryPolicy';
import { CircuitBreaker } from '../orchestration/circuitBreaker';
import { Logger, MetricsCollector } from '../infra/observability';
import { GatewayError } from '../gateways/gateway';

/**
 * Payment Service - Core orchestration engine
 * This is the main entry point for payment operations
 */

export interface CreatePaymentRequest {
  idempotencyKey: string;
  amount: number;
  currency: Currency;
  paymentMethod: PaymentMethod;
  customer: Customer;
  metadata?: Record<string, unknown>;
}

export interface ProcessPaymentRequest {
  paymentId: string;
  gatewayType?: GatewayType; // Optional: let router decide if not provided
}

export class PaymentService {
  private circuitBreakers: Map<GatewayType, CircuitBreaker> = new Map();
  private eventVersion: Map<string, number> = new Map(); // paymentId -> version

  constructor(
    private repository: PaymentRepository,
    private eventBus: EventBus,
    private gatewayRegistry: GatewayRegistry,
    private router: PaymentRouter,
    private retryPolicy: RetryPolicy,
    private logger: Logger,
    private metrics: MetricsCollector
  ) { }

  /**
   * Create a new payment (Idempotent)
   */
  async createPayment(
    request: CreatePaymentRequest
  ): Promise<Result<Payment, Error>> {
    const startTime = Date.now();

    try {
      // Check for existing payment with same idempotency key
      const existingPayment = await this.repository.findByIdempotencyKey(
        request.idempotencyKey
      );

      if (existingPayment) {
        this.logger.info('Payment already exists with idempotency key', {
          paymentId: existingPayment.id,
          idempotencyKey: request.idempotencyKey,
        });
        this.metrics.increment('payment.idempotency_hit');
        return ok(existingPayment);
      }

      // Create new payment
      const payment = new Payment({
        id: uuidv4(),
        idempotencyKey: request.idempotencyKey,
        state: PaymentState.INITIATED,
        amount: new Money(request.amount, request.currency),
        paymentMethod: request.paymentMethod,
        customer: request.customer,
        metadata: request.metadata || {},
      });

      // Save payment
      const savedPayment = await this.repository.save(payment);

      // Emit event
      await this.publishEvent(
        PaymentEventFactory.createPaymentInitiated(savedPayment, this.getNextVersion(payment.id))
      );

      const duration = Date.now() - startTime;
      this.logger.info('Payment created successfully', {
        paymentId: savedPayment.id,
        amount: request.amount,
        currency: request.currency,
        duration,
      });

      this.metrics.increment('payment.created');
      this.metrics.histogram('payment.create_duration', duration);

      return ok(savedPayment);
    } catch (error) {
      this.logger.error('Failed to create payment', error as Error, {
        idempotencyKey: request.idempotencyKey,
      });
      this.metrics.increment('payment.create_failed');
      return fail(error as Error);
    }
  }

  /**
   * Process a payment through the orchestration flow
   */
  async processPayment(
    request: ProcessPaymentRequest
  ): Promise<Result<Payment, Error>> {
    const startTime = Date.now();

    try {
      // Retrieve payment
      let payment = await this.repository.findById(request.paymentId);
      if (!payment) {
        throw new Error(`Payment ${request.paymentId} not found`);
      }

      this.logger.info('Processing payment', {
        paymentId: payment.id,
        state: payment.state,
      });

      // Select gateway
      const gatewayType = request.gatewayType || this.selectGateway(payment);
      if (!gatewayType) {
        throw new Error('No gateway available for payment processing');
      }

      const gateway = this.gatewayRegistry.getGateway(gatewayType);
      if (!gateway) {
        throw new Error(`Gateway ${gatewayType} not found`);
      }

      // Get or create circuit breaker for this gateway
      const circuitBreaker = this.getCircuitBreaker(gatewayType);

      // Step 1: Authenticate
      payment = await this.authenticatePayment(payment, gatewayType, circuitBreaker);
      await this.repository.update(payment);

      // Step 2: Process
      payment = await this.executePayment(payment, gateway, circuitBreaker);
      await this.repository.update(payment);

      const duration = Date.now() - startTime;
      this.logger.info('Payment processed successfully', {
        paymentId: payment.id,
        state: payment.state,
        duration,
      });

      this.metrics.increment('payment.processed', { gateway: gatewayType });
      this.metrics.histogram('payment.process_duration', duration);
      this.gatewayRegistry.recordRequest(gatewayType, true, duration);

      return ok(payment);
    } catch (error) {
      this.logger.error('Payment processing failed', error as Error, {
        paymentId: request.paymentId,
      });
      this.metrics.increment('payment.process_failed');

      // Mark payment as failed
      let payment = await this.repository.findById(request.paymentId);
      if (payment) {
        payment = payment.markFailure((error as Error).message);
        await this.repository.update(payment);
        await this.publishEvent(
          PaymentEventFactory.createPaymentFailed(
            payment,
            this.getNextVersion(payment.id),
            payment.canRetry(this.retryPolicy.getConfig().maxRetries)
          )
        );
      }

      return fail(error as Error);
    }
  }

  /**
   * Authenticate payment
   */
  private async authenticatePayment(
    payment: Payment,
    gatewayType: GatewayType,
    circuitBreaker: CircuitBreaker
  ): Promise<Payment> {
    const gateway = this.gatewayRegistry.getGateway(gatewayType);
    if (!gateway) {
      throw new Error(`Gateway ${gatewayType} not found`);
    }

    // Authenticate through circuit breaker
    const authResult = await circuitBreaker.execute(async () => {
      return await this.retryPolicy.executeWithRetry(
        () => gateway.authenticate(payment),
        (error) => error instanceof GatewayError && error.shouldRetry()
      );
    });

    if (authResult.isFailure) {
      throw new Error(`Authentication failed: ${authResult.error}`);
    }

    // Update payment state
    const updatedPayment = payment.authenticate(gatewayType);

    // Emit event
    await this.publishEvent(
      PaymentEventFactory.createPaymentAuthenticated(
        updatedPayment,
        this.getNextVersion(payment.id)
      )
    );

    return updatedPayment;
  }

  /**
   * Execute payment processing
   */
  private async executePayment(
    payment: Payment,
    gateway: any,
    circuitBreaker: CircuitBreaker
  ): Promise<Payment> {
    // Initiate
    const initiateResult = await circuitBreaker.execute(async () => {
      return await this.retryPolicy.executeWithRetry(
        () => gateway.initiate(payment),
        (error) => error instanceof GatewayError && error.shouldRetry()
      );
    });

    if (initiateResult.isFailure) {
      throw new Error(`Payment initiation failed: ${initiateResult.error}`);
    }

    const gatewayTxnId = initiateResult.value.gatewayTransactionId;
    let updatedPayment = payment.startProcessing(gatewayTxnId);

    // Emit processing event
    await this.publishEvent(
      PaymentEventFactory.createPaymentProcessing(
        updatedPayment,
        this.getNextVersion(payment.id)
      )
    );

    // Process
    const processResult = await circuitBreaker.execute(async () => {
      return await this.retryPolicy.executeWithRetry(
        () => gateway.process(updatedPayment),
        (error) => error instanceof GatewayError && error.shouldRetry()
      );
    });

    if (processResult.isFailure || !processResult.value.success) {
      throw new Error(
        `Payment processing failed: ${processResult.isFailure ? processResult.error : 'Unknown error'
        }`
      );
    }

    // Mark success
    updatedPayment = updatedPayment.markSuccess();

    // Emit success event
    await this.publishEvent(
      PaymentEventFactory.createPaymentSucceeded(
        updatedPayment,
        this.getNextVersion(payment.id)
      )
    );

    return updatedPayment;
  }

  /**
   * Get payment by ID
   */
  async getPayment(paymentId: string): Promise<Payment | null> {
    return await this.repository.findById(paymentId);
  }

  /**
   * Get payment by idempotency key
   */
  async getPaymentByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    return await this.repository.findByIdempotencyKey(idempotencyKey);
  }

  /**
   * Get payments for customer
   */
  async getCustomerPayments(customerId: string, limit?: number): Promise<Payment[]> {
    return await this.repository.findByCustomerId(customerId, limit);
  }

  /**
   * Select gateway using router
   */
  private selectGateway(payment: Payment): GatewayType | undefined {
    const context: RoutingContext = {
      amount: payment.amount.amount,
      currency: payment.amount.currency,
      paymentMethod: payment.paymentMethod.type,
      customerCountry: payment.customer.billingAddress?.country,
    };

    return this.router.route(context);
  }

  /**
   * Get or create circuit breaker for gateway
   */
  private getCircuitBreaker(gatewayType: GatewayType): CircuitBreaker {
    let breaker = this.circuitBreakers.get(gatewayType);
    if (!breaker) {
      breaker = new CircuitBreaker(gatewayType);
      this.circuitBreakers.set(gatewayType, breaker);
    }
    return breaker;
  }

  /**
   * Publish event
   */
  private async publishEvent(event: any): Promise<void> {
    await this.eventBus.publish(event);
  }

  /**
   * Get next event version
   */
  private getNextVersion(paymentId: string): number {
    const currentVersion = this.eventVersion.get(paymentId) || 0;
    const nextVersion = currentVersion + 1;
    this.eventVersion.set(paymentId, nextVersion);
    return nextVersion;
  }
}
