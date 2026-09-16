/**
 * Runtime configuration injected at container startup.
 *
 * This file is served as a static asset and loaded as the FIRST <script>
 * in index.html BEFORE the React/jQuery bundle.  It must never be bundled
 * by webpack/CRA — keep it in /public so it is copied verbatim to the
 * build output directory.
 *
 * cz-js-1058 FIX: Build-Time Configuration in jQuery Applications
 * ---------------------------------------------------------------
 * Configuration values are no longer baked into the JavaScript bundle at
 * build time.  Instead, all values are stored in AWS SSM Parameter Store
 * under per-environment path hierarchies and injected into ECS Fargate
 * tasks at runtime, enabling a single container image to be promoted
 * across dev / staging / production without rebuilding.
 *
 * SSM Parameter Store hierarchy (per environment):
 * -------------------------------------------------
 *   /app/dev/api/url              → API_URL
 *   /app/dev/feature/flag         → FEATURE_FLAG
 *   /app/dev/backend/base-url     → BACKEND_BASE_URL
 *   /app/dev/local-api/base-url   → LOCAL_API_BASE_URL
 *   /app/dev/cors-proxy/url       → CORS_PROXY_URL
 *
 *   /app/staging/api/url          → API_URL
 *   /app/staging/feature/flag     → FEATURE_FLAG
 *   /app/staging/backend/base-url → BACKEND_BASE_URL
 *   ... (same keys, different values per environment)
 *
 *   /app/prod/api/url             → API_URL
 *   /app/prod/feature/flag        → FEATURE_FLAG
 *   /app/prod/backend/base-url    → BACKEND_BASE_URL
 *   ... (same keys, different values per environment)
 *
 * How values reach this file at runtime (ECS Fargate + AWS SSM):
 * ---------------------------------------------------------------
 * 1. AWS SSM Parameter Store holds the real values under per-environment
 *    path hierarchies (see above).
 *
 * 2. The ECS task definition references those parameters as secrets,
 *    which ECS injects as environment variables into the container:
 *      API_URL             ← SSM /app/${APP_ENV}/api/url
 *      FEATURE_FLAG        ← SSM /app/${APP_ENV}/feature/flag
 *      BACKEND_BASE_URL    ← SSM /app/${APP_ENV}/backend/base-url
 *      LOCAL_API_BASE_URL  ← SSM /app/${APP_ENV}/local-api/base-url
 *      CORS_PROXY_URL      ← SSM /app/${APP_ENV}/cors-proxy/url
 *
 * 3. The Docker ENTRYPOINT script runs before Nginx starts and replaces
 *    the placeholder tokens below with the live environment-variable values:
 *
 *      #!/bin/sh
 *      sed -i "s|__API_URL__|${API_URL}|g"                       /usr/share/nginx/html/config.js
 *      sed -i "s|__FEATURE_FLAG__|${FEATURE_FLAG}|g"             /usr/share/nginx/html/config.js
 *      sed -i "s|__BACKEND_BASE_URL__|${BACKEND_BASE_URL}|g"     /usr/share/nginx/html/config.js
 *      sed -i "s|__LOCAL_API_BASE_URL__|${LOCAL_API_BASE_URL}|g" /usr/share/nginx/html/config.js
 *      sed -i "s|__CORS_PROXY_URL__|${CORS_PROXY_URL}|g"         /usr/share/nginx/html/config.js
 *      exec nginx -g "daemon off;"
 *
 * The placeholder tokens (__API_URL__, __FEATURE_FLAG__, etc.) are
 * intentionally distinct from shell syntax so they survive multi-stage
 * Docker COPY steps without accidental expansion.
 *
 * cz-js-1034 FIX: All configuration values are now supplied at runtime via
 * ECS Fargate secrets injection from AWS SSM Parameter Store.  No
 * REACT_APP_* build-time variables are used, enabling a single container
 * image to be deployed across every environment without rebuilding.
 *
 * cz-js-1003 FIX: BACKEND_BASE_URL and LOCAL_API_BASE_URL are stored in
 * AWS SSM Parameter Store and injected into the ECS Fargate task definition
 * as secrets.  The entrypoint script replaces the placeholder tokens below.
 *
 * cz-js-1030 FIX: CORS_PROXY_URL is stored in AWS SSM Parameter Store and
 * injected into the ECS Fargate task definition as a secret.
 */
window.__ENV__ = {
  API_URL:            '__API_URL__',            // SSM: /app/{env}/api/url
  FEATURE_FLAG:       '__FEATURE_FLAG__',       // SSM: /app/{env}/feature/flag
  BACKEND_BASE_URL:   '__BACKEND_BASE_URL__',   // SSM: /app/{env}/backend/base-url
  LOCAL_API_BASE_URL: '__LOCAL_API_BASE_URL__', // SSM: /app/{env}/local-api/base-url
  CORS_PROXY_URL:     '__CORS_PROXY_URL__',     // SSM: /app/{env}/cors-proxy/url
};
