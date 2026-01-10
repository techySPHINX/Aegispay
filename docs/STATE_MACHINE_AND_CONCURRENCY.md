# Formal Payment State Machine & Concurrency Safety

## Overview

This document explains how the **formal state machine** implementation prevents inconsistent payment states under concurrent execution. The state machine uses principles from formal verification, database theory, and distributed systems to guarantee correctness.

---

## Mathematical Foundation

### Deterministic Finite Automaton (DFA)

The payment lifecycle is modeled as a **Deterministic Finite Automaton** with the following formal definition:

**Definition**: A DFA is a 5-tuple _(S, s₀, F, Σ, δ)_ where:

- **S** = Set of states = `{INITIATED, AUTHENTICATED, PROCESSING, SUCCESS, FAILURE}`
- **s₀** = Initial state = `INITIATED`
- **F** = Terminal states = `{SUCCESS, FAILURE}`
- **Σ** = Alphabet (events) = `{authenticate, startProcessing, succeed, fail}`
- **δ** = Transition function: _S × Σ → S ∪ {error}_

### State Transition Table

| Current State     | authenticate() | startProcessing() | succeed() | fail()   |
| ----------------- | -------------- | ----------------- | --------- | -------- |
| **INITIATED**     | AUTHENTICATED  | ❌ Error          | ❌ Error  | FAILURE  |
| **AUTHENTICATED** | ❌ Error       | PROCESSING        | ❌ Error  | FAILURE  |
| **PROCESSING**    | ❌ Error       | ❌ Error          | SUCCESS   | FAILURE  |
| **SUCCESS**       | ❌ Error       | ❌ Error          | ❌ Error  | ❌ Error |
| **FAILURE**       | ❌ Error       | ❌ Error          | ❌ Error  | ❌ Error |

---

## Key Invariants

### 1. **Terminal State Invariant** _(Mathematical Guarantee)_

**Formal Statement**:

```
∀s ∈ F, ∀e ∈ Σ: δ(s, e) = error
```

**Translation**: Once a payment reaches a terminal state (`SUCCESS` or `FAILURE`), no further transitions are possible.

**Implementation**:

```typescript
export function isTerminalState(
  state: PaymentState
): state is PaymentState.SUCCESS | PaymentState.FAILURE {
  return state === PaymentState.SUCCESS || state === PaymentState.FAILURE;
}

// This check happens BEFORE any transition validation
if (isTerminalState(from)) {
  throw new InvariantViolationError(
    state,
    'Terminal state cannot transition',
    `Attempted illegal transition from ${state} to ${attemptedTransition}`
  );
}
```

**Why This Matters**:

- Prevents "resurrection" of completed/failed payments
- Ensures audit trail integrity
- Makes refunds/chargebacks explicit separate operations
- Terminal states are **immutable** - critical for financial compliance

---

### 2. **Reachability Invariant**

**Formal Statement**:

```
∀s ∈ S: ∃ path from s₀ to s
```

**Translation**: Every state is reachable from the initial state. There are no "dead" or unreachable states.

**Verification** (in code):

```typescript
static verifyStateMachineProperties(): { valid: boolean; errors: string[] } {
  // Uses BFS to check if all states are reachable from INITIATED
  const reachable = new Set<PaymentState>([PaymentState.INITIATED]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const state of reachable) {
      const nextStates = VALID_TRANSITIONS.get(state);
      if (nextStates) {
        for (const next of nextStates) {
          if (!reachable.has(next)) {
            reachable.add(next);
            changed = true;
          }
        }
      }
    }
  }

  for (const state of allStates) {
    if (!reachable.has(state)) {
      errors.push(`State ${state} is not reachable from initial state`);
    }
  }
}
```

---

### 3. **Determinism Invariant**

**Formal Statement**:

```
∀s ∈ S, ∀e ∈ Σ: |δ(s, e)| ≤ 1
```

**Translation**: From any state, given an event, there is **at most one** next state. No ambiguity.

**Implementation**:

```typescript
// TypeScript type system enforces this at compile-time
export type ValidTransitions = {
  [PaymentState.INITIATED]: PaymentState.AUTHENTICATED | PaymentState.FAILURE;
  [PaymentState.AUTHENTICATED]: PaymentState.PROCESSING | PaymentState.FAILURE;
  [PaymentState.PROCESSING]: PaymentState.SUCCESS | PaymentState.FAILURE;
  [PaymentState.SUCCESS]: never; // NO transitions
  [PaymentState.FAILURE]: never; // NO transitions
};
```

