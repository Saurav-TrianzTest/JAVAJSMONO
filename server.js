// cz-js-1040 hardcoded port in Next.js server configuration
const next = require('next');
const app = next({ dev: false });
// PORT is injected by ECS Fargate via AWS Secrets Manager secrets injection
// (configured in the ECS Task Definition secretsmanager ARN for PORT).
// Falls back to 3000 for local development only.
const PORT = parseInt(process.env.PORT, 10) || 3000;
app.prepare().then(() => {
  const server = require('http').createServer();
  server.listen(PORT);  // port resolved from environment variable (AWS Secrets Manager via ECS Fargate)
});
