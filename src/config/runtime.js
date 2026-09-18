/**
 * cz-js-1058 FIX: Build-Time Configuration in jQuery Applications
 *
 * REMEDIATION: SSM Parameter Store Hierarchies for Per-Environment Config on ECS Fargate
 *
 * All jQuery/React application configuration is organised under SSM Parameter
 * Store path hierarchies per environment and injected into ECS Fargate tasks,
 * replacing per-environment Docker image builds.
 *
 * SSM Parameter Store path hierarchy (per environment):
 *   /app/{env}/config/api-url          → window.__ENV__.API_URL
 *   /app/{env}/config/feature-flag     → window.__ENV__.FEATURE_FLAG
 *
 * Example paths:
 *   /app/dev/config/api-url
 *   /app/staging/config/api-url
 *   /app/production/config/api-url
 *
 * ECS Fargate Task Definition (secrets section) — values resolved from SSM
 * Parameter Store at task launch and injected as environment variables:
 *
 *   "secrets": [
 *     {
 *       "name": "API_URL",
 *       "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/app/<env>/config/api-url"
 *     },
 *     {
 *       "name": "FEATURE_FLAG",
 *       "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/app/<env>/config/feature-flag"
 *     }
 *   ]
 *
 * The ECS Fargate entrypoint script (docker-entrypoint.sh) reads these
 * environment variables and writes them into /usr/share/nginx/html/config.js
 * as window.__ENV__ before the application bundle loads in the browser.
 *
 * The SAME container image is promoted across dev / staging / production
 * without rebuilding — only the ECS Task Definition secrets references
 * (pointing to the appropriate SSM path hierarchy) differ per environment.
 *
 * NO build-time REACT_APP_* / jQuery compile-time variables are used.
 */

// Runtime configuration sourced from window.__ENV__, which is populated at
// ECS Fargate task startup via SSM Parameter Store hierarchy injection.
// Falls back to an empty object during local development (set env vars locally).
const runtimeEnv = (typeof window !== 'undefined' && window.__ENV__) || {};

export const config = {
  // Resolved at runtime from SSM path: /app/{env}/config/api-url
  apiUrl: runtimeEnv.API_URL,

  // Resolved at runtime from SSM path: /app/{env}/config/feature-flag
  feature: runtimeEnv.FEATURE_FLAG,
};
