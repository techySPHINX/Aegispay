/**
 * State Machine Demonstration
 *
 * This file demonstrates the formal payment state machine with:
 * - Valid and invalid transitions
 * - Invariant enforcement
 * - Concurrency safety mechanisms
 * - Terminal state protection
 */

import { Payment } from '../domain/payment';
import {
  PaymentState,
  Money,
  Currency,
  PaymentMethodType,
  GatewayType,
  CardDetails,
} from '../domain/types';
import {
  PaymentStateMachine,
  visualizeStateMachine,
  generateDotGraph,
  compareAndSwapTransition,
  InvalidStateTransitionError,
  InvariantViolationError,
  ConcurrentModificationError,
  StateMachineProperties,
} from '../domain/paymentStateMachine';

// ============================================================================
// DEMO 1: Visualize State Machine
// ============================================================================

console.log('═══════════════════════════════════════════════════════════');
console.log('DEMO 1: State Machine Visualization');
console.log('═══════════════════════════════════════════════════════════\n');

console.log(visualizeStateMachine());

// ============================================================================
// DEMO 2: Valid State Transitions
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════════');
console.log('DEMO 2: Valid State Transitions');
console.log('═══════════════════════════════════════════════════════════\n');

// Create a payment
let payment = new Payment({
  id: 'pay_demo_001',
  idempotencyKey: 'idem_demo_001',
  state: PaymentState.INITIATED,
  amount: new Money(100.0, Currency.USD),
  paymentMethod: {
    type: PaymentMethodType.CARD,
    details: {
      expiryMonth: '12',
      expiryYear: '2025',
    } as CardDetails,
  },
  customer: {
    id: 'cust_001',
    email: 'demo@example.com',
    name: 'Demo User',
  },
});

console.log('Initial payment state:', payment.state);

// Valid transition 1: INITIATED → AUTHENTICATED
try {
  payment = payment.authenticate(GatewayType.STRIPE);
  console.log('✓ Transition 1: INITIATED → AUTHENTICATED (SUCCESS)');
  console.log('  Current state:', payment.state);
} catch (error) {
  console.error('✗ Transition failed:', error);
}

// Valid transition 2: AUTHENTICATED → PROCESSING
try {
  payment = payment.startProcessing('txn_stripe_12345');
  console.log('✓ Transition 2: AUTHENTICATED → PROCESSING (SUCCESS)');
  console.log('  Current state:', payment.state);
} catch (error) {
  console.error('✗ Transition failed:', error);
}

// Valid transition 3: PROCESSING → SUCCESS
try {
  payment = payment.markSuccess();
  console.log('✓ Transition 3: PROCESSING → SUCCESS (SUCCESS)');
  console.log('  Current state:', payment.state);
} catch (error) {
  console.error('✗ Transition failed:', error);
}

// ============================================================================
// DEMO 3: Invalid Transitions (Early Rejection)
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════════');
console.log('DEMO 3: Invalid Transitions - Early Rejection');
console.log('═══════════════════════════════════════════════════════════\n');

// Example of invalid transition attempt - commented out to avoid unused variable
/*
const _payment2 = new Payment({
  id: 'pay_demo_002',
  idempotencyKey: 'idem_demo_002',
  state: PaymentState.INITIATED,
  amount: new Money(50.00, Currency.USD),
  paymentMethod: {
    type: PaymentMethodType.UPI,
    details: {
      vpa: 'user@upi',
    },
  },
  customer: {
    id: 'cust_002',
    email: 'user@example.com',
    name: 'Test User',
  },
});
*/

console.log('Attempting invalid transition: INITIATED → SUCCESS');
const canTransition = PaymentStateMachine.canTransition(
  PaymentState.INITIATED,
  PaymentState.SUCCESS
);
console.log('Can transition?', canTransition);

if (!canTransition) {
  const metadata = PaymentStateMachine.getTransitionMetadata(
    PaymentState.INITIATED,
    PaymentState.SUCCESS
  );
  console.log('Reason:', metadata.reason);
}

// ============================================================================
// DEMO 4: Terminal State Invariant
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════════');
console.log('DEMO 4: Terminal State Invariant (Immutability)');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('Current payment state:', payment.state, '(TERMINAL)');
console.log('Attempting to transition from SUCCESS → PROCESSING...\n');

try {
  // This will throw InvariantViolationError
  payment.startProcessing('txn_impossible');
  console.log('✗ This should never print!');
} catch (error) {
  if (error instanceof InvariantViolationError) {
    console.log('✓ Caught InvariantViolationError (expected):');
    console.log('  State:', error.state);
    console.log('  Invariant:', error.invariant);
    console.log('  Details:', error.details);
  } else if (error instanceof InvalidStateTransitionError) {
    console.log('✓ Caught InvalidStateTransitionError (expected):');
    console.log('  From:', error.from);
    console.log('  To:', error.to);
    console.log('  Message:', error.message);
  }
}

