#!/usr/bin/env node
/**
 * Load test for demo flow:
 * 1) POST /api/demo/start
 * 2) POST /api/sessions (authenticated by auth_token cookie)
 *
 * Usage:
 *   node scripts/load-demo.mjs <totalUsers> <concurrency> [baseUrl]
 * Example:
 *   node scripts/load-demo.mjs 100 100 http://localhost:3001
 */

const totalUsers = Number.parseInt(process.argv[2] || '100', 10);
const concurrency = Number.parseInt(process.argv[3] || `${totalUsers}`, 10);
const baseUrl = (process.argv[4] || 'http://localhost:3001').replace(/\/+$/, '');

if (!Number.isFinite(totalUsers) || totalUsers <= 0 || !Number.isFinite(concurrency) || concurrency <= 0) {
  console.error('Invalid arguments. Usage: node scripts/load-demo.mjs <totalUsers> <concurrency> [baseUrl]');
  process.exit(1);
}

const YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const REQUEST_TIMEOUT_MS = 45_000;

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const elapsedMs = performance.now() - startedAt;
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json, elapsedMs, headers: response.headers };
  } catch (error) {
    const elapsedMs = performance.now() - startedAt;
    return {
      ok: false,
      status: 0,
      json: null,
      elapsedMs,
      error: error instanceof Error ? error.message : String(error),
      headers: new Headers(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildResultSkeleton(index) {
  return {
    index,
    ok: false,
    startOk: false,
    sessionOk: false,
    startStatus: 0,
    sessionStatus: 0,
    startMs: 0,
    sessionMs: 0,
    totalMs: 0,
    error: '',
  };
}

async function runUserFlow(index) {
  const flowStartedAt = performance.now();
  const result = buildResultSkeleton(index);

  const startRes = await requestJson(`${baseUrl}/api/demo/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  result.startStatus = startRes.status;
  result.startMs = startRes.elapsedMs;
  result.startOk = Boolean(startRes.ok && startRes.json?.success);

  if (!result.startOk) {
    result.error = `demo/start failed: status=${startRes.status}${startRes.error ? `, error=${startRes.error}` : ''}`;
    result.totalMs = performance.now() - flowStartedAt;
    return result;
  }

  const cookieHeader = startRes.headers.get('set-cookie');
  if (!cookieHeader || !cookieHeader.includes('auth_token=')) {
    result.error = 'demo/start succeeded but no auth_token cookie in response';
    result.totalMs = performance.now() - flowStartedAt;
    return result;
  }

  const tokenPair = cookieHeader.split(';')[0];
  const sessionName = `load-${Date.now()}-${index}`;

  const createSessionRes = await requestJson(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: tokenPair,
    },
    body: JSON.stringify({
      name: sessionName,
      youtubeUrl: YOUTUBE_URL,
    }),
  });

  result.sessionStatus = createSessionRes.status;
  result.sessionMs = createSessionRes.elapsedMs;
  result.sessionOk = Boolean(createSessionRes.ok && createSessionRes.json?.success);
  result.ok = result.startOk && result.sessionOk;
  result.totalMs = performance.now() - flowStartedAt;

  if (!result.sessionOk) {
    const apiError = createSessionRes.json?.error ? `, apiError=${createSessionRes.json.error}` : '';
    result.error = `sessions create failed: status=${createSessionRes.status}${apiError}${createSessionRes.error ? `, error=${createSessionRes.error}` : ''}`;
  }

  return result;
}

async function runPool(total, parallelism) {
  const results = new Array(total);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(parallelism, total) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= total) break;
      results[current] = await runUserFlow(current + 1);
    }
  });

  await Promise.all(workers);
  return results;
}

function summarize(results, wallMs) {
  const total = results.length;
  const fullOk = results.filter((r) => r.ok);
  const startOk = results.filter((r) => r.startOk);
  const sessionOk = results.filter((r) => r.sessionOk);

  const startTimes = results.map((r) => r.startMs).filter((v) => v > 0);
  const sessionTimes = results.map((r) => r.sessionMs).filter((v) => v > 0);
  const totalTimes = results.map((r) => r.totalMs).filter((v) => v > 0);

  const failures = results.filter((r) => !r.ok);

  console.log('');
  console.log('=== Load Test Summary ===');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Users: ${total}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Wall time: ${roundMs(wallMs)} ms`);
  console.log(`Throughput: ${roundMs((total / wallMs) * 1000)} flows/sec`);
  console.log('');
  console.log(`demo/start success: ${startOk.length}/${total} (${roundMs((startOk.length / total) * 100)}%)`);
  console.log(`sessions create success: ${sessionOk.length}/${total} (${roundMs((sessionOk.length / total) * 100)}%)`);
  console.log(`full flow success: ${fullOk.length}/${total} (${roundMs((fullOk.length / total) * 100)}%)`);
  console.log('');
  console.log(`demo/start p50=${roundMs(percentile(startTimes, 50))}ms p95=${roundMs(percentile(startTimes, 95))}ms max=${roundMs(Math.max(0, ...startTimes))}ms`);
  console.log(`session create p50=${roundMs(percentile(sessionTimes, 50))}ms p95=${roundMs(percentile(sessionTimes, 95))}ms max=${roundMs(Math.max(0, ...sessionTimes))}ms`);
  console.log(`full flow p50=${roundMs(percentile(totalTimes, 50))}ms p95=${roundMs(percentile(totalTimes, 95))}ms max=${roundMs(Math.max(0, ...totalTimes))}ms`);

  if (failures.length > 0) {
    console.log('');
    console.log(`Top failures (${Math.min(15, failures.length)}):`);
    failures.slice(0, 15).forEach((f) => {
      console.log(`#${f.index}: ${f.error}`);
    });
  }
}

async function main() {
  console.log(`Running demo load test: users=${totalUsers}, concurrency=${concurrency}, base=${baseUrl}`);
  const startedAt = performance.now();
  const results = await runPool(totalUsers, concurrency);
  const wallMs = performance.now() - startedAt;
  summarize(results, wallMs);
}

main().catch((error) => {
  console.error('Load test failed:', error);
  process.exit(1);
});

