/**
 * SDK EXTENSIBILITY HOOKS
 * 
 * Provides plugin architecture for extending AegisPay functionality.
 * 
 * DESIGN PRINCIPLES:
 * ==================
 * 1. Open/Closed Principle: Open for extension, closed for modification
 * 2. Inversion of Control: Framework calls your hooks
 * 3. Composition over Inheritance: Combine multiple hooks
 * 4. Type Safety: Full TypeScript support
 * 5. Non-Breaking: Hooks are optional, system works without them
 * 
 * AVAILABLE HOOKS:
 * ================
 * 1. PrePaymentValidation - Validate before payment processing
 * 2. PostPaymentValidation - Validate after payment processing
 * 3. FraudCheck - Custom fraud detection
 * 4. RoutingStrategy - Custom gateway selection
 * 5. PaymentEnrichment - Add metadata to payments
 * 6. EventListener - React to payment events
 * 7. MetricsCollector - Custom metrics collection
 * 8. ErrorHandler - Custom error handling
 * 
 * EXAMPLE:
 * ========
 * // Register fraud check hook
 * hookRegistry.registerFraudCheck({
 *   name: 'HighValueCheck',
 *   priority: 100,
 *   execute: async (payment) => {
 *     if (payment.amount > 10000) {
 *       return {
 *         allowed: false,
 *         reason: 'High value requires manual approval',
 *         riskScore: 0.9,
 *       };
 *     }
 *     return { allowed: true };
 *   },
 * });
 */

import { Payment } from '../domain/payment';
import { GatewayType } from '../domain/types';
import { DomainEvent } from '../domain/events';

// ============================================================================
// HOOK RESULTS
// ============================================================================

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * Fraud check result
 */
export interface FraudCheckResult {
  allowed: boolean;
  riskScore?: number;           // 0.0 (safe) to 1.0 (fraud)
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Routing decision
 */
export interface RoutingDecision {
  gatewayType: GatewayType;
  confidence: number;           // 0.0 to 1.0
  reason: string;
  metadata?: Record<string, unknown>;
}

/**
 * Enrichment result
 */
export interface EnrichmentResult {
  metadata: Record<string, unknown>;
}

/**
 * Error handling result
 */
export interface ErrorHandlingResult {
  handled: boolean;
  shouldRetry: boolean;
  retryAfterMs?: number;
  alternativeAction?: 'refund' | 'manual-review' | 'cancel';
  metadata?: Record<string, unknown>;
}

// ============================================================================
// HOOK CONTEXTS
// ============================================================================

/**
 * Context passed to hooks
 */
export interface HookContext {
  payment: Payment;
  timestamp: Date;
  requestId: string;
  metadata: Record<string, unknown>;
}

/**
 * Error context
 */
export interface ErrorContext extends HookContext {
  error: Error;
  attemptNumber: number;
  previousAttempts: Array<{
    timestamp: Date;
    error: Error;
  }>;
}

/**
 * Routing context
 */
export interface RoutingContext extends HookContext {
  availableGateways: GatewayType[];
  gatewayMetrics: Map<GatewayType, {
    successRate: number;
    averageLatency: number;
    cost: number;
  }>;
}

// ============================================================================
// HOOK INTERFACES
// ============================================================================

/**
 * Base hook
 */
export interface Hook {
  name: string;
  priority: number;             // Higher = runs first
  enabled: boolean;
}

/**
 * Pre-payment validation hook
 */
export interface PrePaymentValidationHook extends Hook {
  execute(context: HookContext): Promise<ValidationResult>;
}

/**
 * Post-payment validation hook
 */
export interface PostPaymentValidationHook extends Hook {
  execute(context: HookContext): Promise<ValidationResult>;
}

/**
 * Fraud check hook
 */
export interface FraudCheckHook extends Hook {
  execute(context: HookContext): Promise<FraudCheckResult>;
}

/**
 * Routing strategy hook
 */
export interface RoutingStrategyHook extends Hook {
  execute(context: RoutingContext): Promise<RoutingDecision>;
}

/**
 * Payment enrichment hook
 */
export interface PaymentEnrichmentHook extends Hook {
  execute(context: HookContext): Promise<EnrichmentResult>;
}

/**
 * Event listener hook
 */
export interface EventListenerHook extends Hook {
  eventTypes: string[];         // Which events to listen for
  execute(event: DomainEvent, context: HookContext): Promise<void>;
}

/**
 * Metrics collector hook
 */
export interface MetricsCollectorHook extends Hook {
  execute(
    metricName: string,
    value: number,
    tags: Record<string, string>
  ): Promise<void>;
}

/**
 * Error handler hook
 */
export interface ErrorHandlerHook extends Hook {
  canHandle(error: Error): boolean;
  execute(context: ErrorContext): Promise<ErrorHandlingResult>;
}

// ============================================================================
// HOOK REGISTRY
// ============================================================================

/**
 * Central registry for all hooks
 */
export class HookRegistry {
  private preValidationHooks: PrePaymentValidationHook[] = [];
  private postValidationHooks: PostPaymentValidationHook[] = [];
  private fraudCheckHooks: FraudCheckHook[] = [];
  private routingStrategyHooks: RoutingStrategyHook[] = [];
  private enrichmentHooks: PaymentEnrichmentHook[] = [];
  private eventListenerHooks: EventListenerHook[] = [];
  private metricsCollectorHooks: MetricsCollectorHook[] = [];
  private errorHandlerHooks: ErrorHandlerHook[] = [];

