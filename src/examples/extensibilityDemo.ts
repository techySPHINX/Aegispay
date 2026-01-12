/**
 * SDK EXTENSIBILITY DEMO
 *
 * Demonstrates how extensibility hooks enable low-code/no-code usage.
 *
 * KEY CONCEPTS:
 * =============
 * 1. Core Logic Untouched - Payment processing stays simple
 * 2. Declarative Configuration - Define behavior without code
 * 3. Plugin Architecture - Mix and match extensions
 * 4. Graceful Degradation - Hooks fail without breaking payments
 * 5. Framework Thinking - Inversion of control
 *
 * USE CASES:
 * ==========
 * 1. Custom Fraud Detection
 * 2. Dynamic Gateway Routing
 * 3. Business Rule Validation
 * 4. Event-Driven Integration
 * 5. Custom Metrics & Logging
 *
 * HOW THIS ENABLES LOW-CODE/NO-CODE:
 * ===================================
 * Users can configure hooks via JSON instead of writing TypeScript.
 * Visual builders can generate these configurations.
 * Marketplace can provide pre-built hooks.
 */

import {
  HookRegistry,
  HookExecutor,
  FraudCheckHook,
  RoutingStrategyHook,
  EventListenerHook,
  LifecycleHook,
  HookContext,
  RoutingContext,
} from '../orchestration/hooks';
import { Payment } from '../domain/payment';
import { GatewayType, Money, Currency, PaymentState, PaymentMethodType } from '../domain/types';
import { DomainEvent, EventType } from '../domain/events';

/**
 * EXAMPLE 1: Custom Fraud Check (Code-Based)
 */
class VIPCustomerFraudCheck implements FraudCheckHook {
  name = 'VIPCustomerFraudCheck';
  priority = 100;
  enabled = true;

  async execute(context: HookContext): Promise<{
    allowed: boolean;
    riskScore: number;
    reason?: string;
    metadata?: Record<string, unknown>;
  }> {
    const isVIP = context.metadata.customerType === 'VIP';

    if (isVIP) {
      console.log(`✓ VIP customer - fraud check bypassed`);
      return {
        allowed: true,
        riskScore: 0.0,
        reason: 'VIP customer - trusted',
        metadata: { customerType: 'VIP' },
      };
    }

    return { allowed: true, riskScore: 0.1 };
  }
}

/**
 * EXAMPLE 2: Custom Routing Strategy (Code-Based)
 */
class CostOptimizedRouting implements RoutingStrategyHook {
  name = 'CostOptimizedRouting';
  priority = 90;
  enabled = true;

  async execute(context: HookContext): Promise<{
    gatewayType: GatewayType;
    confidence: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }> {
    const amount = context.payment.amount.amount;

    // Route small payments to cheaper gateway
    if (amount < 50) {
      return {
        gatewayType: GatewayType.MOCK,
        confidence: 0.9,
        reason: 'Small payment - using cheaper gateway',
        metadata: { costSaving: 0.1 },
      };
    }

    // Route large payments to premium gateway
    if (amount > 1000) {
      return {
        gatewayType: GatewayType.STRIPE,
        confidence: 0.95,
        reason: 'Large payment - using premium gateway',
        metadata: { reliability: 'high' },
      };
    }

    return {
      gatewayType: GatewayType.STRIPE,
      confidence: 0.5,
      reason: 'Default routing',
    };
  }
}

/**
 * EXAMPLE 3: Slack Notification Hook
 */
class SlackNotificationListener implements EventListenerHook {
  name = 'SlackNotification';
  priority = 0;
  enabled = true;
  eventTypes = ['PaymentFailed', 'PaymentRefunded'];

  async execute(event: DomainEvent, context: HookContext): Promise<void> {
    console.log(`📱 Slack notification: ${event.eventType} for payment ${context.payment.id}`);
    // In production: await slack.sendMessage(...)
  }
}

