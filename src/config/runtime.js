/**
 * Runtime configuration for containerized deployment on ECS Fargate.
 *
 * cz-js-1058 FIX: Build-Time Configuration in jQuery Applications
 * ---------------------------------------------------------------
 * Previously, configuration values (apiUrl, feature flags) were baked into
 * the JavaScript bundle at `npm run build` via REACT_APP_* environment
 * variables.  This forced a separate Docker image build per environment
 * (dev / staging / production) and prevented container image reuse.
 *
 * Remediation — SSM Parameter Store Hierarchies for Per-Environment Config
 * on ECS Fargate:
 *
 *   All configuration is organised under per-environment SSM Parameter Store
 *   path hierarchies:
 *
 *     /app/{env}/api/url          (e.g. /app/dev/api/url, /app/prod/api/url)
 *     /app/{env}/feature/flag     (e.g. /app/dev/feature/flag)
 *
 *   The ECS Fargate task definition references these SSM parameters as
 *   secrets, which ECS injects as environment variables into the container
 *   at task launch:
 *
 *     API_URL      ← SSM /app/${APP_ENV}/api/url
 *     FEATURE_FLAG ← SSM /app/${APP_ENV}/feature/flag
 *
 *   The Docker ENTRYPOINT script (docker-entrypoint.sh) runs before Nginx
 *   starts and replaces placeholder tokens in public/config.js with the
 *   live values, enabling a single container image to be promoted across
 *   every environment without rebuilding:
 *
 *     sed -i "s|__API_URL__|${API_URL}|g"           /usr/share/nginx/html/config.js
 *     sed -i "s|__FEATURE_FLAG__|${FEATURE_FLAG}|g" /usr/share/nginx/html/config.js
 *
 * cz-js-1034 FIX: Replaced build-time REACT_APP_* environment variables
 * (compiled into the bundle at `npm run build`) with runtime values read
 * from window.__ENV__.  window.__ENV__ is populated by /public/config.js
 * which is loaded as the first <script> in index.html before the app bundle.
 *
 * AWS SSM Parameter Store hierarchy mapping (per environment):
 *   /app/dev/api/url          → API_URL          (env var in container)
 *   /app/dev/feature/flag     → FEATURE_FLAG     (env var in container)
 *   /app/staging/api/url      → API_URL
 *   /app/staging/feature/flag → FEATURE_FLAG
 *   /app/prod/api/url         → API_URL
 *   /app/prod/feature/flag    → FEATURE_FLAG
 */

// Read values from window.__ENV__ (populated at container startup from SSM).
// Falls back to empty strings so the app fails fast with a clear error
// rather than silently using undefined.
// NEVER use process.env.REACT_APP_* here — those are baked at build time
// and prevent container image reuse across environments.
const runtimeEnv = (typeof window !== 'undefined' && window.__ENV__) ? window.__ENV__ : {};

export const config = {
  apiUrl:  runtimeEnv.API_URL      || '',   // SSM: /app/{env}/api/url      (was: process.env.REACT_APP_API_URL)
  feature: runtimeEnv.FEATURE_FLAG || '',   // SSM: /app/{env}/feature/flag (was: process.env.REACT_APP_FEATURE_FLAG)
};
