#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { performance } from 'node:perf_hooks';

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
const RPS = Number.parseInt(argMap.get('rps') || '50', 10);
const DURATION_SEC = Number.parseInt(argMap.get('duration') || '8', 10);
const MAX_INFLIGHT = Number.parseInt(argMap.get('maxInflight') || '300', 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(argMap.get('requestTimeout') || '15000', 10);
const SOCKET_TIMEOUT_MS = Number.parseInt(argMap.get('socketTimeout') || '8000', 10);
const TICK_MS = Number.parseInt(argMap.get('tickMs') || '100', 10);
const WORKER_ID = argMap.get('workerId') || 'w0';
const RESULT_FILE = argMap.get('resultFile') || '';
const SILENT = argMap.get('silent') === '1';

if (!Number.isFinite(RPS) || RPS <= 0) {
  console.error('Invalid --rps');
  process.exit(1);
}

function log(...args) {
  if (SILENT) return;
  console.log(`[${WORKER_ID}]`, ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function parseSetCookie(headerValue) {
  if (!headerValue) return null;
  return String(headerValue).split(';')[0] || null;
}

async function requestJson(url, options = {}) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const elapsedMs = performance.now() - startedAt;
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      headers: response.headers,
      elapsedMs,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: null,
      headers: new Headers(),
      elapsedMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('socket connect timeout'));
    }, SOCKET_TIMEOUT_MS);

    const onConnect = () => {
      cleanup();
      resolve();
    };

    const onError = (err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };

    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
  });
}

function waitForEvent(socket, eventName) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting ${eventName}`));
    }, SOCKET_TIMEOUT_MS);

    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };

    const onError = (err) => {
      cleanup();
      reject(new Error(typeof err === 'string' ? err : JSON.stringify(err)));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off(eventName, onEvent);
      socket.off('error', onError);
    };

    socket.once(eventName, onEvent);
    socket.once('error', onError);
  });
}

function makeSocket(baseUrl, cookieHeader = null) {
  const options = {
    transports: ['websocket'],
    withCredentials: true,
    reconnection: false,
    timeout: SOCKET_TIMEOUT_MS,
  };

  if (cookieHeader) {
    options.extraHeaders = { Cookie: cookieHeader };
  }

  return io(baseUrl, options);
}

function createGuestId(flowId, slot) {
  const entropy = Math.random().toString(36).slice(2, 8);
  return `guest-${WORKER_ID}-${flowId.toString(36)}${slot}${entropy}`.slice(0, 64);
}

function createLineDrawing(flowId, sessionId, userId, color) {
  const id = `draw-${WORKER_ID}-${flowId}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    sessionId,
    userId,
    videoTimestamp: 12.34,
    tool: 'line',
    color,
    createdAt: new Date().toISOString(),
    data: {
      startX: 0.1,
      startY: 0.2,
      endX: 0.32,
      endY: 0.44,
      thickness: 3,
    },
  };
}

