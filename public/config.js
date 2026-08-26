// cz-js-1042 runtime configuration via window.__ENV__
// cz-js-1011 FIX: Added platform detection for SSR compatibility
if (typeof window !== 'undefined') {
  window.__ENV__ = {
    API_URL: '${API_URL}',  // injected at container startup
  };
} else {
  // Server-side rendering fallback - export config for Node.js environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      API_URL: process.env.API_URL || '${API_URL}'
    };
  }
}
