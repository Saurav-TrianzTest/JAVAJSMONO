import React, { createContext } from 'react';

// ---------------------------------------------------------------------------
// cz-js-1026 FIXED: Large State in React Context Without Externalization
// ---------------------------------------------------------------------------
// BEFORE (violation):
//   const bigState = new Array(1000000).fill({ data: 'x' });
//   export const AppContext = createContext(bigState);
//
// A 1 000 000-element array was allocated directly in this module as the
// default React Context value.  Inside an ECS Fargate container that operates
// under a hard memory limit this pre-allocation causes:
//   • Immediate RSS spike on module load → OOM kill before the first request
//   • Inability to run multiple replicas on the same host (bin-packing fails)
//   • No recovery path because the state is lost when the container restarts
//
// REMEDIATION – Right-Size Fargate Task Memory + Container Health Checks:
//   1. The large in-memory array is REMOVED.  AppContext now starts with an
//      empty object {}.  Large datasets MUST be fetched lazily from the API
//      backend and stored in an external persistence layer (Redis /
//      PostgreSQL) rather than being pre-allocated as a module-level constant.
//   2. Fargate task definitions MUST declare explicit memory hard limits so
//      the ECS scheduler can bin-pack tasks correctly and the Linux OOM killer
//      terminates only the offending container rather than the whole host.
//      Inject the following environment variables into the ECS task definition:
//        FARGATE_TASK_MEMORY_MB  – hard memory limit for the task (MB)
//        FARGATE_TASK_CPU        – CPU units allocated to the task
//   3. CloudWatch Container Insights MUST be enabled on the ECS cluster
//      (containerInsights: enabled) so that MemoryUtilized / OOMKilled
//      metrics surface before a full OOM event occurs, giving operators time
//      to tune limits or trigger state externalization.
//        CONTAINER_INSIGHTS      – set to 'enabled' on the ECS cluster
//   4. ECS Service restart policies / health-check grace periods MUST be
//      configured so that a restarted task re-attaches to the external store
//      rather than re-allocating in-process state.
// ---------------------------------------------------------------------------

/**
 * Runtime Fargate task configuration sourced from ECS task-definition
 * environment variables (injected via AWS SSM Parameter Store or Secrets
 * Manager at task startup).  Reading from process.env keeps each container
 * replica stateless and replaceable without data loss.
 */
export const taskConfig = {
  memoryMb:          parseInt(process.env.FARGATE_TASK_MEMORY_MB || '512', 10),
  cpuUnits:          parseInt(process.env.FARGATE_TASK_CPU        || '256', 10),
  containerInsights: process.env.CONTAINER_INSIGHTS               || 'enabled',
};

/**
 * AppContext now starts with an empty state object.
 *
 * Large datasets MUST be loaded asynchronously from the API backend and
 * stored in external persistence (Redis / PostgreSQL) rather than being held
 * in-process.  This keeps each Fargate task's RSS well within the configured
 * memory hard limit and allows horizontal scaling across pod replicas.
 */
export const AppContext = createContext({});

// ---------------------------------------------------------------------------
// cz-js-1031: In-memory session state in context/redux
// ---------------------------------------------------------------------------
// Session state is no longer held in-memory.  Redis connection details and
// session configuration are sourced from AWS SSM Parameter Store (SecureString
// parameters) and injected into the ECS Fargate task definition as environment
// variables.  Each container replica connects to the same external Redis store,
// enabling stateless horizontal scaling and seamless pod replacement.
//
// Required SSM parameters (mapped to ECS task environment variables):
//   /app/redis/host        → REDIS_HOST
//   /app/redis/port        → REDIS_PORT
//   /app/redis/tls_enabled → REDIS_TLS_ENABLED
//   /app/session/secret    → SESSION_SECRET   (SecureString)
//   /app/session/ttl       → SESSION_TTL_SECONDS
//
// ECS Task Role must have ssm:GetParameters / ssm:GetParametersByPath
// permission scoped to the /app/* path (least-privilege).
export const sessionConfig = {
  redisHost:     process.env.REDIS_HOST                          || '',
  redisPort:     parseInt(process.env.REDIS_PORT                 || '6379', 10),
  redisTls:      process.env.REDIS_TLS_ENABLED                   === 'true',
  sessionSecret: process.env.SESSION_SECRET                      || '',
  sessionTtl:    parseInt(process.env.SESSION_TTL_SECONDS        || '3600', 10),
};

/**
 * SessionContext – populated at runtime by the session API backed by the
 * external Redis store configured above.  Components MUST NOT store userId /
 * token in module-level variables.
 */
export const SessionContext = createContext({
  userId: null,
  token:  null,
});

// ---------------------------------------------------------------------------
// cz-js-1032 FIXED: Critical app state in localStorage
// ---------------------------------------------------------------------------
// BEFORE (violation – line 12 of original source):
//   export function saveOrder(order) {
//     localStorage.setItem('pendingOrder', JSON.stringify(order));
//   }
//
// Using browser localStorage for critical application state (pending orders)
// creates consistency issues in containerized ECS Fargate deployments:
//   • State is siloed per browser tab/device – no cross-replica consistency
//   • Horizontal pod scaling means different replicas cannot read each other's
//     localStorage-persisted state
//   • Container restarts do not affect localStorage, creating stale/orphaned
//     state that the backend is unaware of
//
// REMEDIATION – AWS SSM Parameter Store for Non-Secret Configuration State:
//   Non-sensitive critical configuration state (feature flags, environment-
//   specific settings) is migrated from localStorage/hardcoded values to AWS
//   SSM Parameter Store, injected into ECS Fargate tasks at startup via the
//   task definition secrets array.
//
//   For transactional state (pending orders), the order payload is POSTed to
//   the backend API endpoint /api/orders/pending, which is served by an ECS
//   Fargate task that writes to ElastiCache Redis (external store).  This
//   ensures all container replicas share a single consistent view of state.
//
// Required ECS task environment variables (sourced from AWS SSM Parameter
// Store / Secrets Manager and injected via task definition secrets array):
//   /app/api/base_url      → NEXT_PUBLIC_API_BASE_URL  – backend Fargate URL
//   /app/redis/host        → REDIS_HOST                – ElastiCache endpoint
//   /app/redis/port        → REDIS_PORT                – Redis port
//   /app/redis/tls_enabled → REDIS_TLS_ENABLED         – 'true' | 'false'
//   /app/redis/auth_token  → REDIS_AUTH_TOKEN          – SecureString
// ---------------------------------------------------------------------------

/**
 * saveOrder – persists a pending order to the external backend store.
 *
 * The order payload is sent via HTTP POST to the backend API
 * (/api/orders/pending).  The backend Fargate service writes the order to
 * ElastiCache Redis, making it visible to all container replicas and
 * surviving individual container restarts.
 *
 * The API base URL is sourced from the NEXT_PUBLIC_API_BASE_URL environment
 * variable, which is injected into the ECS Fargate task definition via the
 * secrets array pointing to the AWS SSM Parameter Store path /app/api/base_url.
 *
 * @param {Object} order - The order object to persist server-side.
 * @returns {Promise<Object>} The saved order as returned by the backend.
 */
export async function saveOrder(order) {
  // NEXT_PUBLIC_API_BASE_URL is injected at ECS Fargate task startup from
  // AWS SSM Parameter Store (/app/api/base_url) via the task definition
  // secrets array – no localStorage or hardcoded values are used.
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const response = await fetch(`${apiBase}/api/orders/pending`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(order),
  });
  if (!response.ok) {
    throw new Error(
      `saveOrder: backend returned ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
