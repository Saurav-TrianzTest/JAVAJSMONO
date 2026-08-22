// =============================================================================
// cz-js-1058 FIX: Build-Time Configuration in jQuery Applications
//
// BEFORE (violation – Line 3):
//   export const config = {
//     apiUrl: process.env.REACT_APP_API_URL,   // baked at build time
//     feature: process.env.REACT_APP_FEATURE_FLAG,
//   };
//
// PROBLEM:
//   REACT_APP_* variables are compiled into the JavaScript bundle at webpack/
//   gulp build time.  This means a separate Docker image must be built for
//   every environment (dev / staging / production), preventing image reuse
//   and violating the "build once, deploy anywhere" containerization principle
//   required for ECS Fargate.
//
// REMEDIATION APPLIED — SSM Parameter Store Hierarchies for Per-Environment
// Config on ECS Fargate:
//
//   All jQuery/React application configuration is organised under AWS SSM
//   Parameter Store path hierarchies per environment:
//
//     /app/<environment>/api-url          → API_URL
//     /app/<environment>/feature-flag     → FEATURE_FLAG
//
//   At ECS Fargate task launch, the task definition references these SSM
//   parameters via the "secrets" array, which causes ECS to inject them as
//   environment variables into the container before the entrypoint runs.
//   The docker-entrypoint.sh script then writes these values into
//   /usr/share/nginx/html/config.js (window.__ENV__) so the browser-side
//   bundle can read them at runtime — with NO build-time baking.
//
//   This allows a single immutable Docker image to be promoted across
//   dev → staging → production by simply pointing the ECS task definition
//   at the appropriate SSM parameter hierarchy for each environment.
//
// ECS Fargate task definition snippet (reference — not part of this file):
//   "secrets": [
//     {
//       "name": "API_URL",
//       "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/app/production/api-url"
//     },
//     {
//       "name": "FEATURE_FLAG",
//       "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/app/production/feature-flag"
//     }
//   ]
//
//   For staging, swap the SSM paths to /app/staging/api-url etc. — the image
//   itself is never rebuilt.
//
// SSM Parameter Store hierarchy layout:
//   /app/dev/api-url
//   /app/dev/feature-flag
//   /app/staging/api-url
//   /app/staging/feature-flag
//   /app/production/api-url
//   /app/production/feature-flag
//
// The docker-entrypoint.sh generates config.js at container startup:
//   window.__ENV__ = {
//     API_URL:      "${API_URL}",      // injected from SSM by ECS Fargate
//     FEATURE_FLAG: "${FEATURE_FLAG}"  // injected from SSM by ECS Fargate
//   };
// =============================================================================

/**
 * Resolve the runtime environment object.
 *
 * Browser context  : window.__ENV__ is populated by docker-entrypoint.sh
 *                    using values injected from AWS SSM Parameter Store by
 *                    the ECS Fargate task definition at container startup.
 *
 * SSR / Node context: process.env values are injected directly by ECS Fargate
 *                    from the task definition secrets array (SSM Parameter
 *                    Store references).
 *
 * cz-js-1058 remediation: NO build-time REACT_APP_* variables are used.
 * All values arrive at runtime via SSM Parameter Store → ECS Fargate secrets
 * injection → window.__ENV__ (browser) or process.env (SSR/Node).
 */
const _env =
  (typeof window !== 'undefined' && window.__ENV__)
    ? window.__ENV__
    : (typeof process !== 'undefined' ? process.env : {});

/**
 * Application runtime configuration.
 *
 * Values are sourced exclusively from AWS SSM Parameter Store hierarchies
 * injected by ECS Fargate at container startup — never baked into the bundle.
 *
 * SSM Parameter Store paths (per environment):
 *   /app/<env>/api-url       → API_URL       → config.apiUrl
 *   /app/<env>/feature-flag  → FEATURE_FLAG  → config.feature
 *
 * cz-js-1058 remediation: replaces build-time process.env.REACT_APP_API_URL
 * and process.env.REACT_APP_FEATURE_FLAG with runtime window.__ENV__ values
 * sourced from SSM Parameter Store via ECS Fargate secrets injection.
 */
export const config = {
  // Sourced from SSM Parameter Store path /app/<env>/api-url
  // Injected by ECS Fargate task definition secrets array as API_URL
  // Written into window.__ENV__.API_URL by docker-entrypoint.sh at startup
  apiUrl: _env.API_URL || '',

  // Sourced from SSM Parameter Store path /app/<env>/feature-flag
  // Injected by ECS Fargate task definition secrets array as FEATURE_FLAG
  // Written into window.__ENV__.FEATURE_FLAG by docker-entrypoint.sh at startup
  feature: _env.FEATURE_FLAG || '',
};