/**
 * EXAMPLE 4: Audit Log Lifecycle Hook
 */
class AuditLogLifecycle implements LifecycleHook {
  name = 'AuditLog';
  priority = 100;
  enabled = true;
  operation = 'process_payment';
  stage: 'before' | 'after' = 'after';

  async execute(context: HookContext): Promise<void> {
    console.log(`📝 Audit log: Payment ${context.payment.id} processed`);
    // In production: await auditLog.write(...)
  }
}

/**
 * DEMO: Code-Based Hooks
 */
async function demoCodeBasedHooks(): Promise<void> {
  console.log('\n=== CODE-BASED HOOKS DEMO ===\n');

  const registry = new HookRegistry();
  const executor = new HookExecutor(registry);

  // Register custom hooks
  registry.registerFraudCheck(new VIPCustomerFraudCheck());
  registry.registerRoutingStrategy(new CostOptimizedRouting());
  registry.registerEventListener(new SlackNotificationListener());
  registry.registerLifecycleHook(new AuditLogLifecycle());

  // Create test payment
  const payment = new Payment({
    id: 'pay_001',
    idempotencyKey: 'idem_001',
    state: PaymentState.INITIATED,
    amount: new Money(2500, Currency.USD),
    paymentMethod: {
      type: PaymentMethodType.CARD,
      details: {
        cardNumber: '****',
        expiryMonth: '12',
        expiryYear: '25',
        cvv: '***',
        cardHolderName: 'VIP Customer',
      },
    },
    customer: { id: 'cust_vip', email: 'vip@example.com' },
    gatewayType: GatewayType.STRIPE,
  });

  const context: HookContext = {
    payment,
    timestamp: new Date(),
    requestId: 'req_001',
    metadata: {
      customerType: 'VIP',
      country: 'US',
    },
  };

  // Execute fraud check
  console.log('Running fraud check...');
  const fraudResult = await executor.executeFraudChecks(context);
  console.log('Fraud check result:', fraudResult);

  // Execute routing
  console.log('\nRunning routing strategy...');
  const routingContext: RoutingContext = {
    ...context,
    availableGateways: [GatewayType.STRIPE, GatewayType.PAYPAL, GatewayType.MOCK],
    gatewayMetrics: new Map(),
  };
  const routingResult = await executor.executeRoutingStrategy(routingContext);
  console.log('Routing decision:', routingResult);

  // Execute event listeners
  console.log('\nTriggering event listeners...');
  const event: DomainEvent = {
    eventId: 'evt_001',
    eventType: EventType.PAYMENT_FAILED,
    aggregateId: 'pay_001',
    timestamp: new Date(),
    version: 1,
    metadata: { reason: 'Insufficient funds' },
  };
  await executor.executeEventListeners(event, context);

  // Execute lifecycle hooks
  console.log('\nExecuting lifecycle hooks...');
  const lifecycleHooks = registry.getLifecycleHooks('process_payment', 'after');
  for (const hook of lifecycleHooks) {
    await hook.execute(context);
  }
}

/**
 * DEMO: No-Code Hooks (Configuration-Based)
 */
