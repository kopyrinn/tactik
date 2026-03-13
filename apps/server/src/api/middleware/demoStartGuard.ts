import type { Request } from 'express';

type TokenBucket = {
  tokens: number;
  lastRefillAt: number;
};

type QueueWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  cancelled: boolean;
};

export class DemoStartRateLimitError extends Error {
  retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super('Too many demo start requests');
    this.retryAfterMs = retryAfterMs;
  }
}

export class DemoStartQueueOverloadError extends Error {
  constructor(message = 'Demo start queue is overloaded') {
    super(message);
  }
}

const RATE_WINDOW_MS = Number(process.env.DEMO_START_RATE_WINDOW_MS || 10_000);
const RATE_MAX_REQUESTS = Number(process.env.DEMO_START_RATE_MAX_REQUESTS || 120);
const QUEUE_MAX_CONCURRENCY = Number(process.env.DEMO_START_MAX_CONCURRENCY || 16);
const QUEUE_MAX_LENGTH = Number(process.env.DEMO_START_MAX_QUEUE || 500);
const QUEUE_WAIT_TIMEOUT_MS = Number(process.env.DEMO_START_QUEUE_TIMEOUT_MS || 15_000);
const TRUST_FORWARDED_FOR = process.env.DEMO_START_TRUST_X_FORWARDED_FOR === '1';

const tokenBuckets = new Map<string, TokenBucket>();
const waitQueue: QueueWaiter[] = [];
let activeWorkers = 0;

const bucketCapacity = Number.isFinite(RATE_MAX_REQUESTS) && RATE_MAX_REQUESTS > 0 ? RATE_MAX_REQUESTS : 120;
const refillWindowMs = Number.isFinite(RATE_WINDOW_MS) && RATE_WINDOW_MS > 250 ? RATE_WINDOW_MS : 10_000;
const maxConcurrency = Number.isFinite(QUEUE_MAX_CONCURRENCY) && QUEUE_MAX_CONCURRENCY > 0 ? QUEUE_MAX_CONCURRENCY : 16;
const maxQueueLength = Number.isFinite(QUEUE_MAX_LENGTH) && QUEUE_MAX_LENGTH > 0 ? QUEUE_MAX_LENGTH : 500;
const queueWaitTimeoutMs = Number.isFinite(QUEUE_WAIT_TIMEOUT_MS) && QUEUE_WAIT_TIMEOUT_MS > 250 ? QUEUE_WAIT_TIMEOUT_MS : 15_000;

function normalizeIp(rawIp: string | undefined) {
  if (!rawIp) return 'unknown';
  const first = rawIp.split(',')[0]?.trim() || 'unknown';
  return first.replace(/^::ffff:/, '');
}

function getClientIp(req: Request) {
  const forwardedForHeader = TRUST_FORWARDED_FOR ? req.headers['x-forwarded-for'] : null;
  const forwardedForValue = Array.isArray(forwardedForHeader)
    ? forwardedForHeader[0]
    : forwardedForHeader;

  return normalizeIp(
    forwardedForValue
      || req.ip
      || req.socket?.remoteAddress
      || undefined
  );
}

function consumeToken(ip: string) {
  const now = Date.now();
  const refillPerMs = bucketCapacity / refillWindowMs;
  const existing = tokenBuckets.get(ip);

  if (!existing) {
    tokenBuckets.set(ip, {
      tokens: bucketCapacity - 1,
      lastRefillAt: now,
    });
    return { allowed: true, retryAfterMs: 0 };
  }

  const elapsedMs = Math.max(0, now - existing.lastRefillAt);
  const refilledTokens = elapsedMs * refillPerMs;
  existing.tokens = Math.min(bucketCapacity, existing.tokens + refilledTokens);
  existing.lastRefillAt = now;

  if (existing.tokens >= 1) {
    existing.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  const missingTokens = 1 - existing.tokens;
  const retryAfterMs = Math.ceil(missingTokens / refillPerMs);
  return { allowed: false, retryAfterMs: Math.max(200, retryAfterMs) };
}

function wakeNextQueuedRequest() {
  while (activeWorkers < maxConcurrency && waitQueue.length > 0) {
    const next = waitQueue.shift();
    if (!next || next.cancelled) continue;
    clearTimeout(next.timeoutId);
    activeWorkers += 1;
    next.resolve(createRelease());
    return;
  }
}

function createRelease() {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeWorkers = Math.max(0, activeWorkers - 1);
    wakeNextQueuedRequest();
  };
}

export function assertDemoStartRateLimit(req: Request) {
  const ip = getClientIp(req);
  const result = consumeToken(ip);
  if (!result.allowed) {
    throw new DemoStartRateLimitError(result.retryAfterMs);
  }
}

export async function acquireDemoStartSlot() {
  if (activeWorkers < maxConcurrency) {
    activeWorkers += 1;
    return createRelease();
  }

  if (waitQueue.length >= maxQueueLength) {
    throw new DemoStartQueueOverloadError();
  }

  return new Promise<() => void>((resolve, reject) => {
    const waiter: QueueWaiter = {
      resolve,
      reject,
      cancelled: false,
      timeoutId: setTimeout(() => {
        waiter.cancelled = true;
        reject(new DemoStartQueueOverloadError('Timed out in demo start queue'));
      }, queueWaitTimeoutMs),
    };

    waitQueue.push(waiter);
  });
}

// Keep limiter maps bounded in long-running processes.
setInterval(() => {
  const now = Date.now();
  const ttlMs = refillWindowMs * 3;
  for (const [key, state] of tokenBuckets.entries()) {
    if (now - state.lastRefillAt > ttlMs) {
      tokenBuckets.delete(key);
    }
  }
}, Math.max(10_000, refillWindowMs)).unref?.();
