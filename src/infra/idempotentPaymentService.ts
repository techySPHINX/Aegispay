/**
 * Idempotent Payment Service Wrapper
 * 
 * This wrapper adds idempotency protection to payment operations,
 * ensuring no double charges even under:
 * - Network retries
 * - Client retries
 * - Service crashes
 * - Concurrent duplicate requests
 */

import { Payment } from '../domain/payment';
import {
  Result,
  fail,
} from '../domain/types';
import { IdempotencyEngine } from './idempotency';
import { PaymentService, CreatePaymentRequest, ProcessPaymentRequest } from '../api/paymentService';
import { Logger } from './observability';

/**
 * Idempotent payment operations
 */
export class IdempotentPaymentService {
  constructor(
    private paymentService: PaymentService,
    private idempotencyEngine: IdempotencyEngine,
    private logger: Logger
  ) { }

  /**
   * Create payment with idempotency protection
   * 
   * Guarantees:
   * - Same idempotency key → same payment (no duplicates)
   * - Request fingerprint validated (detects tampering)
   * - Concurrent requests handled safely (distributed lock)
   * - Response cached and returned for duplicates
   */
  async createPaymentIdempotent(
    merchantId: string,
    request: CreatePaymentRequest
  ): Promise<Result<Payment, Error>> {
    this.logger.info('Creating payment with idempotency', {
      merchantId,
      idempotencyKey: request.idempotencyKey,
      amount: request.amount,
      currency: request.currency,
    });

    try {
      const result = await this.idempotencyEngine.executeIdempotent<
        CreatePaymentRequest,
        Result<Payment, Error>
      >(
        merchantId,
        'create_payment',
        request.idempotencyKey,
        request,
        async () => {
          // Execute the actual payment creation
          return await this.paymentService.createPayment(request);
        }
      );

      return result;
    } catch (error) {
      this.logger.error('Idempotent payment creation failed', error as Error, {
        merchantId,
        idempotencyKey: request.idempotencyKey,
      });
      return fail(error as Error);
    }
  }

  /**
   * Process payment with idempotency protection
   * 
   * Guarantees:
   * - Same idempotency key → same processing result
   * - No double processing even if service crashes mid-execution
   * - Concurrent requests wait for first to complete
   */
  async processPaymentIdempotent(
    merchantId: string,
    idempotencyKey: string,
    request: ProcessPaymentRequest
  ): Promise<Result<Payment, Error>> {
    this.logger.info('Processing payment with idempotency', {
      merchantId,
      idempotencyKey,
      paymentId: request.paymentId,
    });

    try {
      const result = await this.idempotencyEngine.executeIdempotent<
        ProcessPaymentRequest,
        Result<Payment, Error>
      >(
        merchantId,
        'process_payment',
        idempotencyKey,
        request,
        async () => {
          // Execute the actual payment processing
          return await this.paymentService.processPayment(request);
        }
      );

      return result;
    } catch (error) {
      this.logger.error('Idempotent payment processing failed', error as Error, {
        merchantId,
        idempotencyKey,
        paymentId: request.paymentId,
      });
      return fail(error as Error);
    }
  }

  /**
   * Verify if an idempotency key has been used
   */
  async isIdempotencyKeyUsed(
    merchantId: string,
    operation: string,
    idempotencyKey: string
  ): Promise<boolean> {
    const scopedKey = this.idempotencyEngine.generateKey(merchantId, operation, idempotencyKey);
    const record = await this.idempotencyEngine['store'].get(scopedKey);
    return record !== null;
  }

  /**
   * Cleanup expired idempotency records
   * Should be run periodically
   */
  async cleanupExpiredRecords(): Promise<number> {
    const deleted = await this.idempotencyEngine.cleanup();
    this.logger.info('Cleaned up expired idempotency records', { count: deleted });
    return deleted;
  }
}

// ============================================================================
// IDEMPOTENCY MIDDLEWARE FOR HTTP APIS
// ============================================================================

/**
 * Express/Fastify middleware for idempotency
 * Extracts idempotency key from headers and wraps the operation
 */
