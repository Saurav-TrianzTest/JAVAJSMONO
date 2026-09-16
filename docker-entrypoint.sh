#!/bin/sh
# =============================================================================
# docker-entrypoint.sh
#
# cz-js-1058 FIX: Build-Time Configuration in jQuery Applications
# ---------------------------------------------------------------
# Replaces placeholder tokens in /usr/share/nginx/html/config.js with
# runtime values injected by ECS Fargate from AWS SSM Parameter Store
# per-environment path hierarchies.
#
# This script enables a single container image to be promoted across
# dev / staging / production without rebuilding — the image is environment-
# agnostic; only the SSM parameter values differ per environment.
#
# AWS SSM Parameter Store hierarchy (per environment):
# ----------------------------------------------------
#   /app/dev/api/url              → API_URL
#   /app/dev/feature/flag         → FEATURE_FLAG
#   /app/dev/backend/base-url     → BACKEND_BASE_URL
#   /app/dev/local-api/base-url   → LOCAL_API_BASE_URL
#   /app/dev/cors-proxy/url       → CORS_PROXY_URL
#
#   /app/staging/api/url          → API_URL
#   /app/staging/feature/flag     → FEATURE_FLAG
#   ... (same keys, different values per environment)
#
#   /app/prod/api/url             → API_URL
#   /app/prod/feature/flag        → FEATURE_FLAG
#   ... (same keys, different values per environment)
#
# ECS task definition must declare the following secrets (sourced from
# AWS SSM Parameter Store using the per-environment hierarchy above) so
# they arrive as environment variables in the container:
#
#   API_URL             ← SSM /app/${APP_ENV}/api/url
#   FEATURE_FLAG        ← SSM /app/${APP_ENV}/feature/flag
#   BACKEND_BASE_URL    ← SSM /app/${APP_ENV}/backend/base-url
#   LOCAL_API_BASE_URL  ← SSM /app/${APP_ENV}/local-api/base-url
#   CORS_PROXY_URL      ← SSM /app/${APP_ENV}/cors-proxy/url
#
# The placeholder tokens (__API_URL__, __FEATURE_FLAG__, etc.) are written
# into public/config.js at build time and replaced here at container start,
# enabling a single image to serve every environment without rebuilding.
# =============================================================================

set -e

CONFIG_FILE="/usr/share/nginx/html/config.js"

# Replace each placeholder token with the corresponding environment variable.
# Values are sourced from AWS SSM Parameter Store per-environment hierarchies
# and injected by ECS Fargate at task launch.
# Fall back to an empty string if the variable is not set so Nginx still starts.
sed -i "s|__API_URL__|${API_URL:-}|g"                       "$CONFIG_FILE"
sed -i "s|__FEATURE_FLAG__|${FEATURE_FLAG:-}|g"             "$CONFIG_FILE"
sed -i "s|__BACKEND_BASE_URL__|${BACKEND_BASE_URL:-}|g"     "$CONFIG_FILE"
sed -i "s|__LOCAL_API_BASE_URL__|${LOCAL_API_BASE_URL:-}|g" "$CONFIG_FILE"
sed -i "s|__CORS_PROXY_URL__|${CORS_PROXY_URL:-}|g"         "$CONFIG_FILE"

echo "Runtime config injected into $CONFIG_FILE from SSM Parameter Store (env: ${APP_ENV:-unknown})"

# Hand off to the CMD (nginx -g 'daemon off;')
exec "$@"
