#!/bin/sh
# =============================================================================
# docker-entrypoint.sh
#
# ECS Fargate runtime config injection via Secrets Manager / SSM Parameter Store.
#
# At ECS task launch the task definition maps Secrets Manager / SSM SecureString
# parameters to the environment variables listed below.  This script writes
# those values into public/config.js (window.__ENV__) BEFORE nginx starts,
# so the React/Angular bundle reads live values without being rebuilt.
#
# Required ECS task-definition environment variables (sourced from Secrets Manager):
#   API_URL       ← /app/config/api_url
#   FEATURE_FLAG  ← /app/config/feature_flag
# =============================================================================

set -e

CONFIG_FILE="/usr/share/nginx/html/config.js"

echo "Injecting runtime configuration from ECS Fargate Secrets Manager..."

cat > "${CONFIG_FILE}" <<EOF
// Runtime configuration injected by ECS Fargate at container startup.
// Values are sourced from AWS Secrets Manager / SSM Parameter Store.
// Do NOT hardcode environment-specific values here.
window.__ENV__ = {
  API_URL: "${API_URL:-}",
  FEATURE_FLAG: "${FEATURE_FLAG:-}"
};
EOF

echo "Runtime configuration written to ${CONFIG_FILE}"

# Hand off to the CMD (nginx)
exec "$@"
