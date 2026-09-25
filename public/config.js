/**
 * public/config.js — Runtime configuration template.
 *
 * This file is OVERWRITTEN at container startup by docker-entrypoint.sh
 * using environment variables injected by ECS Fargate from AWS SSM Parameter
 * Store SecureString parameters.  The placeholder values below are replaced
 * with live values before nginx serves the static bundle.
 *
 * SSM Parameter Store hierarchy:
 *   /app/<env>/config/api_url       → ECS env var: API_URL
 *   /app/<env>/config/feature_flag  → ECS env var: FEATURE_FLAG
 *
 * Do NOT hardcode environment-specific values in this file.
 */
window.__ENV__ = {
  API_URL: '${API_URL}',        // injected at container startup from SSM
  FEATURE_FLAG: '${FEATURE_FLAG}' // injected at container startup from SSM
};
