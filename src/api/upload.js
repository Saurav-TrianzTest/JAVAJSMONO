import axios from 'axios';

// cz-js-1049 remediation: replaced jQuery File Upload writing to the local
// container filesystem with an S3 presigned PUT URL workflow.
//
// WHY: Containers are ephemeral – any file written to the local filesystem
// (e.g. /app/build/uploads/) is lost on container restart, pod eviction, or
// when multiple ECS Fargate replicas are running.  The jQuery File Upload
// plugin must never route file bytes through the Fargate task; instead the
// ECS Fargate backend generates a short-lived S3 presigned PUT URL and the
// browser uploads the file directly to S3.
//
// HOW (ECS Fargate backend side – environment variables required in the task
// definition):
//   S3_BUCKET_NAME  – target S3 bucket for uploaded files
//   AWS_REGION      – AWS region where the bucket lives
//   PRESIGNED_URL_EXPIRY_SECONDS – (optional) URL TTL, defaults to 300 s
//
// HOW (frontend / jQuery File Upload side):
//   1. Call getS3PresignedUploadUrl() to obtain { uploadUrl, fileKey } from
//      the backend endpoint /api/s3/presigned-upload.
//   2. Pass uploadUrl as the `url` option to jQuery File Upload so the plugin
//      sends the PUT request directly to S3 – no file data traverses the
//      Fargate container.
//   3. Store / reference fileKey for subsequent application use.

/**
 * Requests a short-lived S3 presigned PUT URL from the ECS Fargate backend.
 *
 * The backend reads S3_BUCKET_NAME and AWS_REGION from its ECS task-definition
 * environment variables and returns a presigned URL valid for
 * PRESIGNED_URL_EXPIRY_SECONDS seconds (default 300).
 *
 * @param {File} file - The File object selected by the user.
 * @returns {Promise<{uploadUrl: string, fileKey: string}>}
 */
export async function getS3PresignedUploadUrl(file) {
  const apiBase = process.env.REACT_APP_API_BASE_URL || '';
  const response = await axios.post(
    `${apiBase}/api/s3/presigned-upload`,
    {
      fileName: file.name,
      contentType: file.type,
    }
  );
  // Backend returns { uploadUrl: '<presigned-S3-PUT-URL>', fileKey: '<object-key>' }
  return response.data;
}

/**
 * Uploads a file directly from the browser to S3 using a presigned PUT URL.
 *
 * This function is the drop-in replacement for any jQuery File Upload handler
 * that previously wrote files to the local container filesystem.  File bytes
 * never pass through the ECS Fargate task, ensuring data persists across
 * container restarts, pod evictions, and horizontal scaling.
 *
 * Usage with jQuery File Upload:
 *   const { uploadUrl, fileKey } = await getS3PresignedUploadUrl(file);
 *   $('#fileupload').fileupload({
 *     url: uploadUrl,
 *     type: 'PUT',
 *     ...
 *   });
 *
 * @param {File} file - The File object to upload.
 * @returns {Promise<string>} Resolves with the S3 object key (fileKey).
 */
export async function uploadToS3(file) {
  // Step 1 – obtain a presigned S3 PUT URL from the ECS Fargate backend.
  // The backend uses S3_BUCKET_NAME and AWS_REGION env vars from the task
  // definition; no AWS credentials are embedded in the frontend code.
  const { uploadUrl, fileKey } = await getS3PresignedUploadUrl(file);

  // Step 2 – upload the file directly from the browser to S3.
  // The PUT request goes straight to S3; the Fargate container filesystem is
  // never written to, so data survives container restarts and scaling events.
  await axios.put(uploadUrl, file, {
    headers: {
      'Content-Type': file.type,
    },
  });

  // Return the S3 object key so callers can reference the uploaded file.
  return fileKey;
}

// ---------------------------------------------------------------------------
// Legacy alias kept for backward compatibility.
// Previously this function wrote files to the local container filesystem via
// fs.writeFileSync('/app/build/uploads/' + file.name, file) which caused data
// loss on container restart.  It now delegates to uploadToS3().
// ---------------------------------------------------------------------------
export async function uploadToDisk(file) {
  return uploadToS3(file);
}

// ---------------------------------------------------------------------------
// cz-js-1003 FIX: Replaced hardcoded port numbers in API base URLs with
// values resolved at runtime from environment variables injected by ECS
// Fargate via AWS Secrets Manager / SSM Parameter Store.
//
// BEFORE (hardcoded ports – breaks in containerised / Kubernetes environments):
//   fetch('http://backend:8080/api/data')   ← port 8080 baked into bundle
//   fetch('http://localhost:3001/api/info') ← localhost + port 3001 baked in
//
// AFTER (runtime-resolved base URLs):
//   The base URLs are stored in AWS Secrets Manager and injected into the
//   ECS Fargate task definition as secrets:
//     REACT_APP_BACKEND_BASE_URL  ← e.g. http://backend-service/api
//     REACT_APP_LOCAL_API_BASE_URL ← e.g. http://local-service/api
//
//   At container startup the entrypoint script (or ECS secrets injection)
//   writes these values into window.__ENV__ via /public/config.js so that
//   a single Docker image can be promoted across dev / staging / production
//   without rebuilding.
// ---------------------------------------------------------------------------

/** Base URL for the backend data service (port-free, resolved at runtime). */
const BACKEND_BASE_URL =
  (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.BACKEND_BASE_URL)
    ? window.__ENV__.BACKEND_BASE_URL
    : (process.env.REACT_APP_BACKEND_BASE_URL || 'http://backend/api');

export function getData() {
  // cz-js-1003 FIX: hardcoded port 8080 replaced with BACKEND_BASE_URL
  // resolved at runtime from AWS Secrets Manager via ECS Fargate task secrets.
  return fetch(`${BACKEND_BASE_URL}/data`);
}

