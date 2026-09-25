import axios from 'axios';

// cz-js-1049 FIX: jQuery File Upload to Local Container Filesystem
// Replaced local container filesystem write (fs.writeFileSync) with S3 presigned URL
// upload pattern. The ECS Fargate backend generates a short-lived S3 presigned PUT URL;
// the jQuery File Upload plugin (or any browser client) uploads the file directly to S3
// without routing file data through the Fargate container, ensuring data persists across
// container restarts, pod evictions, and horizontal scaling.
//
// Required environment variables:
//   REACT_APP_PRESIGNED_URL_ENDPOINT – ECS Fargate backend endpoint that returns a
//     presigned S3 PUT URL (e.g. https://api.example.com/uploads/presign)
//   REACT_APP_S3_BUCKET_REGION      – AWS region of the target S3 bucket (optional,
//     used for client-side reference only)

/**
 * Requests a short-lived S3 presigned PUT URL from the ECS Fargate backend and
 * uploads the file directly from the browser to S3.
 *
 * This replaces the previous local-filesystem write:
 *   fs.writeFileSync('/app/build/uploads/' + file.name, file)
 *
 * @param {File} file - The File object selected by the user (e.g. from jQuery File Upload)
 * @returns {Promise<string>} The S3 object key of the uploaded file
 */
export async function uploadToDisk(file) {
  const presignEndpoint = process.env.REACT_APP_PRESIGNED_URL_ENDPOINT;
  if (!presignEndpoint) {
    throw new Error(
      'REACT_APP_PRESIGNED_URL_ENDPOINT environment variable is not set. ' +
      'Configure the ECS Fargate backend endpoint that issues S3 presigned PUT URLs.'
    );
  }

  // Step 1: Request a short-lived S3 presigned PUT URL from the ECS Fargate backend.
  //         The backend generates the URL using AWS SDK (e.g. @aws-sdk/s3-request-presigner)
  //         and returns { uploadUrl, fileKey } without the file data ever touching the container.
  const presignResponse = await axios.get(presignEndpoint, {
    params: {
      filename: file.name,
      contentType: file.type,
    },
  });
  const { uploadUrl, fileKey } = presignResponse.data;

  // Step 2: Upload the file directly from the browser to S3 using the presigned PUT URL.
  //         File data bypasses the Fargate container entirely — no local filesystem writes.
  await axios.put(uploadUrl, file, {
    headers: {
      'Content-Type': file.type,
    },
  });

  // Return the S3 object key so callers can reference or display the uploaded file.
  return fileKey;
}

export function getData() {
  // cz-js-1003 FIX: Hardcoded API Port in fetch URL
  // Replaced hardcoded 'http://backend:8080/api/data' with a base URL resolved
  // from the REACT_APP_BACKEND_API_URL environment variable, which is injected
  // into the ECS Fargate task definition from AWS Secrets Manager at runtime.
  // This enables dynamic port mapping and service discovery in Kubernetes /
  // Istio service-mesh environments without rebuilding the container image.
  //
  // Required ECS Fargate task-definition secret (sourced from AWS Secrets Manager):
  //   Secret name : app/config/backend_api_url
  //   Env var name: REACT_APP_BACKEND_API_URL
  //   Example value: http://backend:8080   (or the Kubernetes service DNS name)
  const backendApiUrl = process.env.REACT_APP_BACKEND_API_URL;
  if (!backendApiUrl) {
    throw new Error(
      'REACT_APP_BACKEND_API_URL environment variable is not set. ' +
      'Configure the ECS Fargate task definition to inject this value from AWS Secrets Manager ' +
      '(secret: app/config/backend_api_url).'
    );
  }
  return fetch(`${backendApiUrl}/api/data`);
}