export interface IdempotencyMiddlewareConfig {
  headerName: string; // e.g., 'Idempotency-Key'
  merchantIdExtractor: (req: Record<string, unknown>) => string; // Extract merchant ID from request
  operationName: string; // e.g., 'create_payment'
}

/**
 * Create idempotency middleware
 * 
 * Usage:
 * ```typescript
 * app.post('/payments', 
 *   idempotencyMiddleware(engine, {
 *     headerName: 'Idempotency-Key',
 *     merchantIdExtractor: (req) => req.user.merchantId,
 *     operationName: 'create_payment'
 *   }),
 *   async (req, res) => {
 *     // Your handler - wrapped automatically
 *   }
 * );
 * ```
 */
export function createIdempotencyMiddleware(
  engine: IdempotencyEngine,
  config: IdempotencyMiddlewareConfig
) {
  return async (req: Record<string, unknown>, res: Record<string, unknown>, next: (err?: unknown) => void): Promise<unknown> => {
    const idempotencyKey = (req as { headers: Record<string, string> }).headers[config.headerName.toLowerCase()];

    if (!idempotencyKey) {
      (res as { status: (code: number) => { json: (data: unknown) => unknown } }).status(400).json({
        error: 'MISSING_IDEMPOTENCY_KEY',
        message: `${config.headerName} header is required`,
      });
      return;
    }

    try {
      const merchantId = config.merchantIdExtractor(req) as string;
      const requestBody = req.body;

      // Store original handler
      const response = res as { json: (data: unknown) => unknown };
      const originalJson = response.json.bind(res);
      let handlerExecuted = false;
      let handlerResult: unknown;

      // Wrap response to capture the result
      response.json = function (body: unknown): unknown {
        if (!handlerExecuted) {
          handlerResult = body;
          handlerExecuted = true;
        }
        return originalJson(body);
      };

      // Execute with idempotency
      const result = await engine.executeIdempotent(
        merchantId,
        config.operationName,
        idempotencyKey,
        requestBody,
        async () => {
          // Call next middleware/handler
          await new Promise<void>((resolve, reject) => {
            next();
            // Wait for handler to complete
            setImmediate(() => {
              if (handlerExecuted) {
                resolve();
              } else {
                reject(new Error('Handler did not complete'));
              }
            });
          });
          return handlerResult;
        }
      );

      // If we got a cached result, return it
      if (!handlerExecuted) {
        (res as { json: (data: unknown) => unknown }).json(result);
        return;
      }
    } catch (error: unknown) {
      const err = error as Error & { name: string };
      if (err.name === 'IdempotencyFingerprintMismatchError') {
        (res as { status: (code: number) => { json: (data: unknown) => unknown } }).status(400).json({
          error: 'IDEMPOTENCY_KEY_REUSED',
          message: err.message,
          idempotencyKey,
        });
        return;
      }

      if (err.name === 'IdempotencyTimeoutError') {
        (res as { status: (code: number) => { json: (data: unknown) => unknown } }).status(409).json({
          error: 'REQUEST_IN_PROGRESS',
          message: err.message,
          idempotencyKey,
        });
        return;
      }

      throw error;
    }
    return undefined;
  };
}

// ============================================================================
// IDEMPOTENCY DECORATOR
// ============================================================================

/**
 * Decorator for idempotent methods
 * 
 * Usage:
 * ```typescript
 * class PaymentAPI {
 *   @Idempotent('create_payment')
 *   async createPayment(merchantId: string, idempotencyKey: string, request: CreatePaymentRequest) {
 *     // Implementation
 *   }
 * }
 * ```
 */
export function Idempotent(operation: string) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: { idempotencyEngine?: IdempotencyEngine }, ...args: unknown[]): Promise<unknown> {
      // Assume first arg is merchantId, second is idempotencyKey
      const [merchantId, idempotencyKey, ...restArgs] = args;

      if (!this.idempotencyEngine) {
        throw new Error(
          'IdempotencyEngine not found. Add it to your class as "idempotencyEngine" property.'
        );
      }

      return await this.idempotencyEngine.executeIdempotent(
        String(merchantId),
        operation,
        String(idempotencyKey),
        restArgs,
        async () => {
          return await originalMethod.apply(this, args);
        }
      );
    };

    return descriptor;
  };
}
