# Testing & Benchmarking Guide

## 🧪 Comprehensive Testing Strategy

AegisPay follows industry-standard testing practices with multiple layers of validation:

### Test Pyramid

```
              /\
             /  \
            / E2E \         (10%) - End-to-end user flows
           /------\
          /  Integ \        (20%) - Component integration
         /----------\
        /    Unit    \      (70%) - Individual functions/classes
       /--------------\
```

## 📊 Running Tests

### Quick Commands

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm run test:unit          # Unit tests only
pnpm run test:integration   # Integration tests only
pnpm run test:e2e           # End-to-end tests only

# Watch mode for development
pnpm run test:watch

# Generate coverage report
pnpm run test:coverage

# Run all tests + benchmarks (CI mode)
pnpm run ci
```

### Test Structure

```
tests/
├── unit/                    # Unit tests (70% coverage)
│   ├── payment.test.ts
│   ├── idempotency.test.ts
│   ├── circuitBreaker.test.ts
│   ├── stateMachine.test.ts
│   └── ...
├── integration/             # Integration tests (20% coverage)
│   ├── paymentService.test.ts
│   ├── eventBus.test.ts
│   └── ...
└── e2e/                     # End-to-end tests (10% coverage)
    ├── payment-lifecycle.test.ts
    └── ...
```

## 🚀 Benchmarking

### Running Benchmarks

```bash
# Run all benchmarks
pnpm run benchmark

# Run specific benchmarks
pnpm run benchmark:tps        # TPS (Throughput) benchmark
pnpm run benchmark:latency    # P95 Latency benchmark
pnpm run benchmark:concurrent # Concurrent load test
```

### Benchmark Claims Validation

AegisPay validates these performance claims:

| Metric           | Target  | Validation Method                           |
| ---------------- | ------- | ------------------------------------------- |
| **TPS**          | 10,000+ | Sustained throughput test (10s duration)    |
| **P95 Latency**  | < 200ms | 10,000 requests with 100 concurrent workers |
| **Success Rate** | > 95%   | 50,000 requests under high load             |

### Understanding Benchmark Results

Example output:

```
🎯 AEGISPAY BENCHMARK SUITE
================================================================================

Validating claims:
  ✓ 10,000+ TPS throughput
  ✓ Sub-200ms P95 latency
  ✓ High concurrent load stability

Environment: localhost (mock gateways)

================================================================================

🚀 Starting TPS Benchmark (Target: 10000 TPS)...
⏱️  Running for 10 seconds...

✅ TPS Benchmark Complete:
   Total Requests: 125,432
   Duration: 10.00s
   TPS: 12,543.20 (Target: 10000)
   Success Rate: 100.00%
   Status: ✅ PASSED

⚡ Starting Latency Benchmark (Target P95: 200ms)...
⏱️  Processing 10,000 requests with 100 concurrent workers...

✅ Latency Benchmark Complete:
   Total Requests: 10,000
   Duration: 2.34s
   TPS: 4,273.50
   Min Latency: 12.45ms
   Mean Latency: 45.67ms
   P50 Latency: 42.31ms
   P95 Latency: 87.23ms (Target: 200ms)
   P99 Latency: 124.56ms
   Max Latency: 189.34ms
   Success Rate: 100.00%
   Status: ✅ PASSED

================================================================================
📊 BENCHMARK SUMMARY
================================================================================

Status: ✅ ALL PASSED

✅ TPS Benchmark
   TPS: 12543.20 | P95: 15.67ms | Success: 100.00%
✅ Latency Benchmark
   TPS: 4273.50 | P95: 87.23ms | Success: 100.00%
✅ Concurrent Load Test
   TPS: 8234.12 | P95: 156.78ms | Success: 98.50%

================================================================================