  /**
   * Register pre-payment validation hook
   */
  registerPreValidation(hook: PrePaymentValidationHook): void {
    this.preValidationHooks.push(hook);
    this.preValidationHooks.sort((a, b) => b.priority - a.priority);
    console.log(`[Hooks] Registered PreValidation: ${hook.name} (priority: ${hook.priority})`);
  }

  /**
   * Register post-payment validation hook
   */
  registerPostValidation(hook: PostPaymentValidationHook): void {
    this.postValidationHooks.push(hook);
    this.postValidationHooks.sort((a, b) => b.priority - a.priority);
    console.log(`[Hooks] Registered PostValidation: ${hook.name} (priority: ${hook.priority})`);
  }

  /**
   * Register fraud check hook
   */
  registerFraudCheck(hook: FraudCheckHook): void {
    this.fraudCheckHooks.push(hook);
    this.fraudCheckHooks.sort((a, b) => b.priority - a.priority);
    console.log(`[Hooks] Registered FraudCheck: ${hook.name} (priority: ${hook.priority})`);
  }

  /**
   * Register routing strategy hook
   */
  registerRoutingStrategy(hook: RoutingStrategyHook): void {
    this.routingStrategyHooks.push(hook);
    this.routingStrategyHooks.sort((a, b) => b.priority - a.priority);
    console.log(`[Hooks] Registered RoutingStrategy: ${hook.name} (priority: ${hook.priority})`);
  }

  /**
   * Register enrichment hook
   */
  registerEnrichment(hook: PaymentEnrichmentHook): void {
    this.enrichmentHooks.push(hook);
    this.enrichmentHooks.sort((a, b) => b.priority - a.priority);
    console.log(`[Hooks] Registered Enrichment: ${hook.name} (priority: ${hook.priority})`);
  }

  /**
   * Register event listener hook
   */
  registerEventListener(hook: EventListenerHook): void {
    this.eventListenerHooks.push(hook);
    console.log(`[Hooks] Registered EventListener: ${hook.name} (events: ${hook.eventTypes.join(', ')})`);
  }

  /**
   * Register metrics collector hook
   */
  registerMetricsCollector(hook: MetricsCollectorHook): void {
    this.metricsCollectorHooks.push(hook);
    console.log(`[Hooks] Registered MetricsCollector: ${hook.name}`);
  }

  /**
   * Register error handler hook
   */
  registerErrorHandler(hook: ErrorHandlerHook): void {
    this.errorHandlerHooks.push(hook);
    this.errorHandlerHooks.sort((a, b) => b.priority - a.priority);
    console.log(`[Hooks] Registered ErrorHandler: ${hook.name} (priority: ${hook.priority})`);
  }

  /**
   * Get enabled hooks of specific type
   */
  getPreValidationHooks(): PrePaymentValidationHook[] {
    return this.preValidationHooks.filter((h) => h.enabled);
  }

  getPostValidationHooks(): PostPaymentValidationHook[] {
    return this.postValidationHooks.filter((h) => h.enabled);
  }

