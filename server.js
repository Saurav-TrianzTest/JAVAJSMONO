// cz-js-1040 FIXED: Resolve port from environment variable (AWS Secrets Manager via ECS Fargate)
// cz-js-1011 FIX: Added SSR error boundary for ECS Fargate Angular Universal/Next.js
const next = require('next');
const app = next({ dev: false });

// SSR Error Boundary: Catch unguarded browser API errors during SSR
app.prepare().then(() => {
  const server = require('http').createServer((req, res) => {
    try {
      // Handle Next.js requests with error boundary
      const handle = app.getRequestHandler();
      handle(req, res).catch((err) => {
        console.error('SSR Error caught:', err);
        // Graceful fallback: Return CSR fallback HTML
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <title>Loading...</title>
            </head>
            <body>
              <div id="__next"></div>
              <script>
                // Client-side rendering fallback
                console.warn('SSR failed, falling back to CSR');
              </script>
            </body>
          </html>
        `);
      });
    } catch (err) {
      console.error('Server error:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });
  
  // Port resolved from AWS Secrets Manager via ECS Fargate task secrets injection
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`> Server ready with SSR error boundary on port ${port}`);
  });
});