📊 Report saved to: benchmark-reports/benchmark-2026-01-12T10-30-45.json
📊 Latest report: benchmark-reports/latest.json
📄 Markdown report: benchmark-reports/benchmark-2026-01-12T10-30-45.md
```

### Benchmark Reports

After running benchmarks, you'll find:

- **JSON Report**: `benchmark-reports/latest.json` - Machine-readable results
- **Markdown Report**: `benchmark-reports/latest.md` - Human-readable summary with tables
- **Historical Reports**: All past benchmarks are saved for comparison

### Localhost vs Production Performance

**Important Note**: These benchmarks use **mock gateways on localhost**, which means:

✅ **What we validate:**

- SDK internal performance (state machines, idempotency, circuit breakers)
- Throughput handling capability
- Concurrent request processing
- Memory and CPU efficiency

⚠️ **Production considerations:**

- Network latency to real payment gateways (50-500ms typical)
- Database I/O operations
- Third-party API rate limits
- Geographic distance to gateway servers

**Expected production performance:**

- TPS: 5,000-8,000 (depending on gateway latency)
- P95 Latency: 150-300ms (includes network + gateway processing)
- Scale horizontally for higher throughput

## 🎯 Coverage Requirements

### Coverage Thresholds

```javascript
{
  global: {
    branches: 80%,
    functions: 80%,
    lines: 80%,
    statements: 80%
  }
}
```

### Generate Coverage Report

```bash
pnpm run test:coverage
```

Coverage reports are generated in:

- `coverage/lcov-report/index.html` - Interactive HTML report
- `coverage/coverage-summary.json` - JSON summary
- `coverage/lcov.info` - LCOV format for CI tools

## 🔄 CI/CD Integration

### GitHub Actions Workflows

#### 1. **CI Pipeline** (`.github/workflows/ci.yml`)

Runs on every push and PR:

- ✅ Code quality (ESLint, Prettier)
- ✅ Type checking (TypeScript)
- ✅ Unit tests
- ✅ Integration tests
- ✅ E2E tests
- ✅ Performance benchmarks
- ✅ Build verification (Windows, macOS, Linux)
- ✅ Security audit

#### 2. **Benchmark Pipeline** (`.github/workflows/benchmark.yml`)

Runs daily + on main branch pushes:

- 📊 Full benchmark suite on multiple OS
- 📊 Cross-platform validation (Ubuntu, Windows, macOS)
- 📊 Node.js version matrix (18.x, 20.x)
- 📊 Historical comparison with baseline
- 📊 Automated GitHub Pages deployment

### Viewing CI Results

1. **PR Comments**: Benchmark results posted automatically on PRs
2. **GitHub Actions**: Full logs at `https://github.com/techySPHINX/Aegispay/actions`
3. **Coverage**: Codecov integration (if configured)
4. **Artifacts**: Download benchmark reports from workflow runs

## 📈 Test Coverage by Module

| Module               | Unit Tests | Integration Tests | E2E Tests |
| -------------------- | ---------- | ----------------- | --------- |
| Payment Domain       | ✅         | ✅                | ✅        |
| State Machine        | ✅         | ✅                | ✅        |
| Idempotency          | ✅         | ✅                | ✅        |
| Circuit Breaker      | ✅         | ✅                | ✅        |
| Event Sourcing       | ✅         | ✅                | ✅        |
| Gateway Registry     | ✅         | ✅                | ✅        |
| Retry Logic          | ✅         | ✅                | ✅        |
| Transactional Outbox | ✅         | ✅                | ✅        |

## 🐛 Debugging Tests

### Run Single Test File

```bash
pnpm test -- tests/unit/payment.test.ts
```

### Run Specific Test Case

```bash
pnpm test -- -t "should create a payment with required fields"
```

### Debug Mode

```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

## 📝 Writing Tests

### Unit Test Template

```typescript
import { YourModule } from '../../src/path/to/module';

describe('YourModule', () => {
  let instance: YourModule;

  beforeEach(() => {
    instance = new YourModule();
  });

  describe('specificFeature', () => {
    it('should do something', () => {
      const result = instance.doSomething();
      expect(result).toBe(expectedValue);
    });

    it('should handle errors', () => {
      expect(() => {
        instance.doInvalidThing();
      }).toThrow('Expected error message');
    });
  });
});
```

### Integration Test Template

```typescript
import { PaymentService } from '../../src/api/paymentService';
import { MockGateway } from '../../src/gateways/mockGateway';

describe('Feature Integration', () => {
  let service: PaymentService;

  beforeEach(() => {
    // Setup real components
    service = new PaymentService({
      // ... config
    });
  });

  it('should integrate components correctly', async () => {
    const result = await service.processPayment({
      // ... payment data
    });

    expect(result.status).toBe('completed');
  });
});
```

## 🔍 Test Best Practices

1. **Isolation**: Each test should be independent
2. **Naming**: Use descriptive test names (`should X when Y`)
3. **Arrange-Act-Assert**: Structure tests clearly
4. **Mock External Dependencies**: Use mocks for external services
5. **Test Edge Cases**: Cover error scenarios
6. **Fast Tests**: Keep unit tests under 100ms

## 📊 Continuous Monitoring

### Pre-commit Hooks

```bash
# Install husky
pnpm install --save-dev husky

# Setup pre-commit hook
npx husky install
npx husky add .husky/pre-commit "pnpm run lint && pnpm run typecheck && pnpm test"
```

### Pre-push Validation

```bash
npx husky add .husky/pre-push "pnpm run ci"
```

## 🎓 Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Benchmark.js Guide](https://benchmarkjs.com/)

## 🆘 Troubleshooting

### Tests Timeout

Increase timeout in jest.config.js:

```javascript
module.exports = {
  testTimeout: 30000, // 30 seconds
};
```

### Memory Issues

Run with increased heap size:

```bash
NODE_OPTIONS=--max_old_space_size=4096 pnpm test
```

### CI Failures

1. Check workflow logs in GitHub Actions
2. Download artifacts for detailed reports
3. Run same test locally: `pnpm run ci`

---

**Need Help?** Open an issue on [GitHub](https://github.com/techySPHINX/Aegispay/issues)