async function demoNoCodeHooks(): Promise<void> {
  console.log('\n\n=== NO-CODE HOOKS DEMO ===\n');

  const registry = new HookRegistry();
  const executor = new HookExecutor(registry);

  // Define hooks via configuration (could come from JSON file or UI)
  const fraudCheckConfig = {
    name: 'HighValueCheck',
    priority: 100,
    rules: [
      {
        condition: 'amount > 10000',
        riskScore: 0.9,
        reason: 'High value payment requires approval',
        block: true,
      },
      {
        condition: 'amount > 5000',
        riskScore: 0.7,
        reason: 'Medium-high value payment',
        block: false,
      },
    ],
  };

  const routingConfig = {
    name: 'CountryBasedRouting',
    priority: 90,
    rules: [
      {
        condition: 'country = US',
        gateway: GatewayType.STRIPE,
        confidence: 0.95,
        reason: 'US customers prefer Stripe',
      },
      {
        condition: 'country = UK',
        gateway: GatewayType.PAYPAL,
        confidence: 0.9,
        reason: 'UK customers prefer PayPal',
      },
    ],
  };

  const validationConfig = {
    name: 'BusinessRules',
    priority: 80,
    checks: [
      {
        field: 'payment.amount.amount',
        operator: 'gte' as const,
        value: 1,
        errorMessage: 'Payment amount must be at least $1',
      },
      {
        field: 'metadata.country',
        operator: 'ne' as const,
        value: 'XX',
        errorMessage: 'Invalid country code',
      },
    ],
  };

  // Register hooks from config (NO CODE REQUIRED!)
  console.log('Registering hooks from configuration...\n');
  registry.registerFromConfig('fraudCheck', fraudCheckConfig);
  registry.registerFromConfig('routing', routingConfig);
  registry.registerFromConfig('validation', validationConfig);

  // Test with high-value payment
  console.log('Test 1: High-value payment ($15,000)');
  const payment1 = new Payment({
    id: 'pay_002',
    idempotencyKey: 'idem_002',
    state: PaymentState.INITIATED,
    amount: new Money(15000, Currency.USD),
    paymentMethod: {
      type: PaymentMethodType.CARD,
      details: {
        cardNumber: '****',
        expiryMonth: '12',
        expiryYear: '25',
        cvv: '***',
        cardHolderName: 'Customer 2',
      },
    },
    customer: { id: 'cust_002', email: 'cust002@example.com' },
    gatewayType: GatewayType.STRIPE,
  });

  const context1: HookContext = {
    payment: payment1,
    timestamp: new Date(),
    requestId: 'req_002',
    metadata: { country: 'US', amount: 15000 },
  };

  const fraudResult1 = await executor.executeFraudChecks(context1);
  console.log('Fraud result:', fraudResult1);
  console.log(fraudResult1.allowed ? '✓ Allowed' : '✗ Blocked\n');

  // Test with medium-value payment
  console.log('\nTest 2: Medium-value payment ($100) from US');
  const payment2 = new Payment({
    id: 'pay_003',
    idempotencyKey: 'idem_003',
    state: PaymentState.INITIATED,
    amount: new Money(100, Currency.USD),
    paymentMethod: {
      type: PaymentMethodType.CARD,
      details: {
        cardNumber: '****',
        expiryMonth: '12',
        expiryYear: '25',
        cvv: '***',
        cardHolderName: 'Customer 3',
      },
    },
    customer: { id: 'cust_003', email: 'cust003@example.com' },
    gatewayType: GatewayType.STRIPE,
  });

  const context2: RoutingContext = {
    payment: payment2,
    timestamp: new Date(),
    requestId: 'req_003',
    metadata: { country: 'US', amount: 100 },
    availableGateways: [GatewayType.STRIPE, GatewayType.PAYPAL],
    gatewayMetrics: new Map(),
  };

  const fraudResult2 = await executor.executeFraudChecks(context2);
  console.log('Fraud result:', fraudResult2);

  const routingResult2 = await executor.executeRoutingStrategy(context2);
  console.log('Routing decision:', routingResult2);

  // Test validation
  console.log('\nTest 3: Validation check');
  const validationResult = await executor.executePreValidation(context2);
  console.log('Validation result:', validationResult);
}

/**
 * DEMO: Marketplace-Style Pre-Built Hooks
 */
