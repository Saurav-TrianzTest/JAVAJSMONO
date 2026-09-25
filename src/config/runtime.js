/**
 * runtime.js — Runtime configuration for ECS Fargate / Kubernetes deployments.
 *
 * REMEDIATION: cz-js-1058 — Build-Time Configuration in jQuery Applications
 * ─────────────────────────────────────────────────────────────────────────────
 * BEFORE (build-time, non-portable):
 *   export const config = {
 *     apiUrl: process.env.REACT_APP_API_URL,   // baked at build time
 *     feature: process.env.REACT_APP_FEATURE_FLAG,
 *   };
 *
 * AFTER (runtime, image-portable):
 *   Values are sourced from window.__ENV__ which is written by the container
 *   entrypoint at startup using environment variables injected by ECS Fargate
 *   from AWS SSM Parameter Store SecureString parameters.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SSM Parameter Store hierarchy (per-environment):
 *   /app/<env>/config/api_url          → ECS env var: API_URL
 *   /app/<env>/config/feature_flag     → ECS env var: FEATURE_FLAG
 *
 * ECS Fargate task-definition secrets block (example):
 *   "secrets": [
 *     { "name": "API_URL",      "valueFrom": "arn:aws:ssm:<region>:<acct>:parameter/app/prod/config/api_url" },
 *     { "name": "FEATURE_FLAG", "valueFrom": "arn:aws:ssm:<region>:<acct>:parameter/app/prod/config/feature_flag" }
 *   ]
 *
 * Container entrypoint writes public/config.js before nginx starts:
 *   echo "window.__ENV__ = { API_URL: '${API_URL}', FEATURE_FLAG: '${FEATURE_FLAG}' };" \
 *     > /usr/share/nginx/html/config.js
 *
 * This pattern enables a SINGLE container image to be promoted across all
 * environments (dev → staging → prod) without rebuilding — satisfying the
 * ECS Fargate image-portability requirement.
 */

// Read runtime values injected by ECS Fargate via SSM Parameter Store secrets.
// window.__ENV__ is populated by docker-entrypoint.sh at container startup.
// Falls back to empty string so the application fails fast with a clear error
// rather than silently consuming undefined build-time values.
const runtimeEnv =
  (typeof window !== 'undefined' && window.__ENV__) || {};

export const config = {
  /** Sourced from SSM: /app/<env>/config/api_url → ECS env var API_URL */
  apiUrl: runtimeEnv.API_URL || '',

  /** Sourced from SSM: /app/<env>/config/feature_flag → ECS env var FEATURE_FLAG */
  feature: runtimeEnv.FEATURE_FLAG || '',
};
