import { RoutingStrategy } from '../orchestration/router';
import { LogLevel } from '../infra/observability';
import { GatewayType, Currency } from '../domain/types';

/**
 * SDK Configuration
 */
export interface AegisPayConfig {
  /**
   * Routing configuration
   */
  routing?: {
    strategy?: RoutingStrategy;
    rules?: Array<{
      id: string;
      priority: number;
      conditions: Array<{
        field: string;
        operator: 'equals' | 'greaterThan' | 'lessThan' | 'in' | 'contains';
        value: string | number | string[] | number[];
      }>;
      gatewayType: GatewayType;
      enabled: boolean;
    }>;
  };

  /**
   * Gateway costs for cost-optimized routing
   */
  gatewayCosts?: Array<{
    gatewayType: GatewayType;
    fixedFee: number;
    percentageFee: number;
    currency: Currency;
  }>;

  /**
   * Retry configuration
   */
  retry?: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    jitterFactor?: number;
  };

  /**
   * Circuit breaker configuration
   */
  circuitBreaker?: {
    failureThreshold?: number;
    successThreshold?: number;
    timeout?: number;
    monitoringPeriod?: number;
  };

  /**
   * Logging configuration
   */
  logging?: {
    level?: LogLevel;
    enabled?: boolean;
  };

  /**
   * Metrics configuration
   */
  metrics?: {
    enabled?: boolean;
  };

  /**
   * Event bus configuration
   */
  events?: {
    enabled?: boolean;
    logToConsole?: boolean;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: AegisPayConfig = {
  routing: {
    strategy: RoutingStrategy.HIGHEST_SUCCESS_RATE,
  },
  retry: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  },
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
    monitoringPeriod: 120000,
  },
  logging: {
    level: LogLevel.INFO,
    enabled: true,
  },
  metrics: {
    enabled: true,
  },
  events: {
    enabled: true,
    logToConsole: false,
  },
};

/**
 * Merge user config with defaults
 */
export function mergeConfig(userConfig?: Partial<AegisPayConfig>): AegisPayConfig {
  if (!userConfig) return DEFAULT_CONFIG;

  return {
    routing: {
      ...DEFAULT_CONFIG.routing,
      ...userConfig.routing,
    },
    gatewayCosts: userConfig.gatewayCosts || [],
    retry: {
      ...DEFAULT_CONFIG.retry,
      ...userConfig.retry,
    },
    circuitBreaker: {
      ...DEFAULT_CONFIG.circuitBreaker,
      ...userConfig.circuitBreaker,
    },
    logging: {
      ...DEFAULT_CONFIG.logging,
      ...userConfig.logging,
    },
    metrics: {
      ...DEFAULT_CONFIG.metrics,
      ...userConfig.metrics,
    },
    events: {
      ...DEFAULT_CONFIG.events,
      ...userConfig.events,
    },
  };
}
