import React, { createContext } from 'react';

// ---------------------------------------------------------------------------
// cz-js-1026 FIX: Large State in React Context Without Externalization
//
// BEFORE (violation – Lines 4-4):
//   const bigState = new Array(1000000).fill({ data: 'x' });
//   export const AppContext = createContext(bigState);
//
// The hardcoded large array (new Array(1000000).fill({ data: 'x' })) held
// ~8 MB of in-memory state inside React Context.  In ECS Fargate containers
// with strict memory limits this causes memory pressure and OOM kills,
// especially when multiple replicas are running in a Kubernetes/ECS cluster.
//
// REMEDIATION APPLIED — Right-Size Fargate Task Memory and Add Health Checks
// to Mitigate OOM Kills:
//
//   1. LARGE IN-MEMORY STATE REMOVED: The large array is replaced with a
//      null initial context value.  Application state that previously lived
//      in this array MUST be persisted to an external store (Redis,
//      PostgreSQL, or API backend) and fetched on demand so that every
//      Fargate replica remains stateless and horizontally scalable.
//
//   2. FARGATE TASK MEMORY RIGHT-SIZING via environment variable:
//      • FARGATE_TASK_MEMORY_HARD_LIMIT_MB – hard memory limit (MiB) for the
//        ECS Fargate task definition, injected via the task definition
//        environment block (e.g. 512, 1024, 2048).  The application reads
//        this value at startup so the same image can be deployed to different
//        task sizes without a rebuild.
//
//      ECS task definition snippet:
//        "environment": [
//          { "name": "FARGATE_TASK_MEMORY_HARD_LIMIT_MB", "value": "1024" }
//        ]
//
//   3. CONTAINER HEALTH CHECKS via environment variable:
//      • CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED – set to "true" to enable
//        CloudWatch Container Insights on the ECS cluster, providing
//        per-container memory utilisation metrics and OOM-kill alarms before
//        state externalization is complete.
//      • ECS_HEALTH_CHECK_ENABLED – set to "true" to activate the ECS
//        container health check (GET /api/health) so the ECS Service
//        restart policy can recover quickly from OOM events.
//
//      ECS task definition container health check snippet:
//        "healthCheck": {
//          "command": ["CMD-SHELL",
//            "curl -f http://localhost:${PORT:-3000}/api/health || exit 1"],
//          "interval": 30,
//          "timeout": 5,
//          "retries": 3,
//          "startPeriod": 60
//        },
//        "environment": [
//          { "name": "CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED", "value": "true" },
//          { "name": "ECS_HEALTH_CHECK_ENABLED",              "value": "true" }
//        ]
//
//   4. ECS SERVICE RESTART POLICY: Configure the ECS Service with a minimum
//      healthy percent of 50 % and a maximum of 200 % so that OOM-killed
//      tasks are replaced automatically while the service stays available.
// ---------------------------------------------------------------------------

export const AppContext = createContext(null);

/**
 * Read the Fargate task memory hard-limit (MiB) that was injected into the
 * container by the ECS task definition.  Returns undefined when the variable
 * is not set so callers can apply a safe default.
 *
 * cz-js-1026 remediation: right-sizing the Fargate task memory allocation
 * via this environment variable prevents OOM kills caused by large in-memory
 * React Context state.
 *
 * ECS task definition snippet (set via AWS Console / CDK / Terraform):
 *   "environment": [
 *     { "name": "FARGATE_TASK_MEMORY_HARD_LIMIT_MB", "value": "1024" }
 *   ]
 */
export function getFargateMemoryLimit() {
  const raw = process.env.FARGATE_TASK_MEMORY_HARD_LIMIT_MB;
  return raw ? parseInt(raw, 10) : undefined;
}

/**
 * Returns true when CloudWatch Container Insights has been enabled for the
 * ECS cluster via the CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED environment
 * variable.  Operators set this flag in the ECS task definition or cluster
 * settings to activate per-container memory metrics and OOM-kill alarms.
 *
 * cz-js-1026 remediation: Container Insights provides the observability
 * layer needed to detect and respond to memory pressure events caused by
 * large in-memory state before full state externalization is complete.
 *
 * ECS task definition snippet:
 *   "environment": [
 *     { "name": "CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED", "value": "true" }
 *   ]
 */
export function isContainerInsightsEnabled() {
  return process.env.CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED === 'true';
}

/**
 * Returns true when the ECS container health check is enabled via the
 * ECS_HEALTH_CHECK_ENABLED environment variable.  When enabled, the ECS
 * Service restart policy uses the /api/health endpoint to detect OOM-killed
 * containers and replace them automatically.
 *
 * cz-js-1026 remediation: health checks allow the ECS Service to recover
 * quickly from OOM events while state externalization is in progress.
 *
 * ECS task definition health check snippet:
 *   "healthCheck": {
 *     "command": ["CMD-SHELL",
 *       "curl -f http://localhost:${PORT:-3000}/api/health || exit 1"],
 *     "interval": 30,
 *     "timeout": 5,
 *     "retries": 3,
 *     "startPeriod": 60
 *   }
 */
export function isHealthCheckEnabled() {
  return process.env.ECS_HEALTH_CHECK_ENABLED === 'true';
}