  getFraudCheckHooks(): FraudCheckHook[] {
    return this.fraudCheckHooks.filter((h) => h.enabled);
  }

  getRoutingStrategyHooks(): RoutingStrategyHook[] {
    return this.routingStrategyHooks.filter((h) => h.enabled);
  }

  getEnrichmentHooks(): PaymentEnrichmentHook[] {
    return this.enrichmentHooks.filter((h) => h.enabled);
  }

  getEventListenerHooks(eventType: string): EventListenerHook[] {
    return this.eventListenerHooks.filter(
      (h) => h.enabled && h.eventTypes.includes(eventType)
    );
  }

  getMetricsCollectorHooks(): MetricsCollectorHook[] {
    return this.metricsCollectorHooks.filter((h) => h.enabled);
  }

  getErrorHandlerHooks(error: Error): ErrorHandlerHook[] {
    return this.errorHandlerHooks.filter(
      (h) => h.enabled && h.canHandle(error)
    );
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.preValidationHooks = [];
    this.postValidationHooks = [];
    this.fraudCheckHooks = [];
    this.routingStrategyHooks = [];
    this.enrichmentHooks = [];
    this.eventListenerHooks = [];
    this.metricsCollectorHooks = [];
    this.errorHandlerHooks = [];
  }
}

// ============================================================================
// HOOK EXECUTOR
// ============================================================================

/**
 * Executes hooks with error handling
 */
export class HookExecutor {
  constructor(private registry: HookRegistry) { }

  /**
   * Execute pre-payment validation hooks
   */
  async executePreValidation(context: HookContext): Promise<ValidationResult> {
    const hooks = this.registry.getPreValidationHooks();

    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    for (const hook of hooks) {
      try {
        const result = await hook.execute(context);

        if (!result.valid) {
          if (result.errors) allErrors.push(...result.errors);
          if (result.warnings) allWarnings.push(...result.warnings);
        }
      } catch (error) {
        console.error(`[Hooks] Error in PreValidation hook ${hook.name}:`, error);
        allErrors.push(`Hook ${hook.name} failed: ${(error as Error).message}`);
      }
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors.length > 0 ? allErrors : undefined,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    };
  }

  /**
   * Execute post-payment validation hooks
   */
  async executePostValidation(context: HookContext): Promise<ValidationResult> {
    const hooks = this.registry.getPostValidationHooks();

    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    for (const hook of hooks) {
      try {
        const result = await hook.execute(context);

        if (!result.valid) {
          if (result.errors) allErrors.push(...result.errors);
          if (result.warnings) allWarnings.push(...result.warnings);
        }
      } catch (error) {
        console.error(`[Hooks] Error in PostValidation hook ${hook.name}:`, error);
        allWarnings.push(`Hook ${hook.name} failed: ${(error as Error).message}`);
      }
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors.length > 0 ? allErrors : undefined,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    };
  }

  /**
   * Execute fraud check hooks
   */
  async executeFraudChecks(context: HookContext): Promise<FraudCheckResult> {
    const hooks = this.registry.getFraudCheckHooks();

    let maxRiskScore = 0;

    for (const hook of hooks) {
      try {
        const result = await hook.execute(context);

        if (!result.allowed) {
          return result;
        }

        if (result.riskScore && result.riskScore > maxRiskScore) {
          maxRiskScore = result.riskScore;
        }
      } catch (error) {
        console.error(`[Hooks] Error in FraudCheck hook ${hook.name}:`, error);
      }
    }

    return {
      allowed: true,
      riskScore: maxRiskScore,
    };
  }

  /**
   * Execute routing strategy hooks
   */
  async executeRoutingStrategy(
    context: RoutingContext
  ): Promise<RoutingDecision | null> {
    const hooks = this.registry.getRoutingStrategyHooks();

    for (const hook of hooks) {
      try {
        const decision = await hook.execute(context);

        if (decision.confidence > 0.7) {
          console.log(`[Hooks] Routing decision by ${hook.name}: ${decision.gatewayType} (confidence: ${decision.confidence})`);
          return decision;
        }
      } catch (error) {
        console.error(`[Hooks] Error in RoutingStrategy hook ${hook.name}:`, error);
      }
    }

    return null; // No high-confidence decision
  }

