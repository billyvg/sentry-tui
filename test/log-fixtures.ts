/**
 * Test fixtures for structured logs.
 *
 * Mirrors `fixtures.ts` in shape — deterministic data, no network. The entries
 * represent a realistic mix of severity levels and services.
 */

import type { LogEntry, LogSeverity } from "~/api/logs";

function makeLog(
  id: string,
  severity: LogSeverity,
  body: string,
  project: { id: string; slug: string; name?: string },
  attrs: Record<string, string | number | boolean> = {},
  overrides: Partial<LogEntry> = {},
): LogEntry {
  const base = 1_700_000_000 + Number(id) * 1000;
  const severityNumbers: Record<LogSeverity, number> = {
    trace: 1,
    debug: 5,
    info: 9,
    warn: 13,
    error: 17,
    fatal: 21,
  };
  return {
    id,
    timestamp: new Date(base * 1000).toISOString(),
    severityText: severity,
    severityNumber: severityNumbers[severity],
    body,
    project,
    attributes: attrs,
    ...overrides,
  };
}

const frontend = { id: "2", slug: "javascript", name: "Frontend" };
const backend = { id: "3", slug: "backend", name: "Backend" };
const mlService = { id: "4", slug: "ml-service", name: "ML Service" };
const billing = { id: "5", slug: "billing", name: "Billing" };
const worker = { id: "6", slug: "worker", name: "Worker" };

export const logEntriesFixture: LogEntry[] = [
  makeLog(
    "1",
    "error",
    "Failed to process payment: card declined",
    billing,
    { "payment.provider": "stripe", "user.id": "u_42", "error.code": "card_declined" },
    { traceId: "abc123def456", spanId: "span_001" },
  ),
  makeLog("2", "warn", "Rate limit approaching for Stripe API (85% used)", billing, {
    "rate_limit.used": 85,
    "rate_limit.max": 100,
    "api.endpoint": "/v1/charges",
  }),
  makeLog(
    "3",
    "info",
    "User login successful",
    frontend,
    { "user.id": "u_123", "auth.method": "oauth2", "session.new": true },
    { traceId: "trace_login_001" },
  ),
  makeLog("4", "debug", "Cache miss for key user:profile:u_123, fetching from DB", backend, {
    "cache.key": "user:profile:u_123",
    "cache.backend": "redis",
    "db.query_time_ms": 12,
  }),
  makeLog(
    "5",
    "error",
    "Connection pool exhausted, rejecting new connections",
    backend,
    { "pool.active": 50, "pool.max": 50, "pool.waiting": 23, "db.host": "primary-rw.internal" },
    { traceId: "trace_db_001", spanId: "span_db_pool" },
  ),
  makeLog(
    "6",
    "info",
    "Inference request completed in 245ms",
    mlService,
    { "model.name": "gpt-4o", "model.tokens_in": 1200, "model.tokens_out": 350, latency_ms: 245 },
    { traceId: "trace_ml_001" },
  ),
  makeLog(
    "7",
    "warn",
    "Slow database query detected: SELECT * FROM orders WHERE… (3.2s)",
    backend,
    { "db.statement": "SELECT * FROM orders WHERE status = 'pending'", "db.duration_ms": 3200 },
  ),
  makeLog("8", "fatal", "Worker process crashed with OOM: allocated 4.2GB, limit 4GB", worker, {
    "process.memory_gb": 4.2,
    "process.limit_gb": 4,
    "process.pid": 31425,
  }),
  makeLog("9", "info", "Deployment started: v2.14.3 → v2.14.4", backend, {
    "deploy.from": "v2.14.3",
    "deploy.to": "v2.14.4",
    "deploy.env": "production",
  }),
  makeLog("10", "debug", "WebSocket connection established for user u_456", frontend, {
    "ws.protocol": "wss",
    "user.id": "u_456",
    "connection.id": "conn_789",
  }),
  makeLog("11", "trace", "Entering middleware: authenticate", backend, {
    "middleware.name": "authenticate",
    "request.id": "req_abc123",
  }),
  makeLog(
    "12",
    "error",
    "Timeout waiting for inference response from model service",
    mlService,
    { timeout_ms: 30000, "model.name": "gpt-4o", "retry.attempt": 3, "retry.exhausted": true },
    { traceId: "trace_ml_timeout" },
  ),
  makeLog(
    "13",
    "info",
    "Cron job completed: cleanup_expired_sessions (removed 1,247 sessions)",
    worker,
    { "cron.job": "cleanup_expired_sessions", "cron.removed": 1247, "cron.duration_ms": 890 },
  ),
  makeLog("14", "warn", "Certificate expiring in 7 days for *.example.com", backend, {
    "cert.domain": "*.example.com",
    "cert.expires_in_days": 7,
    "cert.issuer": "Let's Encrypt",
  }),
  makeLog(
    "15",
    "info",
    "Feature flag evaluated: new_checkout_flow = true for user u_42",
    frontend,
    { "flag.name": "new_checkout_flow", "flag.value": true, "user.id": "u_42" },
  ),
  makeLog(
    "16",
    "debug",
    "Background job enqueued: send_welcome_email (queue: email, priority: low)",
    worker,
    { "job.type": "send_welcome_email", "job.queue": "email", "job.priority": "low" },
  ),
  makeLog(
    "17",
    "error",
    "Failed to send webhook: connection refused to https://hooks.example.com/events",
    backend,
    {
      "webhook.url": "https://hooks.example.com/events",
      "webhook.attempt": 2,
      "error.code": "ECONNREFUSED",
    },
    { traceId: "trace_webhook_001" },
  ),
  makeLog("18", "info", "Search index rebuilt: 42,831 documents in 12.4s", backend, {
    "search.documents": 42831,
    "search.duration_s": 12.4,
    "search.engine": "elasticsearch",
  }),
  makeLog("19", "warn", "Disk usage at 89% on /data volume", worker, {
    "disk.path": "/data",
    "disk.used_pct": 89,
    "disk.free_gb": 11.2,
  }),
  makeLog(
    "20",
    "info",
    "API request completed: GET /api/v2/users 200 (23ms)",
    backend,
    {
      "http.method": "GET",
      "http.url": "/api/v2/users",
      "http.status": 200,
      "http.duration_ms": 23,
    },
    { traceId: "trace_api_001" },
  ),
];
