#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface BenchmarkResult {
  testName: string;
  tps: number;
  latencies: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  successRate: number;
  duration: number;
}

interface BenchmarkReport {
  timestamp: string;
  environment: {
    nodeVersion: string;
    platform: string;
    cpus: number;
  };
  results: BenchmarkResult[];
}

async function runTPSBenchmark(): Promise<BenchmarkResult> {
  console.log('Running TPS Benchmark...');

  const start = Date.now();
  const iterations = 100000;
  const latencies: number[] = [];
  let successCount = 0;

  for (let i = 0; i < iterations; i++) {
    const opStart = Date.now();
    // Simulate payment processing
    await simulatePayment();
    const latency = Date.now() - opStart;
    latencies.push(latency);
    successCount++;
  }

  const duration = (Date.now() - start) / 1000;
  const tps = iterations / duration;

  return {
    testName: 'TPS Benchmark',
    tps,
    latencies: calculateLatencies(latencies),
    successRate: (successCount / iterations) * 100,
    duration,
  };
}

async function runLatencyBenchmark(): Promise<BenchmarkResult> {
  console.log('Running Latency Benchmark...');

  const start = Date.now();
  const iterations = 10000;
  const latencies: number[] = [];
  let successCount = 0;

  for (let i = 0; i < iterations; i++) {
    const opStart = Date.now();
    await simulatePayment();
    const latency = Date.now() - opStart;
    latencies.push(latency);
    successCount++;
  }

  const duration = (Date.now() - start) / 1000;

  return {
    testName: 'Latency Benchmark',
    tps: iterations / duration,
    latencies: calculateLatencies(latencies),
    successRate: (successCount / iterations) * 100,
    duration,
  };
}

async function runConcurrentBenchmark(): Promise<BenchmarkResult> {
  console.log('Running Concurrent Load Benchmark...');

  const start = Date.now();
  const concurrentRequests = 1000;
  const batchSize = 100;
  const latencies: number[] = [];
  let successCount = 0;

  for (let i = 0; i < concurrentRequests; i += batchSize) {
    const batch = Array(Math.min(batchSize, concurrentRequests - i))
      .fill(null)
      .map(async () => {
        const opStart = Date.now();
        await simulatePayment();
        const latency = Date.now() - opStart;
        latencies.push(latency);
        successCount++;
      });

    await Promise.all(batch);
  }

  const duration = (Date.now() - start) / 1000;

  return {
    testName: 'Concurrent Load Benchmark',
    tps: concurrentRequests / duration,
    latencies: calculateLatencies(latencies),
    successRate: (successCount / concurrentRequests) * 100,
    duration,
  };
}

async function simulatePayment(): Promise<void> {
  // Simulate async payment processing with minimal delay
  return new Promise((resolve) => setImmediate(resolve));
}

function calculateLatencies(latencies: number[]): {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
} {
  const sorted = latencies.sort((a, b) => a - b);
  const len = sorted.length;

  return {
    p50: sorted[Math.floor(len * 0.5)],
    p95: sorted[Math.floor(len * 0.95)],
    p99: sorted[Math.floor(len * 0.99)],
    avg: sorted.reduce((a, b) => a + b, 0) / len,
  };
}

async function runBenchmarks(type?: string): Promise<void> {
  const results: BenchmarkResult[] = [];

  if (!type || type === 'tps') {
    results.push(await runTPSBenchmark());
  }

  if (!type || type === 'latency') {
    results.push(await runLatencyBenchmark());
  }

  if (!type || type === 'concurrent') {
    results.push(await runConcurrentBenchmark());
  }

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      cpus: os.cpus().length,
    },
    results,
  };

  // Create benchmark-reports directory if it doesn't exist
  const reportsDir = path.join(process.cwd(), 'benchmark-reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Save JSON report
  const jsonPath = path.join(reportsDir, 'latest.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Generate markdown report
  const markdown = generateMarkdownReport(report);
  const mdPath = path.join(reportsDir, 'latest.md');
  fs.writeFileSync(mdPath, markdown);

  console.log('\n📊 Benchmark Results:');
  console.log('=====================\n');

  results.forEach((result) => {
    console.log(`${result.testName}:`);
    console.log(`  TPS: ${result.tps.toFixed(2)}`);
    console.log(`  P95 Latency: ${result.latencies.p95.toFixed(2)}ms`);
    console.log(`  Success Rate: ${result.successRate.toFixed(2)}%\n`);
  });

  console.log(`\n✅ Results saved to ${reportsDir}`);
}

function generateMarkdownReport(report: BenchmarkReport): string {
  let md = '# 📊 Performance Benchmark Report\n\n';
  md += `**Generated:** ${new Date(report.timestamp).toLocaleString()}\n\n`;
  md += '## Environment\n\n';
  md += `- **Node Version:** ${report.environment.nodeVersion}\n`;
  md += `- **Platform:** ${report.environment.platform}\n`;
  md += `- **CPUs:** ${report.environment.cpus}\n\n`;
  md += '## Results\n\n';
  md += '| Test | TPS | P50 | P95 | P99 | Avg | Success Rate |\n';
  md += '|------|-----|-----|-----|-----|-----|-------------|\n';

  report.results.forEach((result) => {
    md += `| ${result.testName} `;
    md += `| ${result.tps.toFixed(0)} `;
    md += `| ${result.latencies.p50.toFixed(2)}ms `;
    md += `| ${result.latencies.p95.toFixed(2)}ms `;
    md += `| ${result.latencies.p99.toFixed(2)}ms `;
    md += `| ${result.latencies.avg.toFixed(2)}ms `;
    md += `| ${result.successRate.toFixed(2)}% |\n`;
  });

  md += '\n## Summary\n\n';
  report.results.forEach((result) => {
    md += `### ${result.testName}\n\n`;
    md += `- **Throughput:** ${result.tps.toFixed(2)} TPS\n`;
    md += `- **P95 Latency:** ${result.latencies.p95.toFixed(2)}ms\n`;
    md += `- **Success Rate:** ${result.successRate.toFixed(2)}%\n`;
    md += `- **Duration:** ${result.duration.toFixed(2)}s\n\n`;
  });

  return md;
}

// Parse command line arguments
const args = process.argv.slice(2);
const type = args.includes('--tps')
  ? 'tps'
  : args.includes('--latency')
    ? 'latency'
    : args.includes('--concurrent')
      ? 'concurrent'
      : undefined;

runBenchmarks(type).catch(console.error);
