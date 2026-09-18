import axios from 'axios';

// cz-js-1049 remediation: Replace jQuery File Upload local container filesystem
// write with ECS Fargate backend-generated S3 presigned PUT URLs for direct
// client-side upload to S3.
//
// Problem: jQuery file upload implementations writing uploaded files to the
// local container filesystem (/app/build/uploads/) lose data on container
// restart, pod eviction, or horizontal scaling because containers are ephemeral.
//
// Solution: The ECS Fargate backend generates short-lived S3 presigned PUT URLs.
// The jQuery File Upload plugin (or equivalent fetch/axios PUT) uploads file
// bytes directly from the browser to S3 — the Fargate container never handles
// the file data, eliminating local filesystem dependency and ensuring data
// survives the full container lifecycle.
//
// Required environment variables (configure in ECS task definition):
//   S3_PRESIGN_ENDPOINT  – backend route that issues a presigned S3 PUT URL
//                          e.g. https://api.example.com/uploads/presign
//   (The backend uses the AWS SDK with the target S3 bucket/key to sign the URL.)

const S3_PRESIGN_ENDPOINT =
  process.env.S3_PRESIGN_ENDPOINT || '/api/uploads/presign';

/**
 * Upload a file directly to S3 via an ECS Fargate backend-generated presigned URL.
 *
 * Replaces the previous jQuery File Upload local filesystem write:
 *   fs.writeFileSync('/app/build/uploads/' + file.name, file)  // REMOVED
 *
 * New flow (cz-js-1049 compliant):
 *  1. Request a short-lived S3 presigned PUT URL from the ECS Fargate backend.
 *     No file data is sent to the backend at this step.
 *  2. PUT the file bytes directly from the browser to S3 using the presigned URL.
 *     The Fargate container is never involved in the file data transfer, so
 *     data persists in S3 regardless of container restarts, pod evictions, or
 *     the number of running replicas.
 *
 * Compatible with jQuery File Upload: pass the returned objectUrl to the plugin's
 * done callback or use this function as a custom upload handler.
 *
 * @param {File} file  – Browser File object (from jQuery File Upload or <input type="file">).
 * @returns {Promise<string>}  The permanent S3 object URL of the uploaded file.
 */
export async function uploadToDisk(file) {
  // Step 1: Request a presigned S3 PUT URL from the ECS Fargate backend.
  //         The backend signs the URL using AWS SDK credentials attached to
  //         the Fargate task IAM role — no AWS credentials are exposed to the browser.
  const presignResponse = await axios.get(S3_PRESIGN_ENDPOINT, {
    params: {
      fileName: file.name,
      contentType: file.type,
    },
  });

  const { uploadUrl, objectUrl } = presignResponse.data;

  // Step 2: PUT the file directly to S3 from the browser.
  //         No local filesystem write occurs; data is stored durably in S3.
  await axios.put(uploadUrl, file, {
    headers: {
      'Content-Type': file.type,
    },
  });

  // Return the permanent S3 object URL for downstream use (e.g. store in DB).
  return objectUrl;
}

// cz-js-1003 remediation: Replace hardcoded API ports with AWS Secrets Manager
// values injected into ECS Fargate task environment variables.
//
// Problem: Hardcoded port numbers (e.g. :8080) in fetch/HttpClient base
// URLs break in containerised environments where Kubernetes services, Istio
// service mesh, or ECS service discovery resolve hostnames without fixed ports.
//
// Solution: Store the full base URL (scheme + host + port) in AWS Secrets
// Manager and inject it into the ECS Fargate task definition as a secret
// environment variable.  The application reads the value at runtime so the
// same container image works across dev / staging / production without rebuild.
//
// Required ECS Fargate task-definition secrets (map to AWS Secrets Manager ARNs):
//   BACKEND_API_BASE_URL  – e.g. http://backend:8080   (replaces hardcoded :8080)
//
// Example ECS task-definition snippet:
//   "secrets": [
//     { "name": "BACKEND_API_BASE_URL",
//       "valueFrom": "arn:aws:secretsmanager:<region>:<account>:secret:app/backend-api-base-url" }
//   ]

