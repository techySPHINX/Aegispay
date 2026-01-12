/**
 * AegisPay - Production-Ready Example
 *
 * This example demonstrates production-ready payment processing
 * with proper error handling, validation, and best practices.
 */

import {
  AegisPay,
  GatewayType,
  Currency,
  PaymentMethodType,
  PaymentState,
  CreatePaymentRequest,
  LogLevel,
  RoutingStrategy,
} from './index';

/**
 * Initialize AegisPay with production configuration
 */
function initializeSDK(): AegisPay {
  const aegis = new AegisPay({
    logging: {
      level: LogLevel.INFO, // Use INFO or WARN in production
    },
    retry: {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
    },
    routing: {
      strategy: RoutingStrategy.COST_OPTIMIZED, // Optimizes for cost
    },
    events: {
      logToConsole: false, // Disable console logging in production
    },
  });

  // Register payment gateways
  aegis.registerGateway(GatewayType.MOCK, {
    apiKey: process.env.MOCK_GATEWAY_API_KEY || 'test-key',
    timeout: 30000,
  });

  return aegis;
}

/**
 * Process a payment with comprehensive error handling
 */
async function processPayment(
  aegis: AegisPay,
  orderId: string,
  amount: number,
  customerId: string,
  customerEmail: string
): Promise<void> {
  try {
    console.log(`\n🔄 Processing payment for order ${orderId}...`);

    // Create payment with idempotency key
    const createRequest: CreatePaymentRequest = {
      idempotencyKey: `order_${orderId}_${Date.now()}`,
      amount,
      currency: Currency.USD,
      customer: {
        id: customerId,
        email: customerEmail,
        name: 'John Doe',
      },
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242', // Test card
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'John Doe',
        },
      },
      metadata: {
        orderId,
        source: 'web',
      },
    };

    // Create payment
    const payment = await aegis.createPayment(createRequest);
    console.log(`✅ Payment created: ${payment.id}`);
    console.log(`   State: ${payment.state}`);
    console.log(`   Amount: $${payment.amount.amount} ${payment.amount.currency}`);

    // Process payment through gateway
    const processedPayment = await aegis.processPayment({
      paymentId: payment.id,
    });

    if (processedPayment.state === PaymentState.SUCCESS) {
      console.log(`\n🎉 Payment successful!`);
      console.log(`   Payment ID: ${processedPayment.id}`);
      console.log(`   Gateway Transaction ID: ${processedPayment.gatewayTransactionId}`);
    } else {
      console.log(`\n⚠️  Payment not successful`);
      console.log(`   State: ${processedPayment.state}`);
      console.log(`   Reason: ${processedPayment.failureReason || 'Unknown'}`);
    }
  } catch (error) {
    console.error(`\n❌ Payment failed:`, error);

    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);

      // Handle specific error types
      if (error.message.includes('Validation failed')) {
        console.error('   → Check payment details and try again');
      } else if (error.message.includes('Gateway')) {
        console.error('   → Gateway error - may be temporary, retry later');
      } else if (error.message.includes('timeout')) {
        console.error('   → Request timeout - check network connectivity');
      }
    }

    throw error;
  }
}

/**
 * Demonstrate idempotency - multiple calls with same key return same payment
 */
async function demonstrateIdempotency(aegis: AegisPay): Promise<void> {
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📋 Demonstrating Idempotency`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const idempotencyKey = `demo_idempotency_${Date.now()}`;

  const request: CreatePaymentRequest = {
    idempotencyKey,
    amount: 50.0,
    currency: Currency.USD,
    customer: {
      id: 'cust_demo',
      email: 'demo@example.com',
    },
    paymentMethod: {
      type: PaymentMethodType.CARD,
      details: {
        cardNumber: '4242424242424242',
        expiryMonth: '12',
        expiryYear: '2025',
        cvv: '123',
        cardHolderName: 'Demo User',
      },
    },
  };

  // Create payment first time
  const payment1 = await aegis.createPayment(request);
  console.log(`First call - Payment created: ${payment1.id}`);

  // Create payment second time with same idempotency key
  const payment2 = await aegis.createPayment(request);
  console.log(`Second call - Payment returned: ${payment2.id}`);

  // Verify they're the same payment
  if (payment1.id === payment2.id) {
    console.log(`\n✅ Idempotency working! Same payment returned for duplicate requests.`);
  } else {
    console.log(`\n❌ Idempotency failed! Different payments created.`);
  }
}

/**
 * Check SDK health and metrics
 */
async function checkHealth(aegis: AegisPay): Promise<void> {
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 SDK Health & Metrics`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Get overall health
  const health = aegis.getHealthSummary();
  console.log('Gateway Health:', JSON.stringify(health, null, 2));

  // Get metrics
  const metrics = aegis.getMetrics();
  console.log('\nSDK Metrics:', JSON.stringify(metrics, null, 2));

  // Get gateway-specific metrics
  const mockMetrics = aegis.getGatewayMetrics(GatewayType.MOCK);
  console.log('\nMock Gateway Metrics:', JSON.stringify(mockMetrics, null, 2));
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║          AegisPay Production Example              ║
║     Enterprise Payment Processing SDK             ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);

  try {
    // Initialize SDK
    const aegis = initializeSDK();
    console.log('\n✅ AegisPay SDK initialized\n');

    // Example 1: Process standard payment
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💳 Example 1: Standard Payment`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    await processPayment(aegis, 'ORD-001', 99.99, 'cust_001', 'customer1@example.com');

    // Example 2: Process another payment
    console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💳 Example 2: Another Payment`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    await processPayment(aegis, 'ORD-002', 149.5, 'cust_002', 'customer2@example.com');

    // Example 3: Demonstrate idempotency
    await demonstrateIdempotency(aegis);

    // Example 4: Check health and metrics
    await checkHealth(aegis);

    console.log(`\n\n✅ All examples completed successfully!\n`);
  } catch (error) {
    console.error(`\n❌ Example execution failed:`, error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n👋 Example completed. Exiting...\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}

// Export for use in other modules
export { initializeSDK, processPayment };
