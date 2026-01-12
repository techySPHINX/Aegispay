/**
 * Unit Tests: Payment State Machine
 * Tests the formal deterministic finite state machine for payment lifecycle
 */

import { PaymentState } from '../../src/domain/types';
import { PaymentStateMachine } from '../../src/domain/paymentStateMachine';

describe('Payment State Machine', () => {
  describe('Valid State Transitions', () => {
    describe('From INITIATED', () => {
      it('should allow INITIATED -> AUTHENTICATED transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.INITIATED,
          PaymentState.AUTHENTICATED
        );
        expect(isValid).toBe(true);
      });

      it('should allow INITIATED -> FAILURE transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.INITIATED,
          PaymentState.FAILURE
        );
        expect(isValid).toBe(true);
      });

      it('should reject INITIATED -> PROCESSING transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.INITIATED,
          PaymentState.PROCESSING
        );
        expect(isValid).toBe(false);
      });

      it('should reject INITIATED -> SUCCESS transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.INITIATED,
          PaymentState.SUCCESS
        );
        expect(isValid).toBe(false);
      });
    });

    describe('From AUTHENTICATED', () => {
      it('should allow AUTHENTICATED -> PROCESSING transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.AUTHENTICATED,
          PaymentState.PROCESSING
        );
        expect(isValid).toBe(true);
      });

      it('should allow AUTHENTICATED -> FAILURE transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.AUTHENTICATED,
          PaymentState.FAILURE
        );
        expect(isValid).toBe(true);
      });

      it('should reject AUTHENTICATED -> INITIATED transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.AUTHENTICATED,
          PaymentState.INITIATED
        );
        expect(isValid).toBe(false);
      });

      it('should reject AUTHENTICATED -> SUCCESS transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.AUTHENTICATED,
          PaymentState.SUCCESS
        );
        expect(isValid).toBe(false);
      });
    });

    describe('From PROCESSING', () => {
      it('should allow PROCESSING -> SUCCESS transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.PROCESSING,
          PaymentState.SUCCESS
        );
        expect(isValid).toBe(true);
      });

      it('should allow PROCESSING -> FAILURE transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.PROCESSING,
          PaymentState.FAILURE
        );
        expect(isValid).toBe(true);
      });

      it('should reject PROCESSING -> INITIATED transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.PROCESSING,
          PaymentState.INITIATED
        );
        expect(isValid).toBe(false);
      });

      it('should reject PROCESSING -> AUTHENTICATED transition', () => {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.PROCESSING,
          PaymentState.AUTHENTICATED
        );
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Terminal State Invariants', () => {
    it('should reject all transitions from SUCCESS (terminal state)', () => {
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.SUCCESS,
          PaymentState.INITIATED
        )
      ).toBe(false);
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.SUCCESS,
          PaymentState.AUTHENTICATED
        )
      ).toBe(false);
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.SUCCESS,
          PaymentState.PROCESSING
        )
      ).toBe(false);
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.SUCCESS,
          PaymentState.FAILURE
        )
      ).toBe(false);
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.SUCCESS,
          PaymentState.SUCCESS
        )
      ).toBe(false);
    });

    it('should reject all transitions from FAILURE (terminal state)', () => {
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.FAILURE,
          PaymentState.INITIATED
        )
      ).toBe(false);
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.FAILURE,
          PaymentState.AUTHENTICATED
        )
      ).toBe(false);
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.FAILURE,
          PaymentState.PROCESSING
        )
      ).toBe(false);
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.FAILURE,
          PaymentState.SUCCESS
        )
      ).toBe(false);
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.FAILURE,
          PaymentState.FAILURE
        )
      ).toBe(false);
    });
  });

  describe('State Metadata', () => {
    it('should identify INITIATED as initial state', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.INITIATED);
      expect(metadata.isInitial).toBe(true);
      expect(metadata.isTerminal).toBe(false);
    });

    it('should identify SUCCESS as terminal state', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.SUCCESS);
      expect(metadata.isTerminal).toBe(true);
      expect(metadata.isInitial).toBe(false);
      expect(metadata.validNextStates).toHaveLength(0);
    });

    it('should identify FAILURE as terminal state', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.FAILURE);
      expect(metadata.isTerminal).toBe(true);
      expect(metadata.isInitial).toBe(false);
      expect(metadata.validNextStates).toHaveLength(0);
    });

    it('should provide valid next states for INITIATED', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.INITIATED);
      expect(metadata.validNextStates).toContain(PaymentState.AUTHENTICATED);
      expect(metadata.validNextStates).toContain(PaymentState.FAILURE);
      expect(metadata.validNextStates).toHaveLength(2);
    });

    it('should provide valid next states for AUTHENTICATED', () => {
      const metadata = PaymentStateMachine.getStateMetadata(
        PaymentState.AUTHENTICATED
      );
      expect(metadata.validNextStates).toContain(PaymentState.PROCESSING);
      expect(metadata.validNextStates).toContain(PaymentState.FAILURE);
      expect(metadata.validNextStates).toHaveLength(2);
    });

    it('should provide valid next states for PROCESSING', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.PROCESSING);
      expect(metadata.validNextStates).toContain(PaymentState.SUCCESS);
      expect(metadata.validNextStates).toContain(PaymentState.FAILURE);
      expect(metadata.validNextStates).toHaveLength(2);
    });

    it('should have state invariants defined', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.INITIATED);
      expect(metadata.invariants).toBeDefined();
      expect(metadata.invariants.length).toBeGreaterThan(0);
    });
  });

  describe('Complete Payment Flow Paths', () => {
    it('should validate happy path: INITIATED -> AUTHENTICATED -> PROCESSING -> SUCCESS', () => {
      const step1 = PaymentStateMachine.isValidTransition(
        PaymentState.INITIATED,
        PaymentState.AUTHENTICATED
      );
      const step2 = PaymentStateMachine.isValidTransition(
        PaymentState.AUTHENTICATED,
        PaymentState.PROCESSING
      );
      const step3 = PaymentStateMachine.isValidTransition(
        PaymentState.PROCESSING,
        PaymentState.SUCCESS
      );

      expect(step1).toBe(true);
      expect(step2).toBe(true);
      expect(step3).toBe(true);
    });

    it('should validate early failure: INITIATED -> FAILURE', () => {
      const isValid = PaymentStateMachine.isValidTransition(
        PaymentState.INITIATED,
        PaymentState.FAILURE
      );
      expect(isValid).toBe(true);
    });

    it('should validate authentication failure: AUTHENTICATED -> FAILURE', () => {
      const isValid = PaymentStateMachine.isValidTransition(
        PaymentState.AUTHENTICATED,
        PaymentState.FAILURE
      );
      expect(isValid).toBe(true);
    });

    it('should validate processing failure: PROCESSING -> FAILURE', () => {
      const isValid = PaymentStateMachine.isValidTransition(
        PaymentState.PROCESSING,
        PaymentState.FAILURE
      );
      expect(isValid).toBe(true);
    });
  });

  describe('State Transition Validation', () => {
    it('should validate valid transition without throwing', () => {
      expect(() => {
        PaymentStateMachine.validateTransition(
          PaymentState.INITIATED,
          PaymentState.AUTHENTICATED
        );
      }).not.toThrow();
    });

    it('should throw error for invalid terminal state transition', () => {
      expect(() => {
        PaymentStateMachine.validateTransition(
          PaymentState.SUCCESS,
          PaymentState.PROCESSING
        );
      }).toThrow(/terminal/i);
    });

    it('should throw error for backward transitions', () => {
      expect(() => {
        PaymentStateMachine.validateTransition(
          PaymentState.PROCESSING,
          PaymentState.INITIATED
        );
      }).toThrow(/invalid state transition/i);
    });

    it('should throw error for skipping states', () => {
      expect(() => {
        PaymentStateMachine.validateTransition(
          PaymentState.INITIATED,
          PaymentState.SUCCESS
        );
      }).toThrow();
    });
  });

  describe('State Machine Properties', () => {
    it('should ensure determinism: each state has defined transitions', () => {
      const allStates = Object.values(PaymentState);

      allStates.forEach((state) => {
        const metadata = PaymentStateMachine.getStateMetadata(state);
        expect(metadata).toBeDefined();
        expect(metadata.state).toBe(state);
      });
    });

    it('should ensure completeness: all non-terminal states have valid transitions', () => {
      const nonTerminalStates = [
        PaymentState.INITIATED,
        PaymentState.AUTHENTICATED,
        PaymentState.PROCESSING,
      ];

      nonTerminalStates.forEach((state) => {
        const metadata = PaymentStateMachine.getStateMetadata(state);
        expect(metadata.validNextStates.length).toBeGreaterThan(0);
      });
    });

    it('should ensure reachability: all states are reachable from INITIATED', () => {
      // INITIATED is directly reachable (it's the initial state)
      expect(PaymentStateMachine.getStateMetadata(PaymentState.INITIATED).isInitial).toBe(true);

      // AUTHENTICATED is reachable from INITIATED
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.INITIATED,
          PaymentState.AUTHENTICATED
        )
      ).toBe(true);

      // PROCESSING is reachable from AUTHENTICATED
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.AUTHENTICATED,
          PaymentState.PROCESSING
        )
      ).toBe(true);

      // SUCCESS is reachable from PROCESSING
      expect(
        PaymentStateMachine.isValidTransition(
          PaymentState.PROCESSING,
          PaymentState.SUCCESS
        )
      ).toBe(true);

      // FAILURE is reachable from any non-terminal state
      expect(
        PaymentStateMachine.isValidTransition(PaymentState.INITIATED, PaymentState.FAILURE)
      ).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should reject self-transitions for all states', () => {
      const allStates = Object.values(PaymentState);

      allStates.forEach((state) => {
        const isValid = PaymentStateMachine.isValidTransition(state, state);
        expect(isValid).toBe(false);
      });
    });

    it('should maintain consistency across multiple checks', () => {
      // Check the same transition multiple times
      for (let i = 0; i < 10; i++) {
        const isValid = PaymentStateMachine.isValidTransition(
          PaymentState.INITIATED,
          PaymentState.AUTHENTICATED
        );
        expect(isValid).toBe(true);
      }
    });
  });
});