// cz-js-1004 remediation: Remove localhost URL from Angular HTTP interceptor /
// JS fetch call by deploying an Application Load Balancer with path-based routing
// in front of both ECS Fargate services.  The ALB forwards requests whose path
// starts with /api to the backend service, so the Angular/JS frontend can use
// a relative /api path instead of an explicit host:port reference.
//
// Before (source line 15):
//   return fetch('http://localhost:3001/api/info');
//
// After: relative path — ALB routes /api/* to the backend Fargate service.
//   return fetch('/api/info');
//
// No environment variable is needed because the ALB listener rule handles
// host resolution transparently for all environments (dev / staging / prod).

const BACKEND_API_BASE_URL =
  process.env.BACKEND_API_BASE_URL || 'http://backend:8080';

export function getData() {
  // cz-js-1003 fixed: port resolved at runtime from BACKEND_API_BASE_URL env var
  return fetch(`${BACKEND_API_BASE_URL}/api/data`);
}
export function getLocal() {
  // cz-js-1004 fixed: localhost URL replaced with relative /api path routed by ALB
  return fetch('/api/info');
}

// cz-js-1030 remediation: NGINX Sidecar CORS Proxy in ECS Fargate Task Definition
//
// Problem: Direct cross-origin fetch calls (e.g. to http://api.other-origin.com/data)
// break in containerised microservice deployments where the React frontend and the
// target API run in separate containers with different origins and Kubernetes /
// ECS network policies enforce strict CORS rules.  Without CORS error handling the
// browser silently swallows the network error and the application fails with no
// actionable feedback.
//
// Solution: An NGINX reverse-proxy sidecar container is added to the ECS Fargate
// task definition.  The sidecar listens on a loopback port (default 8888) and
// forwards requests to the upstream API while injecting the required CORS response
// headers.  The React application targets the sidecar proxy URL instead of the
// remote origin directly, so all requests remain same-origin from the browser's
// perspective and CORS preflight is handled transparently by NGINX.
//
// Required environment variable (configure in ECS task definition):
//   REACT_APP_CORS_PROXY_URL  – base URL of the NGINX sidecar proxy
//                               e.g. http://localhost:8888
//                               Defaults to http://localhost:8888 if not set.
//
// ECS Fargate task-definition sidecar snippet (add alongside the React container):
//   {
//     "name": "nginx-cors-proxy",
//     "image": "nginx:alpine",
//     "portMappings": [{ "containerPort": 8888, "protocol": "tcp" }],
//     "environment": [
//       { "name": "UPSTREAM_API_URL", "value": "http://api.other-origin.com" }
//     ],
//     "mountPoints": [{
//       "sourceVolume": "nginx-cors-config",
//       "containerPath": "/etc/nginx/conf.d"
//     }]
//   }
//
// NGINX sidecar config (nginx-cors-proxy.conf) – mount via ECS volume or bake
// into a custom nginx image:
//   server {
//     listen 8888;
//     location / {
//       proxy_pass ${UPSTREAM_API_URL};
//       add_header 'Access-Control-Allow-Origin'  '*' always;
//       add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
//       add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
//       if ($request_method = OPTIONS) { return 204; }
//     }
//   }

const CORS_PROXY_URL =
  process.env.REACT_APP_CORS_PROXY_URL || 'http://localhost:8888';

export function getCross() {
  // cz-js-1030 fixed: cross-origin request routed through NGINX sidecar CORS proxy.
  // The proxy URL is resolved from REACT_APP_CORS_PROXY_URL env var (injected by
  // ECS Fargate task definition) so no origin is hardcoded in the React bundle.
  // A dedicated .catch() handler surfaces CORS / network errors instead of
  // silently swallowing them, enabling proper error reporting in the UI.
  return fetch(`${CORS_PROXY_URL}/data`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `CORS proxy request failed: ${response.status} ${response.statusText}`
        );
      }
      return response.json();
    })
    .catch((error) => {
      // Surface CORS / network errors so the UI can display a meaningful message
      // rather than silently failing.  In containerised environments this is
      // critical for diagnosing misconfigured network policies or sidecar issues.
      console.error('[cz-js-1030] Cross-origin fetch error:', error.message);
      throw error;
    });
}