// ---------------------------------------------------------------------------
// cz-js-1004 FIX: Removed localhost URL from getLocal().
//
// BEFORE (localhost URL – breaks in multi-container / ECS Fargate deployments
// where frontend and backend run in separate pods with isolated network
// namespaces):
//   fetch('http://localhost:3001/api/info')
//
// AFTER (relative /api path routed through the Application Load Balancer):
//   fetch('/api/info')
//
// HOW: An Application Load Balancer (ALB) sits in front of both ECS Fargate
// services.  Path-based routing rules forward requests whose path starts with
// /api/* to the backend target group, while all other requests go to the
// frontend target group.  The Angular/React frontend therefore uses a plain
// relative path – no explicit host, no port, no localhost reference – and the
// ALB handles inter-service routing transparently.
//
// No environment variable is needed: relative paths work identically in every
// environment (dev, staging, production) because the ALB is always the single
// entry point.
// ---------------------------------------------------------------------------

export function getLocal() {
  // cz-js-1004 FIX: localhost URL replaced with a relative /api path.
  // The ALB path-based routing rule forwards /api/* to the backend ECS
  // Fargate service, so no explicit host or port is required here.
  return fetch('/api/info');
}
// ---------------------------------------------------------------------------
// cz-js-1030 FIX: NGINX Sidecar CORS Proxy in ECS Fargate Task Definition
//
// PROBLEM: In containerised microservice deployments (ECS Fargate + Kubernetes
// service mesh), the React frontend and the external API run in separate
// containers with different origins.  A bare fetch() to a cross-origin URL
// has no CORS error handling, so any network policy rejection or missing
// CORS header causes a silent failure or an unhandled promise rejection.
//
// SOLUTION – NGINX Sidecar CORS Proxy:
//   An NGINX reverse-proxy sidecar container is added to the ECS Fargate task
//   definition alongside the React container.  The sidecar:
//     1. Listens on a loopback port (e.g. 8888) inside the task network
//        namespace (containers in the same ECS task share localhost).
//     2. Forwards requests to the real upstream API and injects the required
//        CORS response headers (Access-Control-Allow-Origin, etc.).
//     3. Handles OPTIONS pre-flight requests automatically.
//
//   The React code therefore calls the NGINX sidecar via a relative or
//   loopback URL instead of the external origin directly.  The sidecar URL
//   is injected at runtime through the ECS task-definition environment
//   variable REACT_APP_CORS_PROXY_URL (sourced from AWS Secrets Manager /
//   SSM Parameter Store), so no URL is baked into the production bundle.
//
// ECS Fargate task-definition environment variables required:
//   REACT_APP_CORS_PROXY_URL  – base URL of the NGINX sidecar proxy
//                               e.g. http://localhost:8888
//                               (injected via AWS Secrets Manager secret
//                                /app/cors-proxy/url)
//
// CORS error handling:
//   The fetch wrapper below catches both network-level CORS failures (which
//   surface as TypeError in the browser) and non-2xx HTTP responses returned
//   by the proxy, so callers always receive a meaningful rejection reason
//   rather than a silent failure.
// ---------------------------------------------------------------------------

/**
 * Base URL of the NGINX CORS-proxy sidecar running inside the same ECS
 * Fargate task.  Resolved at runtime from the ECS task-definition environment
 * variable REACT_APP_CORS_PROXY_URL (injected from AWS Secrets Manager).
 * Falls back to window.__ENV__.CORS_PROXY_URL for runtime config injection
 * via docker-entrypoint.sh / public/config.js.
 */
const CORS_PROXY_BASE_URL =
  (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.CORS_PROXY_URL)
    ? window.__ENV__.CORS_PROXY_URL
    : (process.env.REACT_APP_CORS_PROXY_URL || 'http://localhost:8888');

/**
 * Fetches cross-origin data through the NGINX CORS-proxy sidecar.
 *
 * cz-js-1030 FIX: The original bare fetch() to 'http://api.other-origin.com/data'
 * is replaced with a call routed through the NGINX sidecar proxy whose URL is
 * resolved at runtime from REACT_APP_CORS_PROXY_URL.  Full CORS error handling
 * is added so network-level CORS failures (TypeError) and non-2xx responses
 * are both surfaced as explicit, descriptive errors.
 *
 * @returns {Promise<any>} Resolves with the parsed JSON response body.
 */
export function getCross() {
  // cz-js-1030 FIX: Route the cross-origin request through the NGINX sidecar
  // CORS proxy (REACT_APP_CORS_PROXY_URL) instead of calling the external
  // origin directly.  The proxy injects CORS headers and handles pre-flight
  // OPTIONS requests, satisfying Kubernetes network policies and ECS Fargate
  // service-mesh CORS requirements.
  return fetch(`${CORS_PROXY_BASE_URL}/data`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
    // 'cors' mode is explicit so the browser enforces CORS checks and any
    // policy violation is surfaced as a catchable error rather than a silent
    // opaque response.
    mode: 'cors',
  })
    .then(function (response) {
      // Handle non-2xx HTTP responses returned by the proxy or upstream API.
      if (!response.ok) {
        throw new Error(
          'CORS proxy request failed: HTTP ' + response.status + ' ' + response.statusText
        );
      }
      return response.json();
    })
    .catch(function (error) {
      // Catch network-level CORS failures (TypeError: Failed to fetch) as well
      // as the HTTP-error thrown above, and re-throw with a descriptive message
      // so callers can display a meaningful error to the user.
      if (error instanceof TypeError) {
        throw new TypeError(
          'CORS request blocked or network error when contacting CORS proxy at ' +
          CORS_PROXY_BASE_URL + ': ' + error.message
        );
      }
      throw error;
    });
}
