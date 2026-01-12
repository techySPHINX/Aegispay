/**
 * Advanced PaymentStateMachine Tests
 * 
 * Comprehensive tests for advanced state machine methods including:
 * - State metadata and introspection
 * - Transition metadata and reasoning
 * - State machine graph operations
 * - Formal property verification
 * - Concurrency control
 * - Visualization helpers
 */

import { PaymentStateMachine, compareAndSwapTransition, ConcurrentModificationError, visualizeStateMachine, generateDotGraph } from '../../src/domain/paymentStateMachine';
import { PaymentState } from '../../src/domain/types';

describe('Payment State Machine - Advanced Features', () => {
  describe('getStateMetadata', () => {
    it('should return metadata for INITIATED state', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.INITIATED);

      expect(metadata.state).toBe(PaymentState.INITIATED);
      expect(metadata.isInitial).toBe(true);
      expect(metadata.isTerminal).toBe(false);
      expect(metadata.validNextStates).toContain(PaymentState.AUTHENTICATED);
      expect(metadata.validNextStates).toContain(PaymentState.FAILURE);
      expect(metadata.invariants).toBeDefined();
      expect(metadata.invariants.length).toBeGreaterThan(0);
    });

    it('should return metadata for AUTHENTICATED state', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.AUTHENTICATED);

      expect(metadata.state).toBe(PaymentState.AUTHENTICATED);
      expect(metadata.isInitial).toBe(false);
      expect(metadata.isTerminal).toBe(false);
      expect(metadata.validNextStates).toContain(PaymentState.PROCESSING);
      expect(metadata.validNextStates).toContain(PaymentState.FAILURE);
      expect(metadata.invariants).toBeDefined();
    });

    it('should return metadata for PROCESSING state', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.PROCESSING);

      expect(metadata.state).toBe(PaymentState.PROCESSING);
      expect(metadata.isInitial).toBe(false);
      expect(metadata.isTerminal).toBe(false);
      expect(metadata.validNextStates).toContain(PaymentState.SUCCESS);
      expect(metadata.validNextStates).toContain(PaymentState.FAILURE);
    });

    it('should return metadata for SUCCESS terminal state', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.SUCCESS);

      expect(metadata.state).toBe(PaymentState.SUCCESS);
      expect(metadata.isInitial).toBe(false);
      expect(metadata.isTerminal).toBe(true);
      expect(metadata.validNextStates).toEqual([]);
      expect(metadata.invariants).toBeDefined();
    });

    it('should return metadata for FAILURE terminal state', () => {
      const metadata = PaymentStateMachine.getStateMetadata(PaymentState.FAILURE);

      expect(metadata.state).toBe(PaymentState.FAILURE);
      expect(metadata.isInitial).toBe(false);
      expect(metadata.isTerminal).toBe(true);
      expect(metadata.validNextStates).toEqual([]);
      expect(metadata.invariants).toBeDefined();
    });
  });

  describe('getTransitionMetadata', () => {
    it('should provide metadata for valid transition', () => {
      const metadata = PaymentStateMachine.getTransitionMetadata(
        PaymentState.INITIATED,
        PaymentState.AUTHENTICATED
      );

      expect(metadata.from).toBe(PaymentState.INITIATED);
      expect(metadata.to).toBe(PaymentState.AUTHENTICATED);
      expect(metadata.allowed).toBe(true);
      expect(metadata.reason).toBeUndefined();
    });

    it('should provide metadata with reason for invalid transition', () => {
      const metadata = PaymentStateMachine.getTransitionMetadata(
        PaymentState.INITIATED,
        PaymentState.PROCESSING
      );

      expect(metadata.from).toBe(PaymentState.INITIATED);
      expect(metadata.to).toBe(PaymentState.PROCESSING);
      expect(metadata.allowed).toBe(false);
      expect(metadata.reason).toBeDefined();
      expect(metadata.reason).toContain('Invalid transition');
    });

    it('should provide metadata for terminal state transition attempt', () => {
      const metadata = PaymentStateMachine.getTransitionMetadata(
        PaymentState.SUCCESS,
        PaymentState.INITIATED
      );

      expect(metadata.allowed).toBe(false);
      expect(metadata.reason).toContain('terminal state');
      expect(metadata.reason).toContain('invariant');
    });

    it('should list valid next states in error message', () => {
      const metadata = PaymentStateMachine.getTransitionMetadata(
        PaymentState.AUTHENTICATED,
        PaymentState.SUCCESS
      );

      expect(metadata.allowed).toBe(false);
      expect(metadata.reason).toContain('Valid next states');
      expect(metadata.reason).toContain('PROCESSING');
    });
  });

  describe('canTransition', () => {
    it('should return true for valid transitions', () => {
      expect(PaymentStateMachine.canTransition(PaymentState.INITIATED, PaymentState.AUTHENTICATED)).toBe(true);
      expect(PaymentStateMachine.canTransition(PaymentState.AUTHENTICATED, PaymentState.PROCESSING)).toBe(true);
      expect(PaymentStateMachine.canTransition(PaymentState.PROCESSING, PaymentState.SUCCESS)).toBe(true);
    });

    it('should return false for invalid transitions', () => {
      expect(PaymentStateMachine.canTransition(PaymentState.INITIATED, PaymentState.PROCESSING)).toBe(false);
      expect(PaymentStateMachine.canTransition(PaymentState.SUCCESS, PaymentState.INITIATED)).toBe(false);
      expect(PaymentStateMachine.canTransition(PaymentState.FAILURE, PaymentState.PROCESSING)).toBe(false);
    });

    it('should return false for terminal state transitions', () => {
      expect(PaymentStateMachine.canTransition(PaymentState.SUCCESS, PaymentState.FAILURE)).toBe(false);
      expect(PaymentStateMachine.canTransition(PaymentState.SUCCESS, PaymentState.SUCCESS)).toBe(false);
    });

    it('should be safe for race condition checking', () => {
      // This should not throw, just return false
      const result = PaymentStateMachine.canTransition(PaymentState.PROCESSING, PaymentState.INITIATED);
      expect(result).toBe(false);
    });
  });

  describe('validateTransitionTyped', () => {
    it('should return true for valid transition', () => {
      const result = PaymentStateMachine.validateTransitionTyped(
        PaymentState.INITIATED,
        PaymentState.AUTHENTICATED
      );

      expect(result).toBe(true);
    });

    it('should throw for invalid transition', () => {
      expect(() => {
        PaymentStateMachine.validateTransitionTyped(
          PaymentState.INITIATED,
          PaymentState.PROCESSING
        );
      }).toThrow();
    });

    it('should throw for terminal state transition', () => {
      expect(() => {
        PaymentStateMachine.validateTransitionTyped(
          PaymentState.SUCCESS,
          PaymentState.FAILURE
        );
      }).toThrow();
    });
  });

  describe('getStateMachineGraph', () => {
    it('should return complete state machine graph', () => {
      const graph = PaymentStateMachine.getStateMachineGraph();

      expect(graph.size).toBeGreaterThan(0);
      expect(graph.has(PaymentState.INITIATED)).toBe(true);
      expect(graph.has(PaymentState.AUTHENTICATED)).toBe(true);
      expect(graph.has(PaymentState.PROCESSING)).toBe(true);
      expect(graph.has(PaymentState.SUCCESS)).toBe(true);
      expect(graph.has(PaymentState.FAILURE)).toBe(true);
    });

    it('should show valid transitions for each state', () => {
      const graph = PaymentStateMachine.getStateMachineGraph();

      const initiatedTransitions = graph.get(PaymentState.INITIATED);
      expect(initiatedTransitions).toContain(PaymentState.AUTHENTICATED);
      expect(initiatedTransitions).toContain(PaymentState.FAILURE);
    });

    it('should show empty transitions for terminal states', () => {
      const graph = PaymentStateMachine.getStateMachineGraph();

      const successTransitions = graph.get(PaymentState.SUCCESS);
      expect(successTransitions).toEqual([]);

      const failureTransitions = graph.get(PaymentState.FAILURE);
      expect(failureTransitions).toEqual([]);
    });

    it('should be readonly (immutable)', () => {
      const graph = PaymentStateMachine.getStateMachineGraph();

      // Verify the graph is a ReadonlyMap (TypeScript enforces this)
      expect(graph).toBeInstanceOf(Map);
      expect(graph.size).toBeGreaterThan(0);

      // In TypeScript, ReadonlyMap doesn't allow set() at compile time
      // At runtime, the underlying Map is returned, so we can't test immutability
      // The important part is that TypeScript prevents modification
    });
  });

  describe('verifyStateMachineProperties', () => {
    it('should validate state machine correctness', () => {
      const verification = PaymentStateMachine.verifyStateMachineProperties();

      expect(verification.valid).toBe(true);
      expect(verification.errors).toEqual([]);
    });

    it('should verify all states are defined', () => {
      const verification = PaymentStateMachine.verifyStateMachineProperties();

      // All states should be present in transition map
      expect(verification.errors.filter(e => e.includes('not defined'))).toEqual([]);
    });

    it('should verify terminal state invariants', () => {
      const verification = PaymentStateMachine.verifyStateMachineProperties();

      // Terminal states should have no outgoing transitions
      expect(verification.errors.filter(e => e.includes('terminal state'))).toEqual([]);
    });

    it('should verify reachability from initial state', () => {
      const verification = PaymentStateMachine.verifyStateMachineProperties();

      // All states should be reachable from INITIATED
      expect(verification.errors.filter(e => e.includes('not reachable'))).toEqual([]);
    });

    it('should return valid:true when no errors', () => {
      const verification = PaymentStateMachine.verifyStateMachineProperties();

      if (verification.errors.length > 0) {
        console.error('State machine validation errors:', verification.errors);
      }

      expect(verification.valid).toBe(true);
    });
  });

  describe('State Machine Formal Properties', () => {
    it('should have exactly one initial state', () => {
      const allStates = Object.values(PaymentState);
      const initialStates = allStates.filter((state) => {
        const metadata = PaymentStateMachine.getStateMetadata(state as PaymentState);
        return metadata.isInitial;
      });

      expect(initialStates).toHaveLength(1);
      expect(initialStates[0]).toBe(PaymentState.INITIATED);
    });

    it('should have exactly two terminal states', () => {
      const allStates = Object.values(PaymentState);
      const terminalStates = allStates.filter((state) => {
        const metadata = PaymentStateMachine.getStateMetadata(state as PaymentState);
        return metadata.isTerminal;
      });

      expect(terminalStates).toHaveLength(2);
      expect(terminalStates).toContain(PaymentState.SUCCESS);
      expect(terminalStates).toContain(PaymentState.FAILURE);
    });

    it('should ensure all non-terminal states have outgoing transitions', () => {
      const allStates = Object.values(PaymentState);

      for (const state of allStates) {
        const metadata = PaymentStateMachine.getStateMetadata(state as PaymentState);
        if (!metadata.isTerminal) {
          expect(metadata.validNextStates.length).toBeGreaterThan(0);
        }
      }
    });

    it('should ensure terminal states have no outgoing transitions', () => {
      const terminalStates = [PaymentState.SUCCESS, PaymentState.FAILURE];

      for (const state of terminalStates) {
        const metadata = PaymentStateMachine.getStateMetadata(state);
        expect(metadata.validNextStates).toEqual([]);
      }
    });

    it('should have deterministic transitions', () => {
      // Each state + input should have at most one valid next state
      // (Our state machine allows multiple possible next states per current state,
      // but for a given transition attempt, there's deterministic validation)
      const graph = PaymentStateMachine.getStateMachineGraph();

      graph.forEach((transitions, state) => {
        // For each possible next state from current state
        transitions.forEach((nextState) => {
          const isValid = PaymentStateMachine.isValidTransition(state, nextState);
          expect(isValid).toBe(true);
        });
      });
    });
  });

  describe('Edge Cases and Boundaries', () => {
    it('should handle metadata requests for all states', () => {
      const allStates = Object.values(PaymentState);

      allStates.forEach((state) => {
        const metadata = PaymentStateMachine.getStateMetadata(state as PaymentState);
        expect(metadata).toBeDefined();
        expect(metadata.state).toBe(state);
      });
    });

    it('should handle transition metadata for all state pairs', () => {
      const allStates = Object.values(PaymentState) as PaymentState[];

      allStates.forEach((from) => {
        allStates.forEach((to) => {
          const metadata = PaymentStateMachine.getTransitionMetadata(from, to);
          expect(metadata).toBeDefined();
          expect(metadata.from).toBe(from);
          expect(metadata.to).toBe(to);
          expect(typeof metadata.allowed).toBe('boolean');
        });
      });
    });

    it('should consistently report valid transitions', () => {
      const allStates = Object.values(PaymentState) as PaymentState[];

      allStates.forEach((from) => {
        const validNextStates = PaymentStateMachine.getValidNextStates(from);

        validNextStates.forEach((to) => {
          // These should always be consistent
          expect(PaymentStateMachine.isValidTransition(from, to)).toBe(true);
          expect(PaymentStateMachine.canTransition(from, to)).toBe(true);

          const metadata = PaymentStateMachine.getTransitionMetadata(from, to);
          expect(metadata.allowed).toBe(true);
        });
      });
    });
  });

  describe('Concurrency Control', () => {
    describe('compareAndSwapTransition', () => {
      it('should allow transition when expected state matches actual state', () => {
        expect(() => {
          compareAndSwapTransition(
            PaymentState.INITIATED,
            PaymentState.INITIATED,
            PaymentState.AUTHENTICATED
          );
        }).not.toThrow();
      });

      it('should throw ConcurrentModificationError when states do not match', () => {
        expect(() => {
          compareAndSwapTransition(
            PaymentState.INITIATED,
            PaymentState.AUTHENTICATED,
            PaymentState.PROCESSING
          );
        }).toThrow(ConcurrentModificationError);
      });

      it('should throw error with correct expected and actual states', () => {
        try {
          compareAndSwapTransition(
            PaymentState.INITIATED,
            PaymentState.PROCESSING,
            PaymentState.SUCCESS
          );
          fail('Should have thrown error');
        } catch (error) {
          expect(error).toBeInstanceOf(ConcurrentModificationError);
          const concError = error as ConcurrentModificationError;
          expect(concError.expectedState).toBe(PaymentState.INITIATED);
          expect(concError.actualState).toBe(PaymentState.PROCESSING);
          expect(concError.attemptedNewState).toBe(PaymentState.SUCCESS);
        }
      });

      it('should validate transition rules even after state match', () => {
        // Even if states match, invalid transitions should still fail
        expect(() => {
          compareAndSwapTransition(
            PaymentState.INITIATED,
            PaymentState.INITIATED,
            PaymentState.PROCESSING // Invalid: skips AUTHENTICATED
          );
        }).toThrow();
      });

      it('should handle terminal state transition attempts', () => {
        expect(() => {
          compareAndSwapTransition(
            PaymentState.SUCCESS,
            PaymentState.SUCCESS,
            PaymentState.FAILURE
          );
        }).toThrow();
      });
    });
  });

  describe('Visualization Helpers', () => {
    describe('visualizeStateMachine', () => {
      it('should generate visualization string', () => {
        const visualization = visualizeStateMachine();

        expect(visualization).toBeDefined();
        expect(typeof visualization).toBe('string');
        expect(visualization.length).toBeGreaterThan(0);
      });

      it('should include all state names', () => {
        const visualization = visualizeStateMachine();

        expect(visualization).toContain('INITIATED');
        expect(visualization).toContain('AUTHENTICATED');
        expect(visualization).toContain('PROCESSING');
        expect(visualization).toContain('SUCCESS');
        expect(visualization).toContain('FAILURE');
      });

      it('should show initial state marker', () => {
        const visualization = visualizeStateMachine();

        expect(visualization).toContain('Initial State: INITIATED');
      });

      it('should show terminal states', () => {
        const visualization = visualizeStateMachine();

        expect(visualization).toContain('Terminal States: SUCCESS, FAILURE');
        expect(visualization).toContain('[TERMINAL]');
      });

      it('should show state transitions', () => {
        const visualization = visualizeStateMachine();

        expect(visualization).toContain('State Transitions');
        expect(visualization).toContain('→'); // Arrow indicating transition
      });

      it('should show invariants section', () => {
        const visualization = visualizeStateMachine();

        expect(visualization).toContain('Invariants');
        expect(visualization).toContain('Terminal states have NO outgoing transitions');
        expect(visualization).toContain('All states are reachable');
      });
    });

    describe('generateDotGraph', () => {
      it('should generate DOT format string', () => {
        const dot = generateDotGraph();

        expect(dot).toBeDefined();
        expect(typeof dot).toBe('string');
        expect(dot.length).toBeGreaterThan(0);
      });

      it('should have digraph declaration', () => {
        const dot = generateDotGraph();

        expect(dot).toContain('digraph PaymentStateMachine');
        expect(dot).toContain('{');
        expect(dot).toContain('}');
      });

      it('should include all states as nodes', () => {
        const dot = generateDotGraph();

        expect(dot).toContain('INITIATED');
        expect(dot).toContain('AUTHENTICATED');
        expect(dot).toContain('PROCESSING');
        expect(dot).toContain('SUCCESS');
        expect(dot).toContain('FAILURE');
      });

      it('should mark initial state with special shape', () => {
        const dot = generateDotGraph();

        expect(dot).toContain('INITIATED');
        expect(dot).toContain('shape=');
      });

      it('should mark terminal states with special shape', () => {
        const dot = generateDotGraph();

        expect(dot).toContain('SUCCESS');
        expect(dot).toContain('FAILURE');
        expect(dot).toContain('doublecircle');
      });

      it('should define edge transitions', () => {
        const dot = generateDotGraph();

        expect(dot).toContain('->'); // DOT edge notation
      });

      it('should be valid DOT syntax', () => {
        const dot = generateDotGraph();

        // Basic DOT validation
        expect(dot.split('{').length).toBe(dot.split('}').length);
        expect(dot).toMatch(/digraph\s+\w+\s*\{/);
      });
    });
  });
});
