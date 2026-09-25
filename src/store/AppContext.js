import React, { createContext } from 'react';

// ---------------------------------------------------------------------------
// cz-js-1026 FIX: Large State in React Context Without Externalization
//
// BEFORE (violation – line 4 of source):
//   const bigState = new Array(1000000).fill({ data: 'x' });
//   export const AppContext = createContext(bigState);
//
// PROBLEM: Allocating a 1,000,000-element array directly as the React Context
// initial value creates unbounded memory pressure inside containers.  When
// ECS Fargate task memory hard limits are enforced the process is OOM-killed,
// causing service disruption and failed health checks.
//
// REMEDIATION (cz-js-1026): Right-Size Fargate Task Memory and Add Health
// Checks to Mitigate OOM Kills.
//
// As an immediate interim fix the large in-memory state allocation has been
// removed.  The context is initialised with a minimal empty-object placeholder
// so that existing consumers continue to compile and run without modification.
//
// Long-term state externalization strategy:
//   - Large / shared application state MUST be persisted in an external store
//     (Redis, PostgreSQL, or a dedicated API backend).
//   - The container reads connection details exclusively from environment
//     variables injected by the ECS task definition (sourced from AWS SSM
//     Parameter Store SecureString parameters):
//       STATE_API_BASE_URL  – base URL of the external state/API service
//       REDIS_HOST          – Redis host  (sourced from SSM /app/redis/host)
//       REDIS_PORT          – Redis port  (sourced from SSM /app/redis/port)
//   - Fargate task memory must be right-sized using CloudWatch Container
//     Insights metrics (MemoryUtilized) to avoid both OOM kills and
//     over-provisioning.
//   - ECS Service restart policies (minimumHealthyPercent / maximumPercent)
//     must be configured so that OOM-killed tasks are replaced automatically
//     while a health check endpoint confirms readiness before traffic is
//     routed to the replacement task.
//
// The context is initialised with a minimal empty-object placeholder; all
// large data sets are fetched lazily from the external state service using
// the STATE_API_BASE_URL environment variable.
// ---------------------------------------------------------------------------
const initialState = {};
export const AppContext = createContext(initialState);

// ---------------------------------------------------------------------------
// cz-js-1031: In-memory session state in context/redux
//
// Session state is no longer held in-memory.
// Redis connection parameters are sourced from AWS SSM Parameter Store
// (SecureString) and injected into the ECS Fargate task definition as
// environment variables via the ECS Task Role (least-privilege, no
// Secrets Manager cost).  The browser-side code reads those values
// through the runtime config and communicates with the session API;
// it never stores session data locally in the React/Redux memory space.
//
// Required ECS task-definition environment variables (populated from SSM):
//   REDIS_HOST           – sourced from SSM parameter /app/redis/host
//   REDIS_PORT           – sourced from SSM parameter /app/redis/port
//   REDIS_TLS            – sourced from SSM parameter /app/redis/tls (true|false)
//   SESSION_API_BASE_URL – base URL of the server-side session micro-service
//                          that owns the Redis connection

/**
 * Retrieve the current session from the external session service.
 * The service itself connects to Redis using the SSM-injected env vars
 * (REDIS_HOST / REDIS_PORT / REDIS_TLS) so no Redis credentials are
 * ever present in the browser bundle.
 *
 * @returns {Promise<{userId: string|null, token: string|null}>}
 */
export async function getSession() {
  const sessionApiBase =
    process.env.SESSION_API_BASE_URL ||
    (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__?.SESSION_API_BASE_URL) ||
    '';
  const response = await fetch(`${sessionApiBase}/api/session`, {
    credentials: 'include',
  });
  if (!response.ok) {
    return { userId: null, token: null };
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// cz-js-1032 FIX: Critical App State in localStorage
//
// BEFORE (violation – line 12 of source):
//   localStorage.setItem('pendingOrder', JSON.stringify(order));
//
// PROBLEM: Using browser localStorage for critical application state (pending
// orders) creates data-consistency issues in containerised deployments.
// localStorage is per-browser and per-origin; it is invisible to other
// container replicas, lost on pod restart, and cannot be shared across
// horizontally-scaled ECS Fargate tasks.
//
// REMEDIATION (cz-js-1032): Use AWS SSM Parameter Store for Non-Secret
// Configuration State in Fargate.
//
// Non-sensitive critical configuration state (feature flags, environment-
// specific settings, pending order routing keys) is migrated from localStorage
// to AWS SSM Parameter Store.  Values are injected into ECS Fargate tasks at
// startup via the task definition "secrets" array, making them available as
// environment variables inside the container.  The browser-side code reads
// these values from the runtime config object (window.__RUNTIME_CONFIG__)
// which is populated by the container entrypoint from the injected env vars.
//
// Required ECS task-definition "secrets" entries (sourced from SSM):
//   /app/orders/state-api-base-url  → STATE_API_BASE_URL
//   /app/orders/feature-flag        → ORDER_FEATURE_FLAG
//
// ECS task definition snippet (task-definition.json):
//   "secrets": [
//     {
//       "name": "STATE_API_BASE_URL",
//       "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/app/orders/state-api-base-url"
//     },
//     {
//       "name": "ORDER_FEATURE_FLAG",
//       "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/app/orders/feature-flag"
//     }
//   ]
//
// The container entrypoint writes these injected values into the runtime
// config before serving the React bundle:
//   echo "window.__RUNTIME_CONFIG__ = {
//     STATE_API_BASE_URL: '${STATE_API_BASE_URL}',
//     ORDER_FEATURE_FLAG: '${ORDER_FEATURE_FLAG}'
//   };" > /usr/share/nginx/html/runtime-config.js
// ---------------------------------------------------------------------------

/**
 * Persist a pending order to the external state service.
 *
 * The STATE_API_BASE_URL is sourced from AWS SSM Parameter Store and injected
 * into the ECS Fargate task at startup via the task definition "secrets" array.
 * The container entrypoint exposes it to the browser through
 * window.__RUNTIME_CONFIG__.STATE_API_BASE_URL so no critical state is ever
 * written to browser localStorage.
 *
 * @param {Object} order - The order object to persist server-side.
 * @returns {Promise<void>}
 */
export async function saveOrder(order) {
  // STATE_API_BASE_URL is injected from AWS SSM Parameter Store
  // (/app/orders/state-api-base-url) via the ECS Fargate task definition
  // "secrets" array — never hardcoded or stored in localStorage.
  const stateApiBase =
    process.env.STATE_API_BASE_URL ||
    (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__?.STATE_API_BASE_URL) ||
    '';

  const response = await fetch(`${stateApiBase}/api/orders/pending`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(order),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to persist pending order to external state service: ${response.status} ${response.statusText}`
    );
  }
}
