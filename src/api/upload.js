import axios from 'axios';

/**
 * cz-js-1049 fix: jQuery File Upload to Local Container Filesystem
 *
 * Remediation: Generate S3 Presigned URLs from ECS Fargate Backend for
 * Client-Side Direct Upload
 *
 * The original implementation wrote uploaded files directly to the local
 * container filesystem (/app/build/uploads/), which is ephemeral and loses
 * all data on container restart, pod eviction, or horizontal scaling in a
 * Kubernetes / ECS Fargate environment.
 *
 * This implementation instead:
 *   1. Calls the ECS Fargate backend to obtain a short-lived S3 presigned
 *      PUT URL for the target object key.
 *   2. Configures the jQuery File Upload plugin (or any XHR-capable client)
 *      to PUT the file bytes directly to S3 using that presigned URL.
 *
 * File data never passes through the Fargate container, eliminating the
 * ephemeral-filesystem dependency entirely and ensuring data persists across
 * the full container lifecycle (restarts, evictions, scale-out).
 *
 * Required environment variables (set in ECS task definition / container env):
 *   REACT_APP_API_BASE_URL  – base URL of the ECS Fargate backend service
 *                             that issues presigned URLs
 *                             (e.g. http://backend:8080)
 */

/**
 * Fetches a short-lived S3 presigned PUT URL from the ECS Fargate backend
 * and returns it together with the resolved S3 object key so the jQuery
 * File Upload plugin can upload directly to S3 without routing file data
 * through the container.
 *
 * @param {File} file  - The File object selected by the user.
 * @returns {Promise<{uploadUrl: string, fileKey: string}>}
 */
export async function uploadToDisk(file) {
  const apiBase = process.env.REACT_APP_API_BASE_URL || '';

  // Step 1: Request a presigned S3 PUT URL from the ECS Fargate backend.
  //         The backend generates a short-lived URL scoped to the specific
  //         object key and content-type, then returns it without touching
  //         the file bytes.
  const presignResponse = await axios.get(
    `${apiBase}/api/s3/presigned-url`,
    {
      params: {
        fileName: file.name,
        contentType: file.type,
      },
    }
  );

  const { uploadUrl, fileKey } = presignResponse.data;

  // Step 2: Upload the file directly from the browser to S3 using the
  //         presigned PUT URL.  The jQuery File Upload plugin (or plain XHR)
  //         sends the bytes straight to S3 — the Fargate task is not
  //         involved in the data transfer at all.
  await axios.put(uploadUrl, file, {
    headers: {
      'Content-Type': file.type,
    },
  });

  // Return the S3 object key so callers can reference the uploaded file.
  return fileKey;
}

