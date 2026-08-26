# CORS Handling Fix for Containerized Microservices (cz-js-1030)

## Overview
This document describes the implementation of CORS (Cross-Origin Resource Sharing) handling for React applications running in containerized microservices on AWS ECS Fargate.

## Problem Statement
React applications without proper CORS error handling in fetch calls break in containerized microservices where frontend and API run in separate containers with different origins. Container deployments require CORS configuration and error handling for cross-origin service communication in service mesh environments.

## Solution: NGINX Sidecar CORS Proxy

### Architecture
The solution implements an NGINX reverse-proxy sidecar container in the ECS Fargate task definition to handle CORS headers, offloading header management from the React build process.

```
┌─────────────────────────────────────────────────────────┐
│                    ECS Fargate Task                      │
│                                                          │
│  ┌──────────────────┐         ┌──────────────────┐     │
│  │  NGINX Sidecar   │         │  React/Next.js   │     │
│  │  (Port 80)       │────────▶│  Application     │     │
│  │  CORS Proxy      │         │  (Port 3000)     │     │
│  └──────────────────┘         └──────────────────┘     │
│         ▲                                                │
│         │                                                │
└─────────┼────────────────────────────────────────────────┘
          │
    ┌─────┴─────┐
    │    ALB    │
    └───────────┘
```

### Components

#### 1. NGINX Configuration (`nginx.conf`)
- **Location**: `/modernize-data/studio-data/TNT1001/APP882572/transformed-code/357/studio-workspace/JAVAJSMONOreg/nginx.conf`
- **Purpose**: Configures NGINX as a reverse proxy with CORS header management
- **Key Features**:
  - Adds CORS headers to all responses
  - Handles preflight OPTIONS requests
  - Proxies requests to backend application on port 3000
  - Optimizes static asset caching
  - Provides fast health check endpoint

#### 2. NGINX Dockerfile (`Dockerfile.nginx`)
- **Location**: `/modernize-data/studio-data/TNT1001/APP882572/transformed-code/357/studio-workspace/JAVAJSMONOreg/Dockerfile.nginx`
- **Purpose**: Creates the NGINX sidecar container image
- **Base Image**: `nginx:1.25-alpine` (lightweight and secure)
- **Features**:
  - Custom NGINX configuration
  - Built-in health check
  - Minimal attack surface

#### 3. Updated ECS Task Definition (`ecs-task-definition.json`)
- **Location**: `/modernize-data/studio-data/TNT1001/APP882572/transformed-code/357/studio-workspace/JAVAJSMONOreg/ecs-task-definition.json`
- **Changes**:
  - Added `nginx-cors-proxy` container definition
  - NGINX container listens on port 80 (external)
  - React application container listens on port 3000 (internal)
  - Container dependency: NGINX depends on React app starting first
  - Separate health checks for each container

#### 4. Enhanced Fetch Error Handling (`src/api/upload.js`)
- **Location**: `/modernize-data/studio-data/TNT1001/APP882572/transformed-code/357/studio-workspace/JAVAJSMONOreg/src/api/upload.js`
- **Line**: 165-190
- **Changes**:
  - Added explicit CORS mode configuration
  - Implemented comprehensive error handling
  - Added credentials support
  - Proper HTTP status checking
  - Graceful CORS error messages

## Implementation Details

### CORS Headers Added
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, PATCH
Access-Control-Allow-Headers: DNT, User-Agent, X-Requested-With, If-Modified-Since, Cache-Control, Content-Type, Range, Authorization
Access-Control-Expose-Headers: Content-Length, Content-Range
Access-Control-Allow-Credentials: true
```

### Fetch Configuration
```javascript
fetch('http://api.other-origin.com/data', {
  mode: 'cors',
  credentials: 'include',
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
})
```

### Error Handling
- Detects CORS-specific errors
- Provides user-friendly error messages
- Logs detailed error information for debugging
- Gracefully handles network failures

## Deployment Instructions

### 1. Build NGINX Sidecar Image
```bash
cd /modernize-data/studio-data/TNT1001/APP882572/transformed-code/357/studio-workspace/JAVAJSMONOreg
docker build -f Dockerfile.nginx -t react-nextjs-nginx-proxy:latest .
```

### 2. Tag and Push to ECR
```bash
# Authenticate to ECR
aws ecr get-login-password --region REGION | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com

