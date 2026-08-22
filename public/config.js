// =============================================================================
// cz-js-1058 FIX: Runtime configuration via AWS SSM Parameter Store
//              hierarchies injected by ECS Fargate at container startup.
//
// This file is GENERATED at container startup by docker-entrypoint.sh.
// DO NOT edit manually — it is overwritten on every container start.
//
// Values are sourced from AWS SSM Parameter Store path hierarchies:
//   /app/<environment>/api-url       → API_URL
//   /app/<environment>/feature-flag  → FEATURE_FLAG
//
// ECS Fargate injects these as environment variables via the task definition
// "secrets" array (valueFrom referencing SSM parameter ARNs).
// docker-entrypoint.sh then writes them into this file so the browser-side
// bundle can read them at runtime without any build-time baking.
// =============================================================================
// cz-js-1042 runtime configuration via window.__ENV__
// cz-js-1011 SSR error boundary: guard window access with platform detection
// Prevents ECS Fargate / Kubernetes SSR pod crashes when Angular Universal
// renders this script on the server where `window` is not defined.
(function () {
  // Only assign window.__ENV__ in a browser execution context.
  // During Angular Universal SSR the `window` global does not exist;
  // accessing it without a guard causes a ReferenceError that crashes the
  // Node.js server process / container pod.
  if (typeof window !== 'undefined') {
    window.__ENV__ = {
      API_URL:      '${API_URL}',      // injected from SSM /app/<env>/api-url
      FEATURE_FLAG: '${FEATURE_FLAG}', // injected from SSM /app/<env>/feature-flag
    };
  }
})();
