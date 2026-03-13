#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const argMap = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) {
    argMap.set(key.slice(2), '1');
  } else {
    argMap.set(key.slice(2), next);
    i += 1;
  }
}

const BASE_URL = (argMap.get('base') || 'http://localhost:3001').replace(/\/+$/, '');
const YOUTUBE_URL = argMap.get('youtube') || 'https://www.youtube.com/watch?v=I7IzvXiBa0U';
const LEVELS = (argMap.get('levels') || '100,300,600,1000,2000')
  .split(',')
  .map((v) => Number.parseInt(v.trim(), 10))
  .filter((v) => Number.isFinite(v) && v > 0);
const DURATION_SEC = Number.parseInt(argMap.get('duration') || '8', 10);
const WORKERS = Number.parseInt(argMap.get('workers') || String(Math.min(4, os.cpus().length || 4)), 10);
const MAX_INFLIGHT_PER_WORKER = Number.parseInt(argMap.get('maxInflightPerWorker') || '300', 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(argMap.get('requestTimeout') || '15000', 10);
const SOCKET_TIMEOUT_MS = Number.parseInt(argMap.get('socketTimeout') || '8000', 10);
const SILENT_WORKERS = argMap.get('silentWorkers') !== '0';

if (LEVELS.length === 0) {
  console.error('No valid --levels');
  process.exit(1);
}

if (!Number.isFinite(WORKERS) || WORKERS <= 0) {
  console.error('Invalid --workers');
  process.exit(1);
}

const workerScriptPath = path.resolve('apps/web/scripts/load-collab-worker.mjs');
const reportDir = path.resolve('apps/web/scripts/.tmp/load-collab-dist');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function distributeRps(targetRps, workers) {
  const shares = new Array(workers).fill(Math.floor(targetRps / workers));
  let rest = targetRps % workers;
  let idx = 0;
  while (rest > 0) {
    shares[idx] += 1;
    idx = (idx + 1) % workers;
    rest -= 1;
  }
  return shares;
}

function aggregateErrors(workerResults) {
  const map = new Map();
  for (const worker of workerResults) {
    for (const item of worker.topErrors || []) {
      const key = item.error || 'unknown';
      map.set(key, (map.get(key) || 0) + Number(item.count || 0));
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([error, count]) => ({ error, count }));
}

function aggregateScenario(level, workerResults) {
  const latencies = [];
  let launched = 0;
  let completed = 0;
  let success = 0;
  let throttled = 0;
  let targetFlows = 0;
  let maxWallMs = 0;

  for (const worker of workerResults) {
    launched += Number(worker.launched || 0);
    completed += Number(worker.completed || 0);
    success += Number(worker.success || 0);
    throttled += Number(worker.throttled || 0);
    targetFlows += Number(worker.targetFlows || 0);
    maxWallMs = Math.max(maxWallMs, Number(worker.wallMs || 0));
    if (Array.isArray(worker.latencies)) {
      for (const value of worker.latencies) {
        if (Number.isFinite(value)) latencies.push(Number(value));
      }
    }
  }

  const topErrors = aggregateErrors(workerResults);
  return {
    rps: level,
    workers: workerResults.length,
    durationSec: DURATION_SEC,
    targetFlows,
    launched,
    completed,
    success,
    throttled,
    successRate: launched > 0 ? (success / launched) * 100 : 0,
    achievedRps: maxWallMs > 0 ? (launched / maxWallMs) * 1000 : 0,
    wallMs: maxWallMs,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: latencies.length > 0 ? Math.max(...latencies) : 0,
    topErrors,
  };
}

function runWorker({ level, workerIndex, workerRps }) {
  return new Promise((resolve, reject) => {
    const workerId = `L${level}-W${workerIndex + 1}`;
    const resultFile = path.join(reportDir, `${workerId}.json`);

    const args = [
      workerScriptPath,
      '--base', BASE_URL,
      '--youtube', YOUTUBE_URL,
      '--rps', String(workerRps),
      '--duration', String(DURATION_SEC),
      '--maxInflight', String(MAX_INFLIGHT_PER_WORKER),
      '--requestTimeout', String(REQUEST_TIMEOUT_MS),
      '--socketTimeout', String(SOCKET_TIMEOUT_MS),
      '--workerId', workerId,
      '--resultFile', resultFile,
    ];

    if (SILENT_WORKERS) {
      args.push('--silent', '1');
    }

    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (!SILENT_WORKERS) process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker ${workerId} exited with ${code}. stderr=${stderr.trim()}`));
        return;
      }

      try {
        const raw = fs.readFileSync(resultFile, 'utf-8');
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch (error) {
        reject(new Error(`worker ${workerId} did not produce valid result file. stdout=${stdout.trim()}`));
      }
    });
  });
}

async function runLevel(level) {
  const rpsShares = distributeRps(level, WORKERS).filter((v) => v > 0);
  const workersToRun = rpsShares.map((workerRps, workerIndex) => ({ level, workerIndex, workerRps }));

  const workerResults = await Promise.all(workersToRun.map((job) => runWorker(job)));
  return aggregateScenario(level, workerResults);
}

function printScenario(result) {
  console.log('\n=== Distributed Scenario ===');
  console.log(`Target RPS: ${result.rps}`);
  console.log(`Workers: ${result.workers}`);
  console.log(`Duration: ${result.durationSec}s`);
  console.log(`Target flows: ${result.targetFlows}`);
  console.log(`Launched flows: ${result.launched}`);
  console.log(`Completed flows: ${result.completed}`);
  console.log(`Success: ${result.success}/${result.launched} (${round2(result.successRate)}%)`);
  console.log(`Achieved launch rate: ${round2(result.achievedRps)} flows/sec`);
  console.log(`Wall time: ${round2(result.wallMs)} ms`);
  console.log(`Flow latency p50=${round2(result.p50)}ms p95=${round2(result.p95)}ms max=${round2(result.max)}ms`);
  console.log(`Throttled launches: ${result.throttled}`);

  if (result.topErrors.length > 0) {
    console.log('Top errors:');
    for (const item of result.topErrors) {
      console.log(`- ${item.count}x ${item.error}`);
    }
  }
}

async function main() {
  fs.mkdirSync(reportDir, { recursive: true });

  console.log('Distributed collaborative load test (multi-worker)');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`YouTube URL: ${YOUTUBE_URL}`);
  console.log(`RPS levels: ${LEVELS.join(', ')}`);
  console.log(`Duration per level: ${DURATION_SEC}s`);
  console.log(`Workers: ${WORKERS}`);
  console.log(`Max inflight per worker: ${MAX_INFLIGHT_PER_WORKER}`);

  const summary = [];

  for (const level of LEVELS) {
    const result = await runLevel(level);
    printScenario(result);
    summary.push(result);
    await sleep(1200);
  }

  console.log('\n=== Summary Table ===');
  console.log('rps\tworkers\tlaunched\tsuccess\tsuccess%\tachieved/s\tp95ms\tthrottled');
  for (const item of summary) {
    console.log(
      `${item.rps}\t${item.workers}\t${item.launched}\t${item.success}\t${round2(item.successRate)}\t${round2(item.achievedRps)}\t${round2(item.p95)}\t${item.throttled}`
    );
  }
}

main().catch((error) => {
  console.error('Distributed load test failed:', error);
  process.exit(1);
});
