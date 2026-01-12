/**
 * Example usage of AegisPay SDK
 */

import { AegisPay, Currency, PaymentMethodType, GatewayType, RoutingStrategy } from './index';

async function main(): Promise<void> {
  // Initialize SDK with configuration
  const aegisPay = new AegisPay({
    routing: {
      strategy: RoutingStrategy.HIGHEST_SUCCESS_RATE,
      rules: [
        {
          id: 'rule-1',
          priority: 10,
          conditions: [
            {
              field: 'amount',
              operator: 'greaterThan',
              value: 1000,
            },
          ],
          gatewayType: GatewayType.MOCK,
          enabled: true,
        },
      ],
    },
    retry: {
      maxRetries: 3,
      initialDelayMs: 1000,
    },
    logging: {
      enabled: true,
    },
  });

  // Register payment gateways
  aegisPay.registerGateway(GatewayType.MOCK, {
    apiKey: 'mock_key',
    apiSecret: 'mock_secret',
  });

  console.log('='.repeat(60));
  console.log('AegisPay SDK Example');
  console.log('='.repeat(60));

  try {
    // 1. Create a payment
    console.log('\n1. Creating payment...');
    const payment = await aegisPay.createPayment({
      idempotencyKey: `idm_${Date.now()}`,
      amount: 100.0,
      currency: Currency.USD,
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'John Doe',
        },
      },
      customer: {
        id: 'cust_123',
        email: 'john.doe@example.com',
        name: 'John Doe',
        billingAddress: {
          line1: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          postalCode: '94102',
          country: 'US',
        },
      },
      metadata: {
        orderId: 'order_123',
      },
    });

    console.log('✓ Payment created:', {
      id: payment.id,
      state: payment.state,
      amount: payment.amount.toJSON(),
    });

    // 2. Test idempotency - create again with same key
    console.log('\n2. Testing idempotency (same key)...');
    const duplicatePayment = await aegisPay.createPayment({
      idempotencyKey: payment.idempotencyKey,
      amount: 100.0,
      currency: Currency.USD,
      paymentMethod: {
        type: PaymentMethodType.CARD,
        details: {
          cardNumber: '4242424242424242',
          expiryMonth: '12',
          expiryYear: '2025',
          cvv: '123',
          cardHolderName: 'John Doe',
        },
      },
      customer: {
        id: 'cust_123',
        email: 'john.doe@example.com',
      },
    });

    console.log('✓ Idempotency works:', {
      sameId: payment.id === duplicatePayment.id,
      originalId: payment.id,
      duplicateId: duplicatePayment.id,
    });

    // 3. Process the payment
    console.log('\n3. Processing payment...');
    const processedPayment = await aegisPay.processPayment({
      paymentId: payment.id,
    });

    console.log('✓ Payment processed:', {
      id: processedPayment.id,
      state: processedPayment.state,
      gatewayType: processedPayment.gatewayType,
      gatewayTransactionId: processedPayment.gatewayTransactionId,
    });

    // 4. Retrieve payment
    console.log('\n4. Retrieving payment...');
    const retrievedPayment = await aegisPay.getPayment(payment.id);
    console.log('✓ Payment retrieved:', {
      id: retrievedPayment?.id,
      state: retrievedPayment?.state,
    });

    // 5. Get customer payments
    console.log('\n5. Getting customer payments...');
    const customerPayments = await aegisPay.getCustomerPayments('cust_123');
    console.log('✓ Customer payments:', customerPayments.length);

    // 6. Check metrics
    console.log('\n6. SDK Metrics:');
    const metrics = aegisPay.getMetrics();
    console.log(JSON.stringify(metrics, null, 2));

    // 7. Check gateway health
    console.log('\n7. Gateway Health:');
    const health = aegisPay.getHealthSummary();
    console.log(JSON.stringify(health, null, 2));

    // 8. Gateway metrics
    console.log('\n8. Gateway Metrics:');
    const gatewayMetrics = aegisPay.getGatewayMetrics();
    console.log(JSON.stringify(gatewayMetrics, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('✓ All operations completed successfully!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('✗ Error:', error);
  }
}

// Run the example
main();