# Create ECR repository (if not exists)
aws ecr create-repository --repository-name react-nextjs-nginx-proxy --region REGION

# Tag image
docker tag react-nextjs-nginx-proxy:latest ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/react-nextjs-nginx-proxy:latest

# Push to ECR
docker push ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/react-nextjs-nginx-proxy:latest
```

### 3. Update ECS Task Definition
```bash
# Register new task definition
aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json

# Update ECS service to use new task definition
aws ecs update-service \
  --cluster your-cluster-name \
  --service react-nextjs-service \
  --task-definition react-nextjs-host \
  --force-new-deployment
```

### 4. Update Application Load Balancer Target
- Ensure ALB target group points to port 80 (NGINX proxy)
- NGINX will handle routing to the React application on port 3000

## Testing

### 1. Verify CORS Headers
```bash
curl -I -X OPTIONS http://your-alb-endpoint.amazonaws.com/api/data \
  -H "Origin: http://example.com" \
  -H "Access-Control-Request-Method: GET"
```

Expected response should include:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, PATCH
```

### 2. Test Cross-Origin Request
```bash
curl -X GET http://your-alb-endpoint.amazonaws.com/api/data \
  -H "Origin: http://example.com"
```

### 3. Verify Health Checks
```bash
# NGINX health check
curl http://your-alb-endpoint.amazonaws.com/api/health

# Direct application health check (internal)
curl http://localhost:3000/api/health
```

## Benefits

1. **Centralized CORS Management**: All CORS headers managed in one place (NGINX config)
2. **No Application Code Changes**: React application doesn't need CORS middleware
3. **Performance**: NGINX efficiently handles preflight requests
4. **Security**: Fine-grained control over allowed origins and methods
5. **Scalability**: Sidecar pattern scales with application containers
6. **Separation of Concerns**: Infrastructure concerns separated from application logic

## Monitoring

### CloudWatch Logs
- NGINX logs: `/ecs/react-nextjs-nginx-proxy`
- Application logs: `/ecs/react-nextjs-host`

### Key Metrics to Monitor
- NGINX container health check failures
- CORS-related errors in application logs
- Preflight request volume (OPTIONS requests)
- Response time impact of proxy layer

## Troubleshooting

### Issue: CORS errors still occurring
**Solution**: 
1. Verify NGINX container is running: `aws ecs describe-tasks`
2. Check NGINX logs for errors
3. Ensure ALB routes to port 80 (NGINX), not port 3000

### Issue: NGINX container failing health checks
**Solution**:
1. Check if React application is responding on port 3000
2. Verify container dependency configuration
3. Review NGINX error logs

### Issue: Slow response times
**Solution**:
1. Check NGINX proxy timeout settings
2. Monitor container resource utilization
3. Consider adjusting CPU/memory allocation

## Security Considerations

1. **Origin Restrictions**: Update `nginx.conf` to restrict allowed origins in production
2. **Credentials**: Only enable `Access-Control-Allow-Credentials` if needed
3. **Headers**: Limit exposed headers to minimum required
4. **Methods**: Restrict allowed methods based on API requirements

## Environment-Specific Configuration

For production environments, consider:
```nginx
# Restrict origins to specific domains
map $http_origin $cors_origin {
    default "";
    "~^https://(.*\.)?yourdomain\.com$" "$http_origin";
}

add_header 'Access-Control-Allow-Origin' $cors_origin always;
```

## References

- [AWS ECS Task Definition](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- [NGINX CORS Configuration](https://enable-cors.org/server_nginx.html)
- [MDN CORS Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [ECS Sidecar Pattern](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/networking-connecting-services.html)

## Blocker Resolution

**Blocker ID**: cz-js-1030  
**Rule Name**: React CORS Handling for Containerized Microservices  
**Severity**: MEDIUM  
**Status**: ✅ RESOLVED  

**Files Modified**:
1. `src/api/upload.js` - Added CORS error handling to fetch calls
2. `nginx.conf` - Created NGINX CORS proxy configuration
3. `Dockerfile.nginx` - Created NGINX sidecar Dockerfile
4. `ecs-task-definition.json` - Added NGINX sidecar container

**Remediation Applied**: NGINX Sidecar CORS Proxy in ECS Fargate Task Definition
