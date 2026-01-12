import { GatewayType, Currency } from '../domain/types';
import { GatewayRegistry } from '../gateways/registry';

/**
 * Routing strategies for payment gateway selection
 */

export enum RoutingStrategy {
  ROUND_ROBIN = 'ROUND_ROBIN',
  LEAST_LATENCY = 'LEAST_LATENCY',
  HIGHEST_SUCCESS_RATE = 'HIGHEST_SUCCESS_RATE',
  COST_OPTIMIZED = 'COST_OPTIMIZED',
  RULE_BASED = 'RULE_BASED',
}

/**
 * Routing context for decision making
 */
export interface RoutingContext {
  amount: number;
  currency: Currency;
  paymentMethod: string;
  customerCountry?: string;
  merchantId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Routing rule definition
 */
export interface RoutingRule {
  id: string;
  priority: number; // Higher priority rules are evaluated first
  conditions: RoutingCondition[];
  gatewayType: GatewayType;
  enabled: boolean;
}

export interface RoutingCondition {
  field: keyof RoutingContext;
  operator: 'equals' | 'greaterThan' | 'lessThan' | 'in' | 'contains';
  value: string | number | string[] | number[];
}

/**
 * Gateway cost configuration
 */
export interface GatewayCost {
  gatewayType: GatewayType;
  fixedFee: number;
  percentageFee: number; // 0-100
  currency: Currency;
}

/**
 * Payment Router - Intelligently routes payments to appropriate gateways
 */
export class PaymentRouter {
  private roundRobinIndex = 0;
  private routingRules: RoutingRule[] = [];
  private gatewayCosts: Map<GatewayType, GatewayCost> = new Map();

  constructor(
    private registry: GatewayRegistry,
    private defaultStrategy: RoutingStrategy = RoutingStrategy.HIGHEST_SUCCESS_RATE
  ) {}

  /**
   * Route payment to the best gateway
   */
  route(context: RoutingContext): GatewayType | undefined {
    const availableGateways = this.registry.getRegisteredGateways();

    if (availableGateways.length === 0) {
      throw new Error('No payment gateways available');
    }

    // Try rule-based routing first
    const ruleBasedGateway = this.applyRoutingRules(context);
    if (ruleBasedGateway) {
      return ruleBasedGateway;
    }

    // Fall back to strategy-based routing
    return this.routeByStrategy(context, availableGateways);
  }

  /**
   * Route by specific strategy
   */
  private routeByStrategy(
    context: RoutingContext,
    availableGateways: GatewayType[]
  ): GatewayType | undefined {
    switch (this.defaultStrategy) {
      case RoutingStrategy.ROUND_ROBIN:
        return this.roundRobinRoute(availableGateways);

      case RoutingStrategy.LEAST_LATENCY:
        return this.leastLatencyRoute(availableGateways);

      case RoutingStrategy.HIGHEST_SUCCESS_RATE:
        return this.highestSuccessRateRoute(availableGateways);

      case RoutingStrategy.COST_OPTIMIZED:
        return this.costOptimizedRoute(context, availableGateways);

      default:
        return availableGateways[0];
    }
  }

  /**
   * Round-robin routing
   */
  private roundRobinRoute(gateways: GatewayType[]): GatewayType {
    const gateway = gateways[this.roundRobinIndex % gateways.length];
    this.roundRobinIndex++;
    return gateway;
  }

  /**
   * Route to gateway with least latency
   */
  private leastLatencyRoute(gateways: GatewayType[]): GatewayType | undefined {
    let bestGateway: GatewayType | undefined;
    let lowestLatency = Infinity;

    for (const gateway of gateways) {
      const metrics = this.registry.getMetrics(gateway);
      if (metrics && metrics.averageLatency < lowestLatency) {
        lowestLatency = metrics.averageLatency;
        bestGateway = gateway;
      }
    }

    return bestGateway || gateways[0];
  }