function demoMarketplaceHooks(): void {
  console.log('\n\n=== MARKETPLACE HOOKS DEMO ===\n');

  console.log(`
AEGISPAY EXTENSION MARKETPLACE
===============================

📦 Available Extensions:

1. 🔐 Fraud Detection Pack
   - ML-Based Risk Scoring
   - Device Fingerprinting
   - Velocity Checks
   - Price: $99/month

2. 🌍 Geographic Routing
   - Country-Based Gateway Selection
   - Currency Optimization
   - Regional Compliance
   - Price: $49/month

3. 📊 Analytics Suite
   - Real-Time Dashboards
   - Custom Metrics
   - Export to DataDog, New Relic
   - Price: $79/month

4. 🔔 Notification Pack
   - Slack Integration
   - Email Alerts
   - SMS Notifications
   - Webhook Callbacks
   - Price: $29/month

5. 💼 Enterprise Compliance
   - PCI-DSS Validation
   - Audit Logging
   - GDPR Data Handling
   - SOC2 Reports
   - Price: $199/month

INSTALLATION (NO-CODE):
=======================
1. Click "Install" in marketplace
2. Configure via web UI
3. Hooks automatically registered
4. No code changes required!

EXAMPLE CONFIG (JSON):
{
  "extensions": [
    {
      "name": "@aegispay/fraud-detection",
      "version": "1.2.0",
      "config": {
        "riskThreshold": 0.8,
        "enableML": true
      }
    },
    {
      "name": "@aegispay/slack-notifications",
      "version": "2.0.1",
      "config": {
        "webhookUrl": "https://hooks.slack.com/...",
        "channel": "#payments"
      }
    }
  ]
}
  `);
}

/**
 * Show how core logic remains untouched
 */
function demonstrateCoreIntegrity(): void {
  console.log('\n\n=== CORE LOGIC INTEGRITY ===\n');

  console.log(`
CORE PAYMENT PROCESSING (SIMPLIFIED):
======================================

async function processPayment(payment: Payment): Promise<Result<Payment>> {
  // 1. Run hooks (optional, non-breaking)
  await hooks.runPreValidation(payment);
  await hooks.runFraudCheck(payment);
  
  // 2. Core logic (unchanged, tested, reliable)
  const gateway = await selectGateway(payment);
  const result = await gateway.process(payment);
  
  // 3. Run hooks (optional, non-breaking)
  await hooks.runPostProcessing(payment);
  await hooks.notifyListeners(payment);
  
  return result;
}

KEY BENEFITS:
=============
✓ Core logic is simple and testable
✓ Extensions can't break payments
✓ Hooks fail gracefully (logged, not thrown)
✓ Can disable any hook without code changes
✓ New hooks don't require core modifications
✓ Framework handles hook orchestration

TESTING IMPACT:
===============
Before Hooks: 10 core tests
After Hooks:  10 core tests + N hook tests

Core tests unchanged = Core logic unchanged
Each hook tested independently
Integration tests verify hook execution
  `);
}

// Run all demos
if (require.main === module) {
  (async (): Promise<void> => {
    await demoCodeBasedHooks();
    await demoNoCodeHooks();
    demoMarketplaceHooks();
    demonstrateCoreIntegrity();

    console.log('\n\n=== SUMMARY ===\n');
    console.log(`
SDK EXTENSIBILITY ENABLES:
==========================
1. ✓ Low-Code: Hooks defined in JSON/YAML
2. ✓ No-Code: Visual builders generate configs
3. ✓ Marketplace: Pre-built extensions
4. ✓ Enterprise: Custom integrations without forking
5. ✓ Future-Proof: New features via hooks, not core changes

CORE PRINCIPLES DEMONSTRATED:
==============================
- Open/Closed: Open for extension, closed for modification
- Inversion of Control: Framework calls your code
- Separation of Concerns: Business logic vs. extensions
- Graceful Degradation: System works without hooks
- Type Safety: Full TypeScript support

NEXT STEPS:
===========
→ Build visual hook editor
→ Create extension marketplace
→ Add hook templates library
→ Implement hot-reload for hooks
→ Add hook performance monitoring
    `);
  })();
}

export { demoCodeBasedHooks, demoNoCodeHooks, demoMarketplaceHooks, demonstrateCoreIntegrity };