---

## Concurrency Safety Mechanisms

### Problem: Race Conditions in Concurrent State Transitions

**Scenario**: Two concurrent processes attempt to transition a payment from the same state:

```
Time  Process A                    Process B                   Payment State
──────────────────────────────────────────────────────────────────────────────
t1    Read: state=INITIATED        Read: state=INITIATED       INITIATED
t2    Validate: INITIATED→AUTH     Validate: INITIATED→AUTH    INITIATED
t3    Write: AUTHENTICATED         (waiting...)                AUTHENTICATED
t4                                  Write: AUTHENTICATED        ??? CONFLICT!
```

**Without proper concurrency control**, Process B would overwrite Process A's change, potentially causing:

- Lost updates
- Duplicate processing
- Inconsistent state
- Double charging

---

### Solution 1: Compare-and-Swap (CAS) with State Machine Validation

**Optimistic Concurrency Control** using the state machine:

```typescript
export function compareAndSwapTransition(
  expectedState: PaymentState,
  actualState: PaymentState,
  newState: PaymentState
): void {
  // 1. Check if state has changed (optimistic lock)
  if (actualState !== expectedState) {
    throw new ConcurrentModificationError(expectedState, actualState, newState);
  }

  // 2. Validate transition using formal state machine
  PaymentStateMachine.validateTransition(actualState, newState);
}
```

**How It Works**:

1. **Read**: Process reads current state (e.g., `INITIATED`)
2. **Compute**: Process determines desired new state (e.g., `AUTHENTICATED`)
3. **Compare**: Before writing, verify current state hasn't changed
4. **Swap**: If unchanged, apply transition atomically

**With CAS**:

```
Time  Process A                           Process B                   State
──────────────────────────────────────────────────────────────────────────────
t1    Read: state=INITIATED (v1)         Read: state=INITIATED (v1)  INITIATED
t2    CAS(INITIATED→AUTH, v1)            CAS(INITIATED→AUTH, v1)
t3    ✓ SUCCESS: Write AUTHENTICATED     ✗ FAIL: Version mismatch    AUTHENTICATED
t4                                        Retry or abort              AUTHENTICATED
```

**Only one process succeeds**. The other gets `ConcurrentModificationError` and must retry.

---

### Solution 2: Event Sourcing + Version Numbers

**Every state change is an immutable event** with a version number:

```typescript
interface PaymentEvent {
  aggregateId: string;  // Payment ID
  version: number;      // Monotonically increasing
  eventType: EventType;
  timestamp: Date;
}

// Event Store enforces version continuity
async appendEvents(events: PaymentEvent[]): Promise<void> {
  for (const event of events) {
    const lastVersion = getLastVersion(event.aggregateId);

    if (event.version !== lastVersion + 1) {
      throw new EventVersionMismatchError(
        event.aggregateId,
        lastVersion + 1,
        event.version
      );
    }

    // Atomic append
    store.append(event);
  }
}
```

**Concurrency Protection**:

1. **Read**: Load all events for payment, current version = N
2. **Command**: Generate new event with version = N+1
3. **Write**: Append event only if no version N+1 exists (atomic check)
4. **Conflict**: If version N+1 already exists, another process won → **retry**

**Example**:

```
Process A: Reads events [v1, v2, v3], generates v4
Process B: Reads events [v1, v2, v3], generates v4
────────────────────────────────────────────────────
Process A writes v4 first → SUCCESS
Process B tries to write v4 → CONFLICT (v4 exists)
Process B reloads events [v1, v2, v3, v4], generates v5
Process B writes v5 → SUCCESS
```

---

### Solution 3: Pessimistic Locking (When Needed)

For critical sections (e.g., payment initiation), use **distributed locks**:

```typescript
async function processPaymentWithLock(paymentId: string): Promise<void> {
  const lock = await lockManager.acquireLock(`payment:${paymentId}`, { ttl: 30000 });

  try {
    // Critical section: read, validate, transition, write
    const payment = await loadPayment(paymentId);

    // State machine prevents invalid transitions
    PaymentStateMachine.validateTransition(payment.state, newState);

    const updatedPayment = payment.authenticate(gateway);
    await savePayment(updatedPayment);
  } finally {
    await lock.release();
  }
}
```

**Trade-off**:

- ✅ **Guarantees**: No concurrent modifications
- ❌ **Performance**: Slower (locks introduce latency)
- **Use when**: High contention or complex multi-step operations

---

## Why the State Machine Prevents Inconsistencies

### 1. **Fail-Fast Validation**