// Check terminal state property
console.log('\nIs SUCCESS terminal?', PaymentStateMachine.isTerminalState(PaymentState.SUCCESS));
console.log(
  'Is PROCESSING terminal?',
  PaymentStateMachine.isTerminalState(PaymentState.PROCESSING)
);

// ============================================================================
// DEMO 5: State Metadata & Introspection
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════════');
console.log('DEMO 5: State Metadata & Introspection');
console.log('═══════════════════════════════════════════════════════════\n');

const states = [
  PaymentState.INITIATED,
  PaymentState.AUTHENTICATED,
  PaymentState.PROCESSING,
  PaymentState.SUCCESS,
];

states.forEach((state) => {
  const metadata = PaymentStateMachine.getStateMetadata(state);
  console.log(`State: ${state}`);
  console.log(`  Terminal: ${metadata.isTerminal}`);
  console.log(`  Initial: ${metadata.isInitial}`);
  console.log(`  Valid Next States: [${metadata.validNextStates.join(', ') || 'none'}]`);
  console.log(`  Invariants: ${metadata.invariants.length} defined\n`);
});

// ============================================================================
// DEMO 6: Compare-and-Swap for Concurrency
// ============================================================================

console.log('═══════════════════════════════════════════════════════════');
console.log('DEMO 6: Compare-and-Swap (Concurrency Safety)');
console.log('═══════════════════════════════════════════════════════════\n');

// Simulate concurrent modification
const expectedState = PaymentState.INITIATED;
const actualStateProcess1 = PaymentState.INITIATED;
const actualStateProcess2 = PaymentState.AUTHENTICATED; // Already changed by Process 1

console.log('Process 1: Read state =', actualStateProcess1);
console.log('Process 2: Read state =', expectedState, '(stale!)');
console.log('Process 1: Successfully transitions to AUTHENTICATED\n');

// Process 1 succeeds
try {
  compareAndSwapTransition(expectedState, actualStateProcess1, PaymentState.AUTHENTICATED);
  console.log('✓ Process 1: CAS succeeded (INITIATED → AUTHENTICATED)');
} catch (error) {
  console.log('✗ Process 1: CAS failed:', error);
}

// Process 2 fails (state changed)
console.log('\nProcess 2: Attempts same transition with stale state...');
try {
  compareAndSwapTransition(
    expectedState,
    actualStateProcess2, // This is now AUTHENTICATED, not INITIATED
    PaymentState.AUTHENTICATED
  );
  console.log('✗ This should never print!');
} catch (error) {
  if (error instanceof ConcurrentModificationError) {
    console.log('✓ Process 2: Caught ConcurrentModificationError (expected):');
    console.log('  Expected:', error.expectedState);
    console.log('  Actual:', error.actualState);
    console.log('  Attempted:', error.attemptedNewState);
    console.log('  → Process 2 must retry with fresh state');
  }
}

// ============================================================================
// DEMO 7: State Machine Verification
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════════');
console.log('DEMO 7: State Machine Self-Verification');
console.log('═══════════════════════════════════════════════════════════\n');

const verification = PaymentStateMachine.verifyStateMachineProperties();

console.log('State machine valid?', verification.valid);
if (verification.valid) {
  console.log('✓ All invariants satisfied:');
  console.log('  • All states are defined');
  console.log('  • Terminal states have no outgoing transitions');
  console.log('  • All states are reachable from INITIATED');
  console.log('  • State machine is well-formed');
} else {
  console.error('✗ Invariants violated:');
  verification.errors.forEach((err) => console.error('  -', err));
}

// ============================================================================
// DEMO 8: Graphviz DOT Export
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════════');
console.log('DEMO 8: Graphviz DOT Graph Export');
console.log('═══════════════════════════════════════════════════════════\n');

const dot = generateDotGraph();
console.log('Generated Graphviz DOT format:');
console.log('─────────────────────────────────────────────────────────\n');
console.log(dot);
console.log('─────────────────────────────────────────────────────────');
console.log('To visualize: dot -Tpng output.dot -o state_machine.png');

// ============================================================================
// DEMO 9: State Machine Properties
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════════');
console.log('DEMO 9: State Machine Properties');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('All states:', StateMachineProperties.states);
console.log('Initial state:', StateMachineProperties.initialState);
console.log('Terminal states:', StateMachineProperties.terminalStates);
console.log(
  'Total transitions defined:',
  Array.from(StateMachineProperties.transitionMap.values()).reduce((sum, set) => sum + set.size, 0)
);

console.log('\n═══════════════════════════════════════════════════════════');
console.log('All demos completed successfully!');
console.log('═══════════════════════════════════════════════════════════\n');