export function getLocal() {
  // cz-js-1004 FIX: Localhost URL in HTTP call (ALB Path-Routing Remediation)
  // Original code: fetch('http://localhost:3001/api/info')
  //
  // In a multi-container ECS Fargate deployment the frontend and backend run in
  // separate tasks with isolated network namespaces, so 'localhost' never resolves
  // to the backend service.
  //
  // Remediation – Application Load Balancer with Path Routing:
  //   An ALB listener rule forwards requests whose path starts with /api/* to the
  //   backend ECS Fargate target group, while all other requests go to the frontend
  //   target group.  The Angular/JS frontend therefore uses a relative path (/api/…)
  //   and the ALB handles inter-service routing transparently — no explicit host or
  //   port reference is needed in the client code.
  //
  // No environment variable is required: the relative path works in every
  // environment (local dev via a proxy, staging, production) without rebuilding
  // the container image.
  return fetch('/api/info');
}

export function getCross() {
  // cz-js-1030 fetch without CORS error handling
  // cz-js-1030 FIX: React CORS Handling for Containerized Microservices
  // Remediation: NGINX Sidecar CORS Proxy in ECS Fargate Task Definition
  //
  // In a containerised microservices deployment the React frontend and the
  // external API run in separate origins.  Browser same-origin policy blocks
  // direct cross-origin fetch calls, and CORS headers cannot be reliably
  // managed inside the React build artefact.
  //
  // Solution — NGINX reverse-proxy sidecar in the ECS Fargate task definition:
  //   • An NGINX sidecar container runs alongside the React container inside
  //     the same ECS Fargate task (shared network namespace / localhost).
  //   • NGINX proxies requests to the external API and injects the required
  //     CORS response headers (Access-Control-Allow-Origin, etc.) so the
  //     browser never sees a cross-origin response.
  //   • The React app calls the NGINX sidecar via a task-local URL
  //     (REACT_APP_CORS_PROXY_URL), keeping the external origin hidden from
  //     the browser entirely.
  //   • Proper fetch error handling is added to surface network / CORS errors
  //     clearly instead of silently swallowing them.
  //
  // Required ECS Fargate task-definition environment variable:
  //   REACT_APP_CORS_PROXY_URL – Base URL of the NGINX sidecar CORS proxy
  //     (e.g. http://localhost:8081/proxy)
  //   The NGINX sidecar must be configured with:
  //     proxy_pass        <external-api-url>;
  //     add_header        Access-Control-Allow-Origin  $http_origin always;
  //     add_header        Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
  //     add_header        Access-Control-Allow-Headers "Authorization, Content-Type" always;

  const corsProxyUrl = process.env.REACT_APP_CORS_PROXY_URL;
  if (!corsProxyUrl) {
    return Promise.reject(
      new Error(
        'REACT_APP_CORS_PROXY_URL environment variable is not set. ' +
        'Configure the ECS Fargate task definition to include an NGINX sidecar ' +
        'CORS proxy container and set REACT_APP_CORS_PROXY_URL to its base URL ' +
        '(e.g. http://localhost:8081/proxy).'
      )
    );
  }

  return fetch(`${corsProxyUrl}/data`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
    // Credentials are included only when the NGINX sidecar is on the same
    // Fargate task (localhost), so no cross-origin credential leak occurs.
    credentials: 'same-origin',
  })
    .then(function (response) {
      if (!response.ok) {
        // Surface HTTP-level errors (4xx / 5xx) explicitly so callers can
        // distinguish network failures from CORS rejections.
        throw new Error(
          'CORS proxy request failed: HTTP ' + response.status + ' ' + response.statusText +
          '. Verify the NGINX sidecar CORS proxy is running and reachable at ' +
          corsProxyUrl
        );
      }
      return response.json();
    })
    .catch(function (error) {
      // Re-throw with additional context so container logs capture the root cause.
      if (error.name === 'TypeError') {
        // TypeError is thrown by fetch when the request is blocked by CORS policy
        // or when the network is unreachable — both are actionable in a container env.
        throw new Error(
          'Network or CORS error when calling CORS proxy at ' + corsProxyUrl + '/data. ' +
          'Ensure the NGINX sidecar container is defined in the ECS Fargate task definition ' +
          'and that REACT_APP_CORS_PROXY_URL is set correctly. Original error: ' + error.message
        );
      }
      throw error;
    });
}