Invalid transitions are **rejected immediately** before any I/O:

```typescript
// This check happens BEFORE database writes
PaymentStateMachine.validateTransition(currentState, newState);

// If we reach here, transition is GUARANTEED valid
await database.update(payment);
```

**Benefit**: Even under concurrency, no invalid state ever reaches the database.

---

### 2. **Linearizability**

**Definition**: All operations appear to occur in some **sequential order**, consistent with real-time ordering.

**How the state machine achieves this**:

1. **Single source of truth**: State machine defines the ONLY valid transitions
2. **Atomic checks**: CAS/version checks are atomic at the database level
3. **Event ordering**: Event sourcing creates a **total order** of state changes

**Result**: Even with 1000 concurrent requests, the payment lifecycle is **as if** they executed one-at-a-time.

---

### 3. **Idempotency via State Machine**

Idempotency is **built into the state machine**:

```typescript
// Attempting the same transition twice fails the second time
const payment1 = payment.authenticate(gateway); // INITIATED → AUTHENTICATED ✓
const payment2 = payment1.authenticate(gateway); // AUTHENTICATED → ??? ✗ Error!

// State machine rejects: "Cannot transition from AUTHENTICATED to AUTHENTICATED"
```

**Why this matters**:

- Network retries don't cause duplicate processing
- Webhook replay is safe
- Crash recovery is deterministic

---

### 4. **Terminal States as Absorbing Barriers**

Once a payment reaches `SUCCESS` or `FAILURE`:

- **All further transition attempts fail** (terminal state invariant)
- State becomes **immutable**
- Prevents:
  - Resurrecting completed payments
  - Changing successful payments to failed
  - Re-processing settled transactions

**Code**:

```typescript
// This check happens FIRST in every transition validation
if (isTerminalState(from)) {
  throw new InvariantViolationError(state, 'Terminal state cannot transition', details);
}
```

---

## Proof of Correctness Under Concurrency

### Theorem: No Invalid States Under Concurrent Execution

**Given**:

1. State machine defines all valid transitions: `δ: S × Σ → S ∪ {error}`
2. All state changes go through `validateTransition(from, to)`
3. Database updates use compare-and-swap or equivalent
4. Event sourcing maintains version continuity

**Claim**: The payment state is always in `S` (a valid state), never in an undefined/inconsistent state.

**Proof Sketch**:

1. **Base case**: Initial state `s₀ = INITIATED ∈ S` ✓

