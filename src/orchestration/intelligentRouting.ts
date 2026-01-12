/**
 * INTELLIGENT GATEWAY ROUTING ENGINE
 *
 * This module implements an adaptive routing system that selects optimal payment
 * gateways based on real-time metrics:
 * - Success rate (higher is better)
 * - Latency (lower is better)
 * - Cost (lower is better)
 * - Availability (circuit breaker state)
 *
 * ROUTING STRATEGIES:
 * 1. Deterministic: Static rules, predictable behavior
 * 2. Adaptive: Learns from metrics, optimizes over time
 * 3. Hybrid: Combines both approaches
 *
 * TRADE-OFFS:
 * Deterministic:
 *   ✅ Predictable, testable
 *   ✅ Simple to understand and debug
 *   ❌ Cannot adapt to changing conditions
 *   ❌ Manual updates required
 *
 * Adaptive:
 *   ✅ Self-optimizing, learns from data
 *   ✅ Handles changing conditions
 *   ❌ Less predictable
 *   ❌ Requires sufficient data
 *
 * Hybrid:
 *   ✅ Best of both worlds
 *   ✅ Safe defaults with adaptive optimization
 *   ⚠️  More complex implementation
 */

import { GatewayType } from '../domain/types';
import { Payment } from '../domain/payment';

// ============================================================================
// GATEWAY METRICS
// ============================================================================

/**
 * Real-time metrics for a single gateway
 */
export interface GatewayMetrics {
  gatewayType: GatewayType;

  // Success tracking
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number; // 0.0 to 1.0

  // Latency tracking
  totalLatency: number; // Sum of all latencies
  avgLatency: number; // Average latency in ms
  p95Latency: number; // 95th percentile latency
  p99Latency: number; // 99th percentile latency

  // Cost tracking
  totalCost: number; // Total processing cost
  avgCost: number; // Average cost per transaction

  // Health status
  isAvailable: boolean; // Circuit breaker state
  consecutiveFailures: number; // For health tracking
  lastFailureTime: Date | null;

  // Time window
  windowStartTime: Date;
  lastUpdatedTime: Date;
}

/**
 * Time-series data point for trend analysis
 */
export interface MetricsSnapshot {
  timestamp: Date;
  gatewayType: GatewayType;
  successRate: number;
  avgLatency: number;
  avgCost: number;
}

/**
 * Gateway Metrics Collector
 * Maintains rolling window of metrics for each gateway
 */
export class GatewayMetricsCollector {
  private metrics: Map<GatewayType, GatewayMetrics> = new Map();
  private latencyHistogram: Map<GatewayType, number[]> = new Map();
  private snapshots: Map<GatewayType, MetricsSnapshot[]> = new Map();
  private readonly maxHistorySize = 1000;
  private readonly snapshotInterval = 60000; // 1 minute
  private snapshotTimer: NodeJS.Timeout | null = null;

  constructor(private windowSize: number = 3600000) {} // 1 hour default

  /**
   * Record a successful payment
   */
  recordSuccess(gatewayType: GatewayType, latency: number, cost: number): void {
    const metrics = this.getOrCreateMetrics(gatewayType);

    metrics.totalRequests++;
    metrics.successfulRequests++;
    metrics.totalLatency += latency;
    metrics.totalCost += cost;
    metrics.consecutiveFailures = 0;

    // Update averages
    metrics.successRate = metrics.successfulRequests / metrics.totalRequests;
    metrics.avgLatency = metrics.totalLatency / metrics.totalRequests;
    metrics.avgCost = metrics.totalCost / metrics.totalRequests;

    // Add to latency histogram for percentile calculation
    this.addToHistogram(gatewayType, latency);
    this.updatePercentiles(gatewayType);

    metrics.lastUpdatedTime = new Date();

    // Expire old data
    this.expireOldData(gatewayType);
  }

  /**
   * Record a failed payment
   */
  recordFailure(gatewayType: GatewayType, latency: number): void {
    const metrics = this.getOrCreateMetrics(gatewayType);

    metrics.totalRequests++;
    metrics.failedRequests++;
    metrics.consecutiveFailures++;
    metrics.totalLatency += latency;
    metrics.lastFailureTime = new Date();

    // Update averages
    metrics.successRate = metrics.successfulRequests / metrics.totalRequests;
    metrics.avgLatency = metrics.totalLatency / metrics.totalRequests;

    metrics.lastUpdatedTime = new Date();

    this.expireOldData(gatewayType);
  }

