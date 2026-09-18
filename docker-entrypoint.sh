#!/bin/sh
# =============================================================================
# docker-entrypoint.sh
#
# ECS Fargate runtime environment injection via Secrets Manager / SSM.
#
# At ECS task launch, the Task Definition injects secrets as environment
# variables (e.g. API_URL, FEATURE_FLAG).  This script substitutes those
# values into the config.js template so that window.__ENV__ is populated
# before the Angular/React bundle executes in the browser.
#
# ECS Task Definition snippet (secrets section):
#   "secrets": [
#     {
#       "name": "API_URL",
#       "valueFrom": "arn:aws:secretsmanager:<region>:<account>:secret:<name>:API_URL::"
#     },
#     {
#       "name": "FEATURE_FLAG",
#       "valueFrom": "arn:aws:secretsmanager:<region>:<account>:secret:<name>:FEATURE_FLAG::"
#     }
#   ]
#
# The same container image is reused across dev / staging / production;
# only the Task Definition secrets references differ per environment.
# =============================================================================

set -e

CONFIG_FILE="/usr/share/nginx/html/config.js"

echo "Injecting runtime environment configuration from ECS Fargate secrets..."

# Use envsubst to replace ${API_URL}, ${FEATURE_FLAG}, etc. in config.js
# with the values supplied by ECS Fargate Secrets Manager injection.
if [ -f "$CONFIG_FILE" ]; then
  envsubst < "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
  echo "Runtime config.js updated successfully."
else
  # Generate a minimal config.js if the template was not copied
  cat > "$CONFIG_FILE" <<EOF
// Runtime configuration injected by ECS Fargate Secrets Manager
window.__ENV__ = {
  API_URL:      "${API_URL:-}",
  FEATURE_FLAG: "${FEATURE_FLAG:-false}"
};
EOF
  echo "Runtime config.js generated from environment variables."
fi

echo "Starting nginx..."
exec "$@"