async function runCollaborativeFlow(flowId) {
  const flowStartedAt = performance.now();
  let cookieHeader = null;
  let ownerSocket = null;
  let guestSocket1 = null;
  let guestSocket2 = null;

  const cleanup = async () => {
    try {
      if (ownerSocket) ownerSocket.disconnect();
      if (guestSocket1) guestSocket1.disconnect();
      if (guestSocket2) guestSocket2.disconnect();
    } catch {
      // ignore cleanup errors
    }

    if (cookieHeader) {
      try {
        await requestJson(`${BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { Cookie: cookieHeader },
        });
      } catch {
        // ignore cleanup errors
      }
    }
  };

  try {
    const start = await requestJson(`${BASE_URL}/api/demo/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    if (!start.ok || !start.json?.success) {
      throw new Error(`demo/start failed (${start.status}${start.error ? `, ${start.error}` : ''})`);
    }

    cookieHeader = parseSetCookie(start.headers.get('set-cookie'));
    if (!cookieHeader) {
      throw new Error('missing auth cookie from demo/start');
    }

    const ownerUserId = start.json?.data?.user?.id;
    if (!ownerUserId) {
      throw new Error('missing owner user id');
    }

    const createSession = await requestJson(`${BASE_URL}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        name: `${WORKER_ID}-collab-${Date.now()}-${flowId}`,
        youtubeUrl: YOUTUBE_URL,
      }),
    });

    if (!createSession.ok || !createSession.json?.success || !createSession.json?.data?.id) {
      throw new Error(`session create failed (${createSession.status}${createSession.error ? `, ${createSession.error}` : ''})`);
    }

    const sessionId = createSession.json.data.id;

    ownerSocket = makeSocket(BASE_URL, cookieHeader);
    guestSocket1 = makeSocket(BASE_URL);
    guestSocket2 = makeSocket(BASE_URL);

    await Promise.all([
      waitForConnect(ownerSocket),
      waitForConnect(guestSocket1),
      waitForConnect(guestSocket2),
    ]);

    const ownerStatePromise = waitForEvent(ownerSocket, 'session:state');
    ownerSocket.emit('session:join', {
      sessionId,
      userId: ownerUserId,
      color: '#ff0000',
      mode: 'participant',
    });
    await ownerStatePromise;

    const guest1Id = createGuestId(flowId, 'a');
    const guest2Id = createGuestId(flowId, 'b');

    const guest1StatePromise = waitForEvent(guestSocket1, 'session:state');
    guestSocket1.emit('session:join', {
      sessionId,
      userId: guest1Id,
      color: '#00ff00',
      mode: 'participant',
    });
    await guest1StatePromise;

    const guest2StatePromise = waitForEvent(guestSocket2, 'session:state');
    guestSocket2.emit('session:join', {
      sessionId,
      userId: guest2Id,
      color: '#00aaff',
      mode: 'participant',
    });
    await guest2StatePromise;

    ownerSocket.emit('draw:end', {
      sessionId,
      drawing: createLineDrawing(flowId, sessionId, ownerUserId, '#ff0000'),
    });

    guestSocket1.emit('draw:end', {
      sessionId,
      drawing: createLineDrawing(flowId, sessionId, guest1Id, '#00ff00'),
    });

    ownerSocket.emit('board:state', {
      sessionId,
      boardState: {
        pieces: [{ id: 'ball', x: 0.5, y: 0.5 }],
        drawings: [[{ x: 0.15, y: 0.2 }, { x: 0.25, y: 0.3 }]],
      },
    });

    ownerSocket.emit('board:visibility', { sessionId, isOpen: true });
    ownerSocket.emit('board:visibility', { sessionId, isOpen: false });

    await sleep(15);

    ownerSocket.emit('session:leave', sessionId);
    guestSocket1.emit('session:leave', sessionId);
    guestSocket2.emit('session:leave', sessionId);

    await cleanup();

    return {
      ok: true,
      totalMs: performance.now() - flowStartedAt,
      error: '',
    };
  } catch (error) {
    await cleanup();
    return {
      ok: false,
      totalMs: performance.now() - flowStartedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runRpsScenario(rps) {
  const durationMs = DURATION_SEC * 1000;
  const ticks = Math.ceil(durationMs / TICK_MS);
  const scenarioStartedAt = performance.now();
  const target = rps * DURATION_SEC;

  let launched = 0;
  let throttled = 0;
  let completed = 0;
  let success = 0;
  const latencies = [];
  const errorCounts = new Map();

  const inflight = new Set();

  const launchFlow = () => {
    launched += 1;
    const flowId = launched;
    const p = runCollaborativeFlow(flowId)
      .then((result) => {
        completed += 1;
        latencies.push(result.totalMs);
        if (result.ok) {
          success += 1;
        } else {
          const key = result.error || 'unknown';
          errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
        }
      })
      .catch((err) => {
        completed += 1;
        const key = err instanceof Error ? err.message : String(err);
        errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
      })
      .finally(() => {
        inflight.delete(p);
      });
    inflight.add(p);
  };

  for (let tick = 0; tick < ticks; tick += 1) {
    const elapsedTicksMs = (tick + 1) * TICK_MS;
    const shouldHaveLaunched = Math.floor((elapsedTicksMs * rps) / 1000);
    let toLaunch = shouldHaveLaunched - launched;

    while (toLaunch > 0) {
      if (inflight.size >= MAX_INFLIGHT) {
        throttled += 1;
      } else {
        launchFlow();
      }
      toLaunch -= 1;
    }

    await sleep(TICK_MS);
  }

  while (inflight.size > 0) {
    await Promise.race(inflight);
  }

  const wallMs = performance.now() - scenarioStartedAt;
  const topErrors = [...errorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([error, count]) => ({ error, count }));

  return {
    workerId: WORKER_ID,
    rps,
    durationSec: DURATION_SEC,
    targetFlows: target,
    launched,
    throttled,
    completed,
    success,
    successRate: launched > 0 ? (success / launched) * 100 : 0,
    achievedRps: wallMs > 0 ? (launched / wallMs) * 1000 : 0,
    wallMs,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: latencies.length > 0 ? Math.max(...latencies) : 0,
    topErrors,
    latencies,
  };
}

async function main() {
  log('Worker started', { BASE_URL, RPS, DURATION_SEC, MAX_INFLIGHT });
  const result = await runRpsScenario(RPS);

  const compact = {
    workerId: result.workerId,
    rps: result.rps,
    launched: result.launched,
    success: result.success,
    successRate: result.successRate,
    achievedRps: result.achievedRps,
    p95: result.p95,
    throttled: result.throttled,
    topErrors: result.topErrors,
  };

  if (RESULT_FILE) {
    fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    fs.writeFileSync(RESULT_FILE, JSON.stringify(result));
  }

  log('Worker finished', compact);
  console.log(`RESULT_JSON:${JSON.stringify(compact)}`);
}

main().catch((error) => {
  console.error(`[${WORKER_ID}] failed:`, error);
  process.exit(1);
});
