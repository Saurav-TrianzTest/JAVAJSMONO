# AWS Secrets Manager Configuration for ECS Fargate

## Overview
This document describes how to configure API endpoint URLs using AWS Secrets Manager with ECS Fargate Task Secrets injection.

## Blocker Fixed
- **Rule ID**: cz-js-1003
- **Rule Name**: Hardcoded API Ports in Angular HttpClient
- **Severity**: MEDIUM
- **Category**: network-&-port-configuration

## Changes Made
Replaced hardcoded API endpoint URLs (e.g., `http://backend:8080`) with environment variables that are injected from AWS Secrets Manager at container runtime.

### Files Modified
- `src/api/upload.js` - Lines 15, 75, 121, 153

### Environment Variables Used
The application now uses the following environment variables for API endpoint configuration:
- `REACT_APP_BACKEND_URL` - Primary backend API URL (build-time)
- `BACKEND_URL` - Backend API URL (runtime)
- `API_BASE_URL` - Fallback API base URL (runtime)

## AWS Secrets Manager Setup

### Step 1: Create Secret in AWS Secrets Manager
```bash
aws secretsmanager create-secret \
  --name /ecs/fargate/api-config \
  --description "API endpoint configuration for containerized application" \
  --secret-string '{
    "BACKEND_URL": "https://api.example.com",
    "API_BASE_URL": "https://api.example.com"
  }'
```

### Step 2: Configure ECS Task Definition
Add the secret to your ECS Task Definition JSON:

```json
{
  "family": "react-nextjs-app",
  "containerDefinitions": [
    {
      "name": "app-container",
      "image": "your-ecr-repo/react-nextjs-app:latest",
      "secrets": [
        {
          "name": "BACKEND_URL",
          "valueFrom": "arn:aws:secretsmanager:region:account-id:secret:/ecs/fargate/api-config:BACKEND_URL::"
        },
        {
          "name": "API_BASE_URL",
          "valueFrom": "arn:aws:secretsmanager:region:account-id:secret:/ecs/fargate/api-config:API_BASE_URL::"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ]
    }
  ],
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::account-id:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::account-id:role/ecsTaskRole"
}
```

### Step 3: Grant IAM Permissions
Ensure your ECS Task Execution Role has permissions to read from Secrets Manager:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:region:account-id:secret:/ecs/fargate/api-config*"
      ]
    }
  ]
}
```

## Build-Time Configuration
For build-time environment variables (REACT_APP_*), you can set them during the Docker build:

```dockerfile
# Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Build-time environment variable
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["npm", "start"]
```

Build command:
```bash
docker build \
  --build-arg REACT_APP_BACKEND_URL=https://api.example.com \
  -t react-nextjs-app:latest .
```

## Runtime Configuration
Runtime environment variables (BACKEND_URL, API_BASE_URL) are injected by ECS Fargate from AWS Secrets Manager when the container starts.

## Testing
To test locally with environment variables:

```bash
# Set environment variables
export BACKEND_URL=http://localhost:8080
export API_BASE_URL=http://localhost:8080

# Run the application
npm start
```

## Security Best Practices
1. **Never commit secrets** to version control
2. **Use AWS Secrets Manager** for sensitive configuration
3. **Rotate secrets regularly** using AWS Secrets Manager rotation
4. **Use least privilege IAM policies** for ECS task roles
5. **Enable encryption** for secrets at rest and in transit
6. **Audit secret access** using AWS CloudTrail

## Service Discovery with Kubernetes/Istio
If using Kubernetes with Istio service mesh:
- Set `BACKEND_URL` to the Kubernetes service name (e.g., `http://backend-service`)
- Istio will handle service discovery and load balancing
- Port mapping is handled dynamically by the service mesh

## Troubleshooting

### Container fails to start
- Check ECS Task Execution Role has Secrets Manager permissions
- Verify secret ARN is correct in task definition
- Check CloudWatch Logs for error messages

### API calls fail with connection errors
- Verify `BACKEND_URL` is set correctly
- Check network connectivity between containers
- Verify security groups allow traffic on required ports

### Environment variables not available
- Ensure secrets are defined in task definition
- Check ECS task logs for secret injection errors
- Verify secret exists in AWS Secrets Manager
