import { PaymentGateway, GatewayMetrics } from './gateway';
import { GatewayType } from '../domain/types';

/**
 * Gateway Registry - Manages all registered payment gateways
 * Acts as a factory and registry for gateway instances
 */
export class GatewayRegistry {
  private gateways: Map<GatewayType, PaymentGateway> = new Map();
  private metrics: Map<GatewayType, GatewayMetrics> = new Map();

  /**
   * Register a new gateway
   */
  register(gatewayType: GatewayType, gateway: PaymentGateway): void {
    if (this.gateways.has(gatewayType)) {
      throw new Error(`Gateway ${gatewayType} is already registered`);
    }

    this.gateways.set(gatewayType, gateway);
    this.initializeMetrics(gatewayType, gateway);
  }

  /**
   * Unregister a gateway
   */
  unregister(gatewayType: GatewayType): void {
    this.gateways.delete(gatewayType);
    this.metrics.delete(gatewayType);
  }

  /**
   * Get a gateway by type
   */
  getGateway(gatewayType: GatewayType): PaymentGateway | undefined {
    return this.gateways.get(gatewayType);
  }

  /**
   * Check if a gateway is registered
   */
  hasGateway(gatewayType: GatewayType): boolean {
    return this.gateways.has(gatewayType);
  }

  /**
   * Get all registered gateway types
   */
  getRegisteredGateways(): GatewayType[] {
    return Array.from(this.gateways.keys());
  }

  /**
   * Get metrics for a specific gateway
   */
  getMetrics(gatewayType: GatewayType): GatewayMetrics | undefined {
    return this.metrics.get(gatewayType);
  }

  /**
   * Get metrics for all gateways
   */
  getAllMetrics(): GatewayMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Update metrics after a request
   */
  recordRequest(
    gatewayType: GatewayType,
    success: boolean,
    latency: number
  ): void {
    const metrics = this.metrics.get(gatewayType);
    if (!metrics) return;

    metrics.totalRequests++;
    if (success) {
      metrics.successfulRequests++;
    } else {
      metrics.failedRequests++;
    }

    // Update average latency using exponential moving average
    metrics.averageLatency = metrics.averageLatency * 0.9 + latency * 0.1;

    // Recalculate success rate
    metrics.successRate = (metrics.successfulRequests / metrics.totalRequests) * 100;
    metrics.lastUpdated = new Date();

    this.metrics.set(gatewayType, metrics);
  }

  /**
   * Reset metrics for a gateway
   */
  resetMetrics(gatewayType: GatewayType): void {
    const gateway = this.gateways.get(gatewayType);
    if (gateway) {
      this.initializeMetrics(gatewayType, gateway);
    }
  }

  /**
   * Reset all metrics
   */
  resetAllMetrics(): void {
    this.gateways.forEach((gateway, gatewayType) => {
      this.initializeMetrics(gatewayType, gateway);
    });
  }

  /**
   * Initialize metrics for a gateway
   */
  private initializeMetrics(gatewayType: GatewayType, gateway: PaymentGateway): void {
    this.metrics.set(gatewayType, {
      gatewayName: gateway.name,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 0,
      successRate: 100,
      lastUpdated: new Date(),
    });
  }

  /**
   * Get a summary of all gateway health
   */
  getHealthSummary(): {
    totalGateways: number;
    healthyGateways: number;
    unhealthyGateways: number;
  } {
    const allMetrics = this.getAllMetrics();
    const healthyGateways = allMetrics.filter((m) => m.successRate > 80).length;

    return {
      totalGateways: allMetrics.length,
      healthyGateways,
      unhealthyGateways: allMetrics.length - healthyGateways,
    };
  }

  /**
   * Get the best performing gateway based on success rate and latency
   */
  getBestPerformingGateway(): GatewayType | undefined {
    const allMetrics = this.getAllMetrics();
    if (allMetrics.length === 0) return undefined;

    // Score based on success rate and inverse of latency
    const scored = allMetrics.map((metrics) => {
      const successScore = metrics.successRate;
      const latencyScore = Math.max(0, 100 - metrics.averageLatency / 10);
      const totalScore = successScore * 0.7 + latencyScore * 0.3;

      return {
        gatewayType: this.findGatewayTypeByName(metrics.gatewayName),
        score: totalScore,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.gatewayType;
  }

  /**
   * Find gateway type by gateway name
   */
  private findGatewayTypeByName(name: string): GatewayType | undefined {
    for (const [type, gateway] of this.gateways.entries()) {
      if (gateway.name === name) {
        return type;
      }
    }
    return undefined;
  }
}
