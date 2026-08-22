// cz-js-1040 hardcoded port in Next.js server configuration
// PORT is injected by ECS Fargate via AWS Secrets Manager secrets injection
// (valueFrom referencing the secret ARN in the task definition).
// Falls back to 3000 for local development only.
const next = require('next');
const app = next({ dev: false });
app.prepare().then(() => {
  const server = require('http').createServer();
  const port = parseInt(process.env.PORT, 10) || 3000;  // resolved from ECS Fargate secrets injection
  server.listen(port);
});