2. **Inductive step**: Assume current state `s ∈ S`. For any transition attempt:
   - **Case A: Valid transition** (`δ(s, e) = s'`)
     - State machine validates: `s → s'` ✓
     - CAS ensures atomicity: Only one process succeeds
     - New state `s' ∈ S` ✓
   - **Case B: Invalid transition** (`δ(s, e) = error`)
     - State machine rejects: Throws `InvalidStateTransitionError`
     - No database update occurs
     - State remains `s ∈ S` ✓
   - **Case C: Concurrent conflict**
     - CAS fails: `ConcurrentModificationError`
     - No database update occurs
     - State remains `s ∈ S` (from winner's perspective) ✓

3. **Conclusion**: By induction, state is always in `S`. ∎

---

## Example: Concurrent Authentication Attempts

### Scenario Setup

- Payment ID: `pay_123`
- Initial state: `INITIATED`
- Two processes attempt authentication simultaneously

### Timeline

```
Time    Process A                               Process B                           DB State
────────────────────────────────────────────────────────────────────────────────────────────────
t1      Load payment (state=INITIATED, v=1)    Load payment (state=INITIATED, v=1)  INITIATED (v1)

t2      Validate: INITIATED → AUTHENTICATED ✓  Validate: INITIATED → AUTHENTICATED ✓

t3      Generate event: PaymentAuthenticatedEvent (v=2)
                                                Generate event: PaymentAuthenticatedEvent (v=2)

t4      CAS: IF state=INITIATED AND version=1
        THEN SET state=AUTHENTICATED, version=2
        → SUCCESS ✓                             [waiting for DB lock...]            AUTHENTICATED (v2)

t5                                              CAS: IF state=INITIATED AND version=1
                                                THEN SET state=AUTHENTICATED, version=2
                                                → CONFLICT! ✗                       AUTHENTICATED (v2)
                                                (state is now AUTHENTICATED, not INITIATED)

t6                                              Receive ConcurrentModificationError
                                                Reload payment (state=AUTHENTICATED, v=2)
                                                Decision: Already authenticated, idempotent success
                                                Return success to caller             AUTHENTICATED (v2)
```

### Key Points

1. **Both processes validate correctly** - State machine allows `INITIATED → AUTHENTICATED`
2. **Only ONE write succeeds** - CAS provides atomicity
3. **Loser detects conflict** - Version mismatch triggers error
4. **Idempotent handling** - Process B realizes goal is achieved, returns success

**No inconsistency**: Payment never in an undefined state.

---

## Type-Level Safety (Compile-Time Guarantees)

TypeScript's type system provides **compile-time** enforcement where possible:

```typescript
export type ValidTransitions = {
  [PaymentState.INITIATED]: PaymentState.AUTHENTICATED | PaymentState.FAILURE;
  [PaymentState.AUTHENTICATED]: PaymentState.PROCESSING | PaymentState.FAILURE;
  [PaymentState.PROCESSING]: PaymentState.SUCCESS | PaymentState.FAILURE;
  [PaymentState.SUCCESS]: never; // ← Type system enforces "no transitions"
  [PaymentState.FAILURE]: never; // ← Type system enforces "no transitions"
};

// Usage
type CanTransitionFromSuccess = ValidTransitions[PaymentState.SUCCESS];
// Result: never (cannot transition from SUCCESS)

// This won't compile:
function invalidTransition(payment: Payment) {
  if (payment.state === PaymentState.SUCCESS) {
    return payment.authenticate(gateway); // ← TypeScript error!
  }
}
```

**Benefit**: Many invalid transitions are caught by the compiler, before runtime.

---

## Testing State Machine Properties

The state machine includes self-verification:

```typescript
const verification = PaymentStateMachine.verifyStateMachineProperties();

if (!verification.valid) {
  console.error('State machine invariants violated:', verification.errors);
}

// Example checks:
// ✓ All states are defined in transition map
// ✓ Terminal states have no outgoing transitions
// ✓ All states are reachable from INITIATED
// ✓ No orphaned or dead states
```

**Run this in CI/CD** to ensure state machine correctness.

---

## Visualization

### ASCII Representation

```
═══════════════════════════════════════════════
  PAYMENT STATE MACHINE (Deterministic FSM)
═══════════════════════════════════════════════

Initial State: INITIATED
Terminal States: SUCCESS, FAILURE

State Transitions:
─────────────────────────────────────────────
→ INITIATED
  ├─→ AUTHENTICATED
  └─→ FAILURE
  AUTHENTICATED
  ├─→ PROCESSING
  └─→ FAILURE
  PROCESSING
  ├─→ SUCCESS
  └─→ FAILURE
✓ SUCCESS [TERMINAL]
✓ FAILURE [TERMINAL]
```

### Graphviz DOT (for diagrams)

```typescript
import { generateDotGraph } from './domain/paymentStateMachine';

const dot = generateDotGraph();
// Render with: dot -Tpng state_machine.dot -o state_machine.png
```

---

## Summary: How This Prevents Inconsistencies

| Mechanism                     | Protection Against                       | How It Works                                  |
| ----------------------------- | ---------------------------------------- | --------------------------------------------- |
| **Terminal State Invariant**  | Resurrecting completed payments          | Type-level & runtime checks block transitions |
| **Explicit Transition Map**   | Undefined/invalid states                 | Only mapped transitions allowed               |
| **Compare-and-Swap**          | Lost updates, race conditions            | Atomic state check + update                   |
| **Event Sourcing + Versions** | Concurrent modifications                 | Version numbers detect conflicts              |
| **Deterministic Transitions** | Ambiguous outcomes                       | Each (state, event) → exactly one next state  |
| **Fail-Fast Validation**      | Invalid states reaching DB               | Rejection before I/O                          |
| **Type System**               | Many invalid transitions at compile-time | TypeScript union types                        |

---

## Further Reading

- **Formal Methods**: [TLA+ for distributed systems](https://lamport.azurewebsites.net/tla/tla.html)
- **Concurrency**: Herlihy & Shavit, "The Art of Multiprocessor Programming"
- **Event Sourcing**: Martin Fowler, [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- **State Machines**: David Harel, "Statecharts: A Visual Formalism for Complex Systems"

---

**Implementation Location**:

- State Machine: [`src/domain/paymentStateMachine.ts`](../src/domain/paymentStateMachine.ts)
- Payment Entity: [`src/domain/payment.ts`](../src/domain/payment.ts)
- Event Sourcing: [`src/infra/eventSourcing.ts`](../src/infra/eventSourcing.ts)