  /**
   * Route to gateway with highest success rate
   */
  private highestSuccessRateRoute(gateways: GatewayType[]): GatewayType | undefined {
    let bestGateway: GatewayType | undefined;
    let highestSuccessRate = -1;

    for (const gateway of gateways) {
      const metrics = this.registry.getMetrics(gateway);
      if (metrics && metrics.successRate > highestSuccessRate) {
        highestSuccessRate = metrics.successRate;
        bestGateway = gateway;
      }
    }

    return bestGateway || gateways[0];
  }

  /**
   * Cost-optimized routing
   */
  private costOptimizedRoute(
    context: RoutingContext,
    gateways: GatewayType[]
  ): GatewayType | undefined {
    let bestGateway: GatewayType | undefined;
    let lowestCost = Infinity;

    for (const gateway of gateways) {
      const cost = this.calculateTransactionCost(gateway, context.amount);
      if (cost < lowestCost) {
        lowestCost = cost;
        bestGateway = gateway;
      }
    }

    return bestGateway || gateways[0];
  }

  /**
   * Apply routing rules
   */
  private applyRoutingRules(context: RoutingContext): GatewayType | undefined {
    // Sort rules by priority (descending)
    const sortedRules = [...this.routingRules]
      .filter((rule) => rule.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (this.evaluateRule(rule, context)) {
        return rule.gatewayType;
      }
    }

    return undefined;
  }

  /**
   * Evaluate a routing rule
   */
  private evaluateRule(rule: RoutingRule, context: RoutingContext): boolean {
    return rule.conditions.every((condition) => this.evaluateCondition(condition, context));
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: RoutingCondition, context: RoutingContext): boolean {
    const contextValue = context[condition.field];

    switch (condition.operator) {
      case 'equals':
        return contextValue === condition.value;

      case 'greaterThan':
        return Number(contextValue) > Number(condition.value);

      case 'lessThan':
        return Number(contextValue) < Number(condition.value);

      case 'in':
        return (
          Array.isArray(condition.value) &&
          (condition.value as (string | number)[]).includes(contextValue as string | number)
        );

      case 'contains':
        return String(contextValue).includes(String(condition.value));

      default:
        return false;
    }
  }

  /**
   * Add a routing rule
   */
  addRule(rule: RoutingRule): void {
    this.routingRules.push(rule);
  }

  /**
   * Remove a routing rule
   */
  removeRule(ruleId: string): void {
    this.routingRules = this.routingRules.filter((rule) => rule.id !== ruleId);
  }

  /**
   * Get all routing rules
   */
  getRules(): RoutingRule[] {
    return [...this.routingRules];
  }

  /**
   * Set gateway costs
   */
  setGatewayCost(cost: GatewayCost): void {
    this.gatewayCosts.set(cost.gatewayType, cost);
  }

  /**
   * Calculate transaction cost for a gateway
   */
  private calculateTransactionCost(gatewayType: GatewayType, amount: number): number {
    const cost = this.gatewayCosts.get(gatewayType);
    if (!cost) return 0;

    return cost.fixedFee + (amount * cost.percentageFee) / 100;
  }

  /**
   * Get transaction cost breakdown
   */
  getTransactionCostBreakdown(amount: number): Array<{ gateway: GatewayType; cost: number }> {
    const breakdown: Array<{ gateway: GatewayType; cost: number }> = [];

    this.gatewayCosts.forEach((_cost, gatewayType) => {
      const totalCost = this.calculateTransactionCost(gatewayType, amount);
      breakdown.push({ gateway: gatewayType, cost: totalCost });
    });

    return breakdown.sort((a, b) => a.cost - b.cost);
  }

  /**
   * Set routing strategy
   */
  setStrategy(strategy: RoutingStrategy): void {
    this.defaultStrategy = strategy;
  }

  /**
   * Get current routing strategy
   */
  getStrategy(): RoutingStrategy {
    return this.defaultStrategy;
  }
}
