// cz-js-1040 hardcoded port in Next.js server configuration
const next = require('next');
const app = next({ dev: false });
app.prepare().then(() => {
  const server = require('http').createServer();
  server.listen(3000);  // hardcoded port
});