  /**
   * Execute enrichment hooks
   */
  async executeEnrichment(context: HookContext): Promise<Record<string, unknown>> {
    const hooks = this.registry.getEnrichmentHooks();

    const metadata: Record<string, unknown> = {};

    for (const hook of hooks) {
      try {
        const result = await hook.execute(context);
        Object.assign(metadata, result.metadata);
      } catch (error) {
        console.error(`[Hooks] Error in Enrichment hook ${hook.name}:`, error);
      }
    }

    return metadata;
  }

  /**
   * Execute event listener hooks
   */
  async executeEventListeners(
    event: DomainEvent,
    context: HookContext
  ): Promise<void> {
    const hooks = this.registry.getEventListenerHooks(event.eventType);

    await Promise.all(
      hooks.map(async (hook) => {
        try {
          await hook.execute(event, context);
        } catch (error) {
          console.error(`[Hooks] Error in EventListener hook ${hook.name}:`, error);
        }
      })
    );
  }

  /**
   * Execute metrics collector hooks
   */
  async executeMetricsCollectors(
    metricName: string,
    value: number,
    tags: Record<string, string>
  ): Promise<void> {
    const hooks = this.registry.getMetricsCollectorHooks();

    await Promise.all(
      hooks.map(async (hook) => {
        try {
          await hook.execute(metricName, value, tags);
        } catch (error) {
          console.error(`[Hooks] Error in MetricsCollector hook ${hook.name}:`, error);
        }
      })
    );
  }

  /**
   * Execute error handler hooks
   */
  async executeErrorHandlers(
    context: ErrorContext
  ): Promise<ErrorHandlingResult | null> {
    const hooks = this.registry.getErrorHandlerHooks(context.error);

    for (const hook of hooks) {
      try {
        const result = await hook.execute(context);

        if (result.handled) {
          console.log(`[Hooks] Error handled by ${hook.name}: ${result.alternativeAction || 'no action'}`);
          return result;
        }
      } catch (error) {
        console.error(`[Hooks] Error in ErrorHandler hook ${hook.name}:`, error);
      }
    }

    return null; // No handler could handle it
  }
}

// ============================================================================
// BUILT-IN HOOKS
// ============================================================================

/**
 * Example: High-value payment fraud check
 */
export class HighValueFraudCheck implements FraudCheckHook {
  name = 'HighValueFraudCheck';
  priority = 100;
  enabled = true;

  constructor(private threshold: number = 10000) { }

  async execute(context: HookContext): Promise<FraudCheckResult> {
    if (context.payment.amount.isGreaterThan(new (context.payment.amount.constructor as typeof import('../domain/types').Money)(this.threshold, context.payment.amount.currency))) {
      return {
        allowed: false,
        riskScore: 0.9,
        reason: `Payment amount ${context.payment.amount.amount} exceeds threshold ${this.threshold}`,
        metadata: {
          threshold: this.threshold,
          amount: context.payment.amount.amount,
        },
      };
    }

    return {
      allowed: true,
      riskScore: 0.1,
    };
  }
}

/**
 * Example: Geographic fraud check
 */
export class GeographicFraudCheck implements FraudCheckHook {
  name = 'GeographicFraudCheck';
  priority = 90;
  enabled = true;

  constructor(private blockedCountries: string[] = []) { }

  async execute(context: HookContext): Promise<FraudCheckResult> {
    const country = context.metadata.country as string | undefined;

    if (country && this.blockedCountries.includes(country)) {
      return {
        allowed: false,
        riskScore: 1.0,
        reason: `Country ${country} is blocked`,
        metadata: {
          country,
          blockedCountries: this.blockedCountries,
        },
      };
    }

    return {
      allowed: true,
      riskScore: 0.0,
    };
  }
}

/**
 * Example: Payment logging event listener
 */
export class PaymentLoggingListener implements EventListenerHook {
  name = 'PaymentLoggingListener';
  priority = 0;
  enabled = true;
  eventTypes = ['PaymentProcessed', 'PaymentFailed', 'PaymentRefunded'];

  async execute(event: DomainEvent, context: HookContext): Promise<void> {
    console.log(`[PaymentLog] ${event.eventType}: ${context.payment.id}`);
  }
}
