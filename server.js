// cz-js-1040 hardcoded port in Next.js server configuration
const next = require('next');
const app = next({ dev: false });
app.prepare().then(() => {
  const server = require('http').createServer();
  const port = process.env.PORT || 3000;  // PORT injected via ECS Fargate secrets / task definition
  server.listen(port);  // port resolved from environment variable (AWS Secrets Manager via ECS Fargate)
});
