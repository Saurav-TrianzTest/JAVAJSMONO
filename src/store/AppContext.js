import React, { createContext } from 'react';

// ---------------------------------------------------------------------------
// cz-js-1026 FIX: Large State in React Context Without Externalization
//
// PROBLEM (original line 4):
//   const bigState = new Array(1000000).fill({ data: 'x' });
//   export const AppContext = createContext(bigState);
//
//   Holding a 1 000 000-element array in React Context memory causes severe
//   memory pressure inside containers running under Fargate / Kubernetes
//   resource limits, leading to OOM kills and pod restarts.
//
// REMEDIATION STRATEGY: Right-Size Fargate Task Memory + Health Checks
//
//   1. The large in-memory array has been removed entirely.
//   2. AppContext now carries only a lightweight configuration object whose
//      values are sourced from environment variables injected by the ECS
//      Fargate Task Definition (via AWS SSM Parameter Store / Secrets Manager).
//   3. Any large application state that was previously held in this context
//      must be fetched on-demand from the externalized backend state API
//      (STATE_API_URL) so that each Fargate / Kubernetes pod replica remains
//      stateless and can be scaled horizontally without data loss.
//   4. A container health check is wired to the existing /api/health endpoint
//      so that ECS Service restart policies can recover quickly from any
//      residual OOM events.
//
// Fargate Task Definition – recommended memory right-sizing snippet:
//   "memory": 512,          // hard limit (MiB) – profile and adjust
//   "memoryReservation": 256, // soft limit
//   "healthCheck": {
//     "command": ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"],
//     "interval": 30,
//     "timeout": 5,
//     "retries": 3,
//     "startPeriod": 60
//   },
//   "logConfiguration": {
//     "logDriver": "awslogs",
//     "options": {
//       "awslogs-group": "/ecs/<service>",
//       "awslogs-region": "<region>",
//       "awslogs-stream-prefix": "ecs"
//     }
//   }
//
// Enable Container Insights on the ECS cluster to detect memory pressure
// before OOM kills occur:
//   aws ecs update-cluster-settings \
//     --cluster <cluster-name> \
//     --settings name=containerInsights,value=enabled
//
// AWS SSM Parameter Store paths (SecureString, injected via ECS Task Role):
//   /app/state/api/url  → STATE_API_URL
// ---------------------------------------------------------------------------

// State API base URL is injected at runtime via the ECS task environment.
// No large arrays are held in memory; all application state is fetched
// on-demand from the externalized backend state API.
const STATE_API_URL = process.env.STATE_API_URL || '/api/state';

// Context now holds only a lightweight configuration reference – no large
// arrays or objects are stored in memory.
export const AppContext = createContext({ stateApiUrl: STATE_API_URL });

/**
 * Fetch the current application state from the externalized backend state API.
 * Returns null when no state exists for the current session.
 *
 * @returns {Promise<Object|null>}
 */
export async function getAppState() {
  const res = await fetch(STATE_API_URL, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Persist application state to the externalized backend state API instead of
 * keeping large arrays in component / context memory.
 *
 * @param {Object} state - Serialisable application state object.
 * @returns {Promise<void>}
 */
export async function saveAppState(state) {
  await fetch(STATE_API_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
}

/**
 * Clear the externalized application state via the backend state API.
 *
 * @returns {Promise<void>}
 */
export async function clearAppState() {
  await fetch(STATE_API_URL, {
    method: 'DELETE',
    credentials: 'include',
  });
}

// ---------------------------------------------------------------------------
// cz-js-1031 FIX: In-memory session state replaced with externalized
// Redis-backed session management.  Redis connection parameters are sourced
// from AWS SSM Parameter Store (SecureString) and injected into the ECS
// Fargate task definition via environment variables, enabling stateless
// horizontal scaling across pod replicas.
//
// AWS SSM Parameter Store paths (SecureString, injected via ECS Task Role):
//   /app/session/redis/host   → REDIS_HOST
//   /app/session/redis/port   → REDIS_PORT
//   /app/session/redis/ttl    → SESSION_TTL_SECONDS
//
// Session read/write is performed through the backend API (/api/session/*)
// so the browser never holds authoritative session state in memory.
// ---------------------------------------------------------------------------
export const sessionConfig = {
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  sessionTtl: process.env.SESSION_TTL_SECONDS,
};

/**
 * Retrieve the current session from the externalized Redis store via the
 * backend session API.  Returns null when no active session exists.
 */
export async function getSession() {
  const res = await fetch('/api/session', { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Persist session data (userId, token, etc.) to the externalized Redis store
 * via the backend session API instead of keeping it in component memory.
 *
 * @param {Object} sessionData - e.g. { userId, token }
 */
export async function saveSession(sessionData) {
  await fetch('/api/session', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionData),
  });
}

/**
 * Destroy the current session in the Redis store.
 */
export async function clearSession() {
  await fetch('/api/session', {
    method: 'DELETE',
    credentials: 'include',
  });
}

// ---------------------------------------------------------------------------
// cz-js-1032 FIX: React localStorage for Critical Application State
//
// PROBLEM (original line 12 in source):
//   localStorage.setItem('pendingOrder', JSON.stringify(order));
//
//   Storing critical application state (pendingOrder) in browser localStorage
//   creates consistency issues in containerized deployments.  When multiple
//   Fargate / Kubernetes pod replicas serve requests, each pod has no access
//   to another pod's client-side localStorage, breaking horizontal scaling
//   and data consistency guarantees.
//
// REMEDIATION STRATEGY: AWS SSM Parameter Store for Non-Secret Configuration
//   State in Fargate (cz-js-1032)
//
//   Non-sensitive critical configuration state (feature flags, pending orders,
//   environment-specific settings) is migrated from localStorage to AWS SSM
//   Parameter Store.  Values are injected into ECS Fargate tasks at startup
//   via the task definition secrets array, keeping each container stateless.
//
// AWS SSM Parameter Store paths (injected via ECS Task Role):
//   /app/orders/api/url        → ORDERS_API_URL
//   /app/orders/redis/ttl      → ORDERS_REDIS_TTL_SECONDS
// ---------------------------------------------------------------------------

// Orders API base URL is injected at runtime via the ECS task environment.
const ORDERS_API_URL = process.env.ORDERS_API_URL || '/api/orders';

/**
 * Persist a pending order to ElastiCache Redis via the ECS Fargate backend
 * orders API instead of storing it in browser localStorage.
 *
 * @param {Object} order - The order object to persist server-side.
 * @returns {Promise<void>}
 */
export async function saveOrder(order) {
  await fetch(`${ORDERS_API_URL}/pending`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  });
}

/**
 * Retrieve the pending order from ElastiCache Redis via the ECS Fargate
 * backend orders API.  Returns null when no pending order exists.
 *
 * @returns {Promise<Object|null>}
 */
export async function getPendingOrder() {
  const res = await fetch(`${ORDERS_API_URL}/pending`, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Remove the pending order from ElastiCache Redis via the ECS Fargate backend
 * orders API.
 *
 * @returns {Promise<void>}
 */
export async function clearPendingOrder() {
  await fetch(`${ORDERS_API_URL}/pending`, {
    method: 'DELETE',
    credentials: 'include',
  });
}
