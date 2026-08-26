// cz-js-1058 FIXED: Runtime configuration via AWS SSM Parameter Store for ECS Fargate
// Configuration is now loaded at runtime from environment variables injected by ECS task definition
// SSM Parameter Store hierarchies: /react-nextjs/{environment}/{parameter}
// Example: /react-nextjs/production/api-url, /react-nextjs/staging/api-url

// Runtime configuration loader - reads from environment variables injected at container startup
const getRuntimeConfig = () => {
  // Check if running in browser (client-side)
  if (typeof window !== 'undefined') {
    // Browser: Use window.__ENV__ injected at container startup
    return {
      apiUrl: window.__ENV__?.API_URL || '',
      feature: window.__ENV__?.FEATURE_FLAG || 'false',
    };
  }
  
  // Server-side (Node.js): Use process.env from ECS task environment
  return {
    apiUrl: process.env.API_URL || '',
    feature: process.env.FEATURE_FLAG || 'false',
  };
};

// Export runtime configuration - no build-time baking
export const config = getRuntimeConfig();

// For SSR compatibility: Re-export as function to ensure fresh reads
export const getConfig = getRuntimeConfig;