  /**
   * Mark gateway as unavailable (circuit breaker open)
   */
  markUnavailable(gatewayType: GatewayType): void {
    const metrics = this.getOrCreateMetrics(gatewayType);
    metrics.isAvailable = false;
  }

  /**
   * Mark gateway as available (circuit breaker closed)
   */
  markAvailable(gatewayType: GatewayType): void {
    const metrics = this.getOrCreateMetrics(gatewayType);
    metrics.isAvailable = true;
    metrics.consecutiveFailures = 0;
  }

  /**
   * Get metrics for a gateway
   */
  getMetrics(gatewayType: GatewayType): GatewayMetrics | null {
    return this.metrics.get(gatewayType) || null;
  }

  /**
   * Get all gateway metrics
   */
  getAllMetrics(): Map<GatewayType, GatewayMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Get historical snapshots for trend analysis
   */
  getSnapshots(gatewayType: GatewayType): MetricsSnapshot[] {
    return this.snapshots.get(gatewayType) || [];
  }

  /**
   * Start taking periodic snapshots
   */
  startSnapshots(): void {
    if (this.snapshotTimer) return;

    this.snapshotTimer = setInterval(() => {
      this.takeSnapshot();
    }, this.snapshotInterval);
  }

  /**
   * Stop taking snapshots
   */
  stopSnapshots(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  /**
   * Take a snapshot of current metrics
   */
  private takeSnapshot(): void {
    const now = new Date();

    for (const [gatewayType, metrics] of this.metrics) {
      const snapshot: MetricsSnapshot = {
        timestamp: now,
        gatewayType,
        successRate: metrics.successRate,
        avgLatency: metrics.avgLatency,
        avgCost: metrics.avgCost,
      };

      let snapshots = this.snapshots.get(gatewayType);
      if (!snapshots) {
        snapshots = [];
        this.snapshots.set(gatewayType, snapshots);
      }

      snapshots.push(snapshot);

      // Keep only last 24 hours of snapshots
      const cutoff = now.getTime() - 86400000;
      this.snapshots.set(
        gatewayType,
        snapshots.filter((s) => s.timestamp.getTime() > cutoff)
      );
    }
  }

  /**
   * Get or create metrics for a gateway
   */
  private getOrCreateMetrics(gatewayType: GatewayType): GatewayMetrics {
    let metrics = this.metrics.get(gatewayType);

    if (!metrics) {
      metrics = {
        gatewayType,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        successRate: 1.0,
        totalLatency: 0,
        avgLatency: 0,
        p95Latency: 0,
        p99Latency: 0,
        totalCost: 0,
        avgCost: 0,
        isAvailable: true,
        consecutiveFailures: 0,
        lastFailureTime: null,
        windowStartTime: new Date(),
        lastUpdatedTime: new Date(),
      };

      this.metrics.set(gatewayType, metrics);
    }

    return metrics;
  }

  /**
   * Add latency to histogram for percentile calculation
   */
  private addToHistogram(gatewayType: GatewayType, latency: number): void {
    let histogram = this.latencyHistogram.get(gatewayType);

    if (!histogram) {
      histogram = [];
      this.latencyHistogram.set(gatewayType, histogram);
    }

    histogram.push(latency);

    // Keep histogram size bounded
    if (histogram.length > this.maxHistorySize) {
      histogram.shift();
    }
  }

  /**
   * Calculate percentile latencies
   */
  private updatePercentiles(gatewayType: GatewayType): void {
    const histogram = this.latencyHistogram.get(gatewayType);
    if (!histogram || histogram.length === 0) return;

    const sorted = [...histogram].sort((a, b) => a - b);
    const metrics = this.metrics.get(gatewayType)!;

    metrics.p95Latency = this.calculatePercentile(sorted, 0.95);
    metrics.p99Latency = this.calculatePercentile(sorted, 0.99);
  }

  /**
   * Calculate percentile value
   */
  private calculatePercentile(sorted: number[], percentile: number): number {
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Expire old data outside the rolling window
   */
  private expireOldData(gatewayType: GatewayType): void {
    const metrics = this.metrics.get(gatewayType);
    if (!metrics) return;

    const now = Date.now();
    const windowStart = metrics.windowStartTime.getTime();

    // Reset if window expired
    if (now - windowStart > this.windowSize) {
      metrics.windowStartTime = new Date();
      // Note: In production, you'd implement proper time-series aggregation
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.latencyHistogram.clear();
    this.snapshots.clear();
  }
}

// ============================================================================
// ROUTING RULES
// ============================================================================

/**
 * Routing rule for gateway selection
 */
export interface RoutingRule {
  name: string;
  description: string;
  priority: number; // Higher priority rules evaluated first
  condition: (context: RoutingContext) => boolean;
  action: (context: RoutingContext) => GatewayType | null;
}

/**
 * Routing context with all information needed for decision
 */
export interface RoutingContext {
  payment: Payment;
  availableGateways: GatewayType[];
  metrics: Map<GatewayType, GatewayMetrics>;
  metadata: Record<string, unknown>;
}

/**
 * Routing decision with explanation
 */
export interface RoutingDecision {
  selectedGateway: GatewayType;
  reason: string;
  score: number;
  alternatives: Array<{
    gateway: GatewayType;
    score: number;
    reason: string;
  }>;
}

/**
 * Weighted scoring configuration
 */
export interface ScoringWeights {
  successRate: number; // Weight for success rate (0-1)
  latency: number; // Weight for latency (0-1)
  cost: number; // Weight for cost (0-1)
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  successRate: 0.5, // 50% weight on success rate
  latency: 0.3, // 30% weight on latency
  cost: 0.2, // 20% weight on cost
};

/**
 * Intelligent Routing Engine
 *
 * Selects optimal gateway using:
 * 1. Real-time metrics
 * 2. Weighted scoring
 * 3. Configurable rules
 * 4. Dynamic updates
 */
export class IntelligentRoutingEngine {
  private rules: RoutingRule[] = [];
  private weights: ScoringWeights;

  constructor(weights: ScoringWeights = DEFAULT_WEIGHTS) {
    this.weights = weights;
  }

  /**
   * Select best gateway for payment
   */
  selectGateway(context: RoutingContext): RoutingDecision {
    // 1. Apply rule-based routing first (deterministic)
    const ruleResult = this.applyRules(context);
    if (ruleResult) {
      return {
        selectedGateway: ruleResult.gateway,
        reason: `Rule-based: ${ruleResult.reason}`,
        score: 1.0,
        alternatives: [],
      };
    }

    // 2. Use adaptive scoring (metric-based)
    return this.selectByScoring(context);
  }

  /**
   * Apply rules in priority order
   */
  private applyRules(context: RoutingContext): { gateway: GatewayType; reason: string } | null {
    const sortedRules = [...this.rules].sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (rule.condition(context)) {
        const gateway = rule.action(context);
        if (gateway) {
          return { gateway, reason: rule.name };
        }
      }
    }

    return null;
  }

  /**
   * Select gateway using weighted scoring
   */
  private selectByScoring(context: RoutingContext): RoutingDecision {
    const scores: Array<{
      gateway: GatewayType;
      score: number;
      breakdown: {
        successScore: number;
        latencyScore: number;
        costScore: number;
      };
    }> = [];

    // Score each available gateway
    for (const gateway of context.availableGateways) {
      const metrics = context.metrics.get(gateway);

      if (!metrics || !metrics.isAvailable) {
        continue; // Skip unavailable gateways
      }

      const score = this.calculateScore(metrics);
      scores.push({
        gateway,
        score: score.total,
        breakdown: score.breakdown,
      });
    }

    // Sort by score (descending)
    scores.sort((a, b) => b.score - a.score);

    if (scores.length === 0) {
      // Fallback: select first available gateway
      const fallback = context.availableGateways[0];
      return {
        selectedGateway: fallback,
        reason: 'Fallback: No metrics available',
        score: 0,
        alternatives: [],
      };
    }

    const best = scores[0];
    const alternatives = scores.slice(1).map((s) => ({
      gateway: s.gateway,
      score: s.score,
      reason: `Score: ${s.score.toFixed(3)} (success: ${s.breakdown.successScore.toFixed(3)}, latency: ${s.breakdown.latencyScore.toFixed(3)}, cost: ${s.breakdown.costScore.toFixed(3)})`,
    }));

    return {
      selectedGateway: best.gateway,
      reason: `Best score: ${best.score.toFixed(3)} (success: ${best.breakdown.successScore.toFixed(3)}, latency: ${best.breakdown.latencyScore.toFixed(3)}, cost: ${best.breakdown.costScore.toFixed(3)})`,
      score: best.score,
      alternatives,
    };
  }

  /**
   * Calculate weighted score for a gateway
   */
  private calculateScore(metrics: GatewayMetrics): {
    total: number;
    breakdown: {
      successScore: number;
      latencyScore: number;
      costScore: number;
    };
  } {
    // Success rate: 0.0 to 1.0 (higher is better)
    const successScore = metrics.successRate;

    // Latency: normalize and invert (lower is better)
    // Assuming max acceptable latency is 5000ms
    const latencyScore = Math.max(0, 1 - metrics.avgLatency / 5000);

    // Cost: normalize and invert (lower is better)
    // Assuming max acceptable cost is $1.00
    const costScore = Math.max(0, 1 - metrics.avgCost / 1.0);

    // Weighted total
    const total =
      successScore * this.weights.successRate +
      latencyScore * this.weights.latency +
      costScore * this.weights.cost;

    return {
      total,
      breakdown: {
        successScore,
        latencyScore,
        costScore,
      },
    };
  }

  /**
   * Add or update routing rule
   */
  addRule(rule: RoutingRule): void {
    // Remove existing rule with same name
    this.rules = this.rules.filter((r) => r.name !== rule.name);
    this.rules.push(rule);
  }

  /**
   * Remove routing rule
   */
  removeRule(name: string): void {
    this.rules = this.rules.filter((r) => r.name !== name);
  }

  /**
   * Update scoring weights dynamically
   */
  updateWeights(weights: Partial<ScoringWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  /**
   * Get current configuration
   */
  getConfiguration(): {
    rules: RoutingRule[];
    weights: ScoringWeights;
  } {
    return {
      rules: [...this.rules],
      weights: { ...this.weights },
    };
  }
}

// ============================================================================
// PRE-BUILT ROUTING RULES
// ============================================================================

/**
 * High-value payment rule: Route to most reliable gateway
 */
export function createHighValueRule(threshold: number): RoutingRule {
  return {
    name: 'high-value-payment',
    description: `Route payments over $${threshold} to most reliable gateway`,
    priority: 100,
    condition: (ctx) => ctx.payment.amount.amount > threshold,
    action: (ctx): GatewayType | null => {
      // Select gateway with highest success rate
      let bestGateway: GatewayType | null = null;
      let bestSuccessRate = 0;

      for (const [gateway, metrics] of ctx.metrics) {
        if (metrics.isAvailable && metrics.successRate > bestSuccessRate) {
          bestSuccessRate = metrics.successRate;
          bestGateway = gateway;
        }
      }

      return bestGateway;
    },
  };
}

/**
 * Time-sensitive rule: Route to fastest gateway
 */
export function createLowLatencyRule(paymentMethodTypes: string[]): RoutingRule {
  return {
    name: 'low-latency-payment',
    description: 'Route time-sensitive payments to fastest gateway',
    priority: 90,
    condition: (ctx) => paymentMethodTypes.includes(ctx.payment.paymentMethod.type),
    action: (ctx): GatewayType | null => {
      // Select gateway with lowest latency
      let bestGateway: GatewayType | null = null;
      let bestLatency = Infinity;

      for (const [gateway, metrics] of ctx.metrics) {
        if (metrics.isAvailable && metrics.avgLatency < bestLatency) {
          bestLatency = metrics.avgLatency;
          bestGateway = gateway;
        }
      }

      return bestGateway;
    },
  };
}

/**
 * Cost optimization rule: Route to cheapest gateway
 */
export function createCostOptimizationRule(minSuccessRate: number = 0.95): RoutingRule {
  return {
    name: 'cost-optimization',
    description: 'Route to cheapest gateway with acceptable success rate',
    priority: 50,
    condition: () => true, // Always applicable
    action: (ctx): GatewayType | null => {
      // Select cheapest gateway above min success rate
      let bestGateway: GatewayType | null = null;
      let bestCost = Infinity;

      for (const [gateway, metrics] of ctx.metrics) {
        if (
          metrics.isAvailable &&
          metrics.successRate >= minSuccessRate &&
          metrics.avgCost < bestCost
        ) {
          bestCost = metrics.avgCost;
          bestGateway = gateway;
        }
      }

      return bestGateway;
    },
  };
}