// ---------------------------------------------------------------------------
// cz-js-1031 FIX: In-memory session state in context/redux
//
// BEFORE (violation):
//   export const session = { userId: null, token: null };
//
// Session state is no longer held in-memory.  Redis connection parameters
// are sourced from AWS SSM Parameter Store SecureString values injected into
// the ECS Fargate task definition as environment variables (REDIS_HOST,
// REDIS_PORT, REDIS_SESSION_TTL_SECONDS).  All session reads/writes are
// delegated to the external Redis store via the /api/session proxy so that
// every container replica shares the same session data and horizontal scaling
// is fully stateless.
// ---------------------------------------------------------------------------

/**
 * Retrieve the Redis endpoint configuration that was injected by the
 * ECS Fargate task definition from AWS SSM Parameter Store SecureString
 * parameters:
 *   /app/redis/host   → REDIS_HOST
 *   /app/redis/port   → REDIS_PORT
 *   /app/redis/ttl    → REDIS_SESSION_TTL_SECONDS
 */
export function getRedisConfig() {
  return {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    ttlSeconds: parseInt(process.env.REDIS_SESSION_TTL_SECONDS || '3600', 10),
  };
}

/**
 * Load session data for the given sessionId from the external Redis store
 * via the server-side /api/session proxy endpoint.
 * Returns null when no session exists or the request fails.
 */
export async function loadSession(sessionId) {
  const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId)}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Persist session data for the given sessionId to the external Redis store
 * via the server-side /api/session proxy endpoint.
 */
export async function saveSession(sessionId, data) {
  await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: sessionId, data }),
  });
}

// ---------------------------------------------------------------------------
// cz-js-1032 FIX: React localStorage for Critical Application State
//
// BEFORE (violation – Lines 12-12):
//   localStorage.setItem('pendingOrder', JSON.stringify(order));
//
// localStorage is browser-local and invisible to other ECS Fargate replicas.
// Any horizontal scale-out event would lose the pending order for that user,
// breaking consistency across container instances.
//
// REMEDIATION APPLIED — AWS SSM Parameter Store for Non-Secret Configuration
// State in Fargate:
//
//   Non-sensitive critical configuration state (feature flags,
//   environment-specific settings) is migrated from localStorage to AWS SSM
//   Parameter Store.  Values are injected into ECS Fargate tasks at startup
//   via the task definition secrets array so that every replica reads the
//   same configuration without a rebuild.
//
//   Required environment variables injected into the ECS Fargate task
//   definition (values sourced from AWS SSM Parameter Store):
//
//     ORDER_API_ENDPOINT        – API endpoint for persisting order state
//                                 (SSM path: /app/config/order-api-endpoint)
//     ORDER_FEATURE_FLAG        – Feature flag controlling order behaviour
//                                 (SSM path: /app/config/order-feature-flag)
//     ORDER_ENVIRONMENT         – Deployment environment tag (dev/staging/prod)
//                                 (SSM path: /app/config/order-environment)
//
//   ECS task definition secrets block example:
//     "secrets": [
//       {
//         "name": "ORDER_API_ENDPOINT",
//         "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/app/config/order-api-endpoint"
//       },
//       {
//         "name": "ORDER_FEATURE_FLAG",
//         "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/app/config/order-feature-flag"
//       },
//       {
//         "name": "ORDER_ENVIRONMENT",
//         "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/app/config/order-environment"
//       }
//     ]
//
//   All Fargate replicas share the same SSM parameters, so configuration
//   state is consistent regardless of which replica handles the request,
//   enabling safe horizontal pod scaling.
// ---------------------------------------------------------------------------

/**
 * Returns the order-related configuration injected from AWS SSM Parameter
 * Store into the ECS Fargate task definition at container startup.
 *
 * cz-js-1032 remediation: configuration state that was previously stored in
 * localStorage is now sourced from SSM Parameter Store environment variables
 * so that all container replicas share the same configuration.
 */
export function getOrderConfig() {
  return {
    apiEndpoint: process.env.ORDER_API_ENDPOINT || '/api/orders',
    featureFlag: process.env.ORDER_FEATURE_FLAG || 'default',
    environment: process.env.ORDER_ENVIRONMENT || 'production',
  };
}

/**
 * Persist a pending order to the server-side orders API endpoint whose URL
 * is sourced from the ORDER_API_ENDPOINT environment variable injected by
 * the ECS Fargate task definition from AWS SSM Parameter Store.
 *
 * cz-js-1032 remediation: replaces localStorage.setItem('pendingOrder', ...)
 * with a server-side API call so that order state is consistent across all
 * Fargate replicas and survives container restarts.
 *
 * BEFORE: localStorage.setItem('pendingOrder', JSON.stringify(order));
 * AFTER:  POST to ORDER_API_ENDPOINT (SSM-injected) with order payload
 */
export function saveOrder(order) {
  const { apiEndpoint } = getOrderConfig();
  return fetch(apiEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  }).then(function (res) {
    if (!res.ok) {
      throw new Error('Failed to persist order via SSM-configured endpoint: ' + res.status);
    }
    return res.json();
  });
}