export function getData() {
  /**
   * cz-js-1003 fix: Hardcoded API Port in fetch URL
   *
   * Remediation: AWS Secrets Manager with ECS Fargate Task Secrets for
   * Sensitive API Endpoint Config
   *
   * The original URL 'http://backend:8080/api/data' contained a hardcoded
   * port (8080) that breaks in containerised environments where Kubernetes
   * services and Istio service mesh perform dynamic port mapping and load
   * balancing.  The base URL (including port) is now resolved at runtime
   * from the REACT_APP_API_BASE_URL environment variable, which is injected
   * into the ECS Fargate task definition via AWS Secrets Manager secrets
   * injection — no port is ever hardcoded in the application bundle.
   *
   * Required ECS task-definition secret / environment variable:
   *   REACT_APP_API_BASE_URL  – full base URL of the backend service
   *                             (e.g. http://backend:8080)
   */
  const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || '';
  return fetch(`${apiBaseUrl}/api/data`);
}
export function getLocal() {
  /**
   * cz-js-1004 fix: Localhost URL in HTTP call (Angular HTTP Interceptors)
   *
   * Remediation: Use Application Load Balancer with Path Routing to
   * Eliminate Localhost in Angular on ECS Fargate
   *
   * The original URL 'http://localhost:3001/api/info' used an explicit
   * localhost host and port that breaks in multi-container ECS Fargate /
   * Kubernetes deployments where the frontend and backend run in separate
   * pods with isolated network namespaces.  Localhost is not reachable
   * across pod boundaries, so the call would fail at runtime.
   *
   * With an Application Load Balancer (ALB) performing path-based routing
   * in front of both ECS Fargate services, the Angular frontend can use a
   * relative path (/api/info) instead of an absolute localhost URL.  The
   * ALB forwards requests whose path starts with /api to the backend
   * service, and all other requests to the frontend service — no explicit
   * host or port is required in the application code.
   *
   * No environment variable is needed: the relative path works regardless
   * of the deployment environment because the browser sends the request to
   * the same origin (the ALB), which routes it to the correct backend pod.
   */
  return fetch('/api/info');
}
export function getCross() {
  /**
   * cz-js-1030 fix: React CORS Handling for Containerized Microservices
   *
   * Remediation: NGINX Sidecar CORS Proxy in ECS Fargate Task Definition
   *
   * Problem:
   *   The original fetch call targeted a cross-origin URL
   *   ('http://api.other-origin.com/data') without any CORS error handling.
   *   In containerised microservice deployments (ECS Fargate, Kubernetes),
   *   the React frontend and the API backend run in separate containers with
   *   different origins.  Kubernetes NetworkPolicies and service-mesh
   *   sidecars (e.g. Istio, App Mesh) can block or reject cross-origin
   *   requests that lack proper CORS headers, causing silent runtime
   *   failures that are extremely difficult to diagnose.
   *
   * Solution – NGINX Reverse-Proxy Sidecar in the ECS Fargate Task:
   *   An NGINX sidecar container is added to the same ECS Fargate task
   *   definition as the React container.  The sidecar listens on a
   *   well-known local port (e.g. 8081) and proxies requests to the
   *   upstream API service, injecting the required CORS response headers
   *   (Access-Control-Allow-Origin, Access-Control-Allow-Methods, etc.)
   *   before the response reaches the browser.  Because both containers
   *   share the same task network namespace in Fargate, the React app can
   *   reach the NGINX sidecar via localhost — no cross-origin request is
   *   ever made from the browser's perspective.
   *
   *   The NGINX sidecar URL is supplied at runtime through the environment
   *   variable REACT_APP_CORS_PROXY_URL so that no URL is hardcoded in the
   *   application bundle and the same image can be promoted across
   *   dev → staging → production without rebuilding.
   *
   * ECS Fargate task-definition sidecar snippet (reference only):
   *   {
   *     "name": "nginx-cors-proxy",
   *     "image": "nginx:alpine",
   *     "portMappings": [{ "containerPort": 8081 }],
   *     "environment": [
   *       { "name": "UPSTREAM_API_URL",
   *         "value": "http://api.other-origin.com" }
   *     ],
   *     "mountPoints": [{
   *       "sourceVolume": "nginx-cors-config",
   *       "containerPath": "/etc/nginx/conf.d"
   *     }]
   *   }
   *
   * Required environment variable (set in ECS task definition):
   *   REACT_APP_CORS_PROXY_URL – base URL of the NGINX CORS proxy sidecar
   *                              (e.g. http://localhost:8081)
   */
  const corsProxyUrl =
    process.env.REACT_APP_CORS_PROXY_URL || '';

  return fetch(`${corsProxyUrl}/data`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    // 'same-origin' credentials policy is safe because the NGINX sidecar
    // is reachable via localhost within the shared Fargate task network
    // namespace — no actual cross-origin request leaves the task boundary.
    credentials: 'same-origin',
  })
    .then((response) => {
      if (!response.ok) {
        // Surface HTTP-level CORS / network errors with actionable detail
        // so they are visible in container logs and APM tooling.
        throw new Error(
          `CORS proxy request failed: HTTP ${response.status} ${response.statusText} ` +
          `(url: ${corsProxyUrl}/data)`
        );
      }
      return response.json();
    })
    .catch((error) => {
      // Re-throw with additional context so the caller and any error
      // boundary / monitoring agent can distinguish CORS/network failures
      // from application-level errors.
      throw new Error(`getCross – fetch error: ${error.message}`);
    });
}
