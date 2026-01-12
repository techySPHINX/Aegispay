# Benchmark Results & Validation

This directory contains benchmark reports that validate AegisPay's performance claims.

## Quick Links

- **Latest Report**: [latest.md](./latest.md)
- **Latest JSON**: [latest.json](./latest.json)
- **Historical Reports**: All timestamped reports

## Performance Claims

AegisPay is benchmarked to meet these industry-standard requirements:

| Metric               | Target    | Status |
| -------------------- | --------- | ------ |
| **Throughput (TPS)** | >= 10,000 | ✅     |
| **P95 Latency**      | <= 200ms  | ✅     |
| **Success Rate**     | >= 95%    | ✅     |

## Running Benchmarks

### Locally

```bash
# Install dependencies
pnpm install

# Run all benchmarks
pnpm run benchmark

# Run specific benchmarks
pnpm run benchmark:tps        # Throughput test
pnpm run benchmark:latency    # Latency test
pnpm run benchmark:concurrent # Concurrent load test
```

### CI/CD

Benchmarks run automatically on:

- Every push to `main` branch
- Pull requests
- Daily at 2 AM UTC
- Manual workflow dispatch

View results: [GitHub Actions](https://github.com/techySPHINX/Aegispay/actions/workflows/benchmark.yml)

## Understanding Results

### Test Scenarios

1. **TPS Benchmark**
   - **Purpose**: Validate sustained throughput
   - **Method**: Send requests continuously for 10 seconds
   - **Target**: 10,000+ transactions per second
   - **Pass Criteria**: TPS >= 10,000

2. **Latency Benchmark**
   - **Purpose**: Validate response times under load
   - **Method**: 10,000 requests with 100 concurrent workers
   - **Target**: P95 latency <= 200ms
   - **Pass Criteria**: 95th percentile <= 200ms

3. **Concurrent Load Test**
   - **Purpose**: Validate system stability
   - **Method**: 50,000 concurrent requests with up to 1000 parallel
   - **Target**: >= 95% success rate
   - **Pass Criteria**: Success rate >= 95%

### Environment

**Important**: Benchmarks run on localhost with mock gateways.

**What this validates:**

- ✅ SDK internal processing speed
- ✅ State machine performance
- ✅ Idempotency handling
- ✅ Circuit breaker efficiency
- ✅ Concurrent request management

**Production considerations:**

- Network latency to payment gateways (typically 50-500ms)
- Database I/O operations
- Gateway rate limits
- Geographic distribution

**Expected production performance:**

- TPS: 5,000-8,000 (network-bound)
- P95 Latency: 150-300ms (includes network)

## Benchmark History

Reports are archived with timestamps:

- `benchmark-YYYY-MM-DDTHH-mm-ss.json` - Machine-readable
- `benchmark-YYYY-MM-DDTHH-mm-ss.md` - Human-readable

## System Information

Benchmarks include system details:

- Node.js version
- Platform and architecture
- CPU count
- Total memory

## Continuous Monitoring

View live benchmark trends:

- [GitHub Pages Benchmarks](https://techySPHINX.github.io/Aegispay/benchmarks/)
- [Latest CI Run](https://github.com/techySPHINX/Aegispay/actions/workflows/benchmark.yml)

## Reproducing Results

To reproduce these benchmarks locally:

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Run benchmarks: `pnpm run benchmark`
4. Results will be in `benchmark-reports/`

## Questions?

- 📖 [Full Testing Guide](../docs/TESTING.md)
- 🐛 [Report Issues](https://github.com/techySPHINX/Aegispay/issues)
- 💬 [Discussions](https://github.com/techySPHINX/Aegispay/discussions)
