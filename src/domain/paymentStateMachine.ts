import { PaymentState } from './types';

/**
 * State machine for payment lifecycle
 * Enforces valid state transitions and prevents invalid state changes
 */

export interface StateTransition {
  from: PaymentState;
  to: PaymentState;
  allowed: boolean;
  reason?: string;
}

/**
 * Valid state transitions in the payment lifecycle
 */
const VALID_TRANSITIONS: Map<PaymentState, Set<PaymentState>> = new Map([
  [PaymentState.INITIATED, new Set([PaymentState.AUTHENTICATED, PaymentState.FAILURE])],
  [PaymentState.AUTHENTICATED, new Set([PaymentState.PROCESSING, PaymentState.FAILURE])],
  [PaymentState.PROCESSING, new Set([PaymentState.SUCCESS, PaymentState.FAILURE])],
  [PaymentState.SUCCESS, new Set()], // Terminal state
  [PaymentState.FAILURE, new Set()], // Terminal state
]);

/**
 * Payment State Machine
 * Validates and enforces state transitions
 */
export class PaymentStateMachine {
  /**
   * Check if a state transition is valid
   */
  static isValidTransition(from: PaymentState, to: PaymentState): boolean {
    const allowedStates = VALID_TRANSITIONS.get(from);
    return allowedStates?.has(to) ?? false;
  }

  /**
   * Validate a state transition, throwing an error if invalid
   */
  static validateTransition(from: PaymentState, to: PaymentState): void {
    if (!this.isValidTransition(from, to)) {
      throw new InvalidStateTransitionError(from, to);
    }
  }

  /**
   * Get all valid next states from a given state
   */
  static getValidNextStates(from: PaymentState): PaymentState[] {
    const allowedStates = VALID_TRANSITIONS.get(from);
    return allowedStates ? Array.from(allowedStates) : [];
  }

  /**
   * Check if a state is terminal (no further transitions possible)
   */
  static isTerminalState(state: PaymentState): boolean {
    const allowedStates = VALID_TRANSITIONS.get(state);
    return allowedStates?.size === 0;
  }

  /**
   * Get state transition metadata
   */
  static getTransitionMetadata(from: PaymentState, to: PaymentState): StateTransition {
    const allowed = this.isValidTransition(from, to);
    return {
      from,
      to,
      allowed,
      reason: allowed ? undefined : `Invalid transition from ${from} to ${to}`,
    };
  }

  /**
   * Get the entire state machine as a graph representation
   */
  static getStateMachineGraph(): Map<PaymentState, PaymentState[]> {
    const graph = new Map<PaymentState, PaymentState[]>();
    VALID_TRANSITIONS.forEach((value, key) => {
      graph.set(key, Array.from(value));
    });
    return graph;
  }
}

/**
 * Custom error for invalid state transitions
 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly from: PaymentState,
    public readonly to: PaymentState
  ) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
    Object.setPrototypeOf(this, InvalidStateTransitionError.prototype);
  }
}

/**
 * State machine visualization (for debugging and documentation)
 */
export function visualizeStateMachine(): string {
  const graph = PaymentStateMachine.getStateMachineGraph();
  let visualization = 'Payment State Machine:\n\n';

  graph.forEach((nextStates, currentState) => {
    if (nextStates.length === 0) {
      visualization += `${currentState} [TERMINAL]\n`;
    } else {
      visualization += `${currentState} -> ${nextStates.join(', ')}\n`;
    }
  });

  return visualization;
}
