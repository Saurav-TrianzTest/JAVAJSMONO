// cz-js-1040 port resolved from environment variable (injected via AWS Secrets Manager / ECS Fargate task secrets)
const next = require('next');
const app = next({ dev: false });
app.prepare().then(() => {
  const server = require('http').createServer();
  const port = process.env.PORT || 3000;  // PORT injected by ECS Fargate via AWS Secrets Manager
  server.listen(port);
});
