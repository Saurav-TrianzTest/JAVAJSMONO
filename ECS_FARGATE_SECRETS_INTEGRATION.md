# ECS Fargate Secrets Manager Integration Guide

## Overview

This document describes how to configure AWS ECS Fargate to inject runtime environment variables from AWS Secrets Manager into the Angular/React application container, eliminating the need to rebuild images for different environments.

## Architecture

The multi-stage Dockerfile now implements:

1. **Build Stage**: Compiles Angular/React application with Node.js and build tools
2. **Runtime Stage**: Serves optimized production build via nginx:alpine
3. **Runtime Configuration Injection**: Generates `env-config.js` at container startup from ECS environment variables populated by Secrets Manager

## How It Works

### 1. Dockerfile Configuration

The Dockerfile creates a startup script (`/docker-entrypoint.d/40-inject-env-config.sh`) that:
- Executes automatically when the container starts (nginx:alpine runs all scripts in `/docker-entrypoint.d/`)
- Reads environment variables injected by ECS Fargate
- Generates `/usr/share/nginx/html/env-config.js` with runtime configuration
- Makes configuration available to the Angular/React app via `window._env_` object

### 2. AWS Secrets Manager Setup

Create secrets in AWS Secrets Manager for each environment:

```bash
# Development environment
aws secretsmanager create-secret \
  --name /myapp/dev/frontend-config \
  --secret-string '{
    "API_URL": "https://api-dev.example.com",
    "API_KEY": "dev-api-key-12345",
    "FEATURE_FLAG_NEW_UI": "true",
    "ENVIRONMENT": "development",
    "AWS_REGION": "us-east-1"
  }'

# Production environment
aws secretsmanager create-secret \
  --name /myapp/prod/frontend-config \
  --secret-string '{
    "API_URL": "https://api.example.com",
    "API_KEY": "prod-api-key-67890",
    "FEATURE_FLAG_NEW_UI": "false",
    "ENVIRONMENT": "production",
    "AWS_REGION": "us-east-1"
  }'
```

### 3. ECS Task Definition Configuration

Configure your ECS Task Definition to inject secrets as environment variables:

```json
{
  "family": "myapp-frontend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::ACCOUNT_ID:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT_ID:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "frontend",
      "image": "ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/myapp-frontend:latest",
      "portMappings": [
        {
          "containerPort": 80,
          "protocol": "tcp"
        }
      ],
      "secrets": [
        {
          "name": "API_URL",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:/myapp/prod/frontend-config:API_URL::"
        },
        {
          "name": "API_KEY",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:/myapp/prod/frontend-config:API_KEY::"
        },
        {
          "name": "FEATURE_FLAG_NEW_UI",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:/myapp/prod/frontend-config:FEATURE_FLAG_NEW_UI::"
        },
        {
          "name": "ENVIRONMENT",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:/myapp/prod/frontend-config:ENVIRONMENT::"
        },
        {
          "name": "AWS_REGION",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:/myapp/prod/frontend-config:AWS_REGION::"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/myapp-frontend",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### 4. IAM Permissions

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
        "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:/myapp/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": [
        "arn:aws:kms:REGION:ACCOUNT_ID:key/KMS_KEY_ID"
      ]
    }
  ]
}
```

### 5. Application Integration

Update your Angular/React application to use the runtime configuration:

#### index.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My App</title>
  <!-- Load runtime environment configuration BEFORE app bundle -->
  <script src="/env-config.js"></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>
```

#### config.js (or environment service)
```javascript
// Access runtime configuration injected by ECS Fargate
export const config = {
  apiUrl: window._env_?.API_URL || 'http://localhost:8080',
  apiKey: window._env_?.API_KEY || '',
  featureFlags: {
    newUI: window._env_?.FEATURE_FLAG_NEW_UI === 'true'
  },
  environment: window._env_?.ENVIRONMENT || 'development',
  awsRegion: window._env_?.AWS_REGION || 'us-east-1'
};

// Usage in API calls
export async function fetchData() {
  const response = await fetch(`${config.apiUrl}/api/data`, {
    headers: {
      'X-API-Key': config.apiKey
    }
  });
  return response.json();
}
```

#### Angular Environment Service (if using Angular)
```typescript
import { Injectable } from '@angular/core';

declare global {
  interface Window {
    _env_?: {
      API_URL: string;
      API_KEY: string;
      FEATURE_FLAG_NEW_UI: string;
      ENVIRONMENT: string;
      AWS_REGION: string;
    };
  }
}

@Injectable({
  providedIn: 'root'
})
export class EnvironmentService {
  get apiUrl(): string {
    return window._env_?.API_URL || 'http://localhost:8080';
  }

  get apiKey(): string {
    return window._env_?.API_KEY || '';
  }

  get isNewUIEnabled(): boolean {
    return window._env_?.FEATURE_FLAG_NEW_UI === 'true';
  }

  get environment(): string {
    return window._env_?.ENVIRONMENT || 'development';
  }

  get awsRegion(): string {
    return window._env_?.AWS_REGION || 'us-east-1';
  }
}
```

## Benefits

1. **Single Image for All Environments**: Build once, deploy everywhere
2. **Secure Configuration Management**: Secrets stored in AWS Secrets Manager, not in code or images
3. **Dynamic Configuration**: Change configuration without rebuilding or redeploying containers
4. **Minimal Image Size**: Multi-stage build produces ~25MB nginx:alpine image vs ~1GB Node.js image
5. **Zero Downtime Updates**: Update secrets in Secrets Manager and restart tasks
6. **Audit Trail**: AWS CloudTrail logs all secret access
7. **Encryption at Rest**: Secrets encrypted with AWS KMS

## Deployment Workflow

1. **Build Image Once**:
   ```bash
   docker build -t myapp-frontend:v1.0.0 .
   docker tag myapp-frontend:v1.0.0 ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/myapp-frontend:v1.0.0
   docker push ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/myapp-frontend:v1.0.0
   ```

2. **Deploy to Development**:
   ```bash
   aws ecs update-service \
     --cluster dev-cluster \
     --service frontend-service \
     --task-definition myapp-frontend-dev:latest \
     --force-new-deployment
   ```

3. **Deploy to Production** (same image, different secrets):
   ```bash
   aws ecs update-service \
     --cluster prod-cluster \
     --service frontend-service \
     --task-definition myapp-frontend-prod:latest \
     --force-new-deployment
   ```

## Troubleshooting

### Verify Environment Variables in Container

```bash
# Get task ARN
TASK_ARN=$(aws ecs list-tasks --cluster prod-cluster --service-name frontend-service --query 'taskArns[0]' --output text)

# Execute command in container
aws ecs execute-command \
  --cluster prod-cluster \
  --task $TASK_ARN \
  --container frontend \
  --interactive \
  --command "/bin/sh"

# Inside container, check env-config.js
cat /usr/share/nginx/html/env-config.js
```

### Check Secrets Manager Access

```bash
# Verify task execution role can access secrets
aws secretsmanager get-secret-value \
  --secret-id /myapp/prod/frontend-config \
  --query SecretString \
  --output text
```

### View Container Logs

```bash
aws logs tail /ecs/myapp-frontend --follow
```

## Security Best Practices

1. **Use Separate Secrets per Environment**: Never share secrets between dev/staging/prod
2. **Enable Secret Rotation**: Configure automatic rotation for API keys
3. **Restrict IAM Permissions**: Grant least privilege access to secrets
4. **Enable CloudTrail**: Monitor all secret access
5. **Use KMS Encryption**: Encrypt secrets with customer-managed KMS keys
6. **Implement Secret Versioning**: Use version stages (AWSCURRENT, AWSPREVIOUS)
7. **Regular Audits**: Review secret access patterns and permissions

## Cost Optimization

- **Secrets Manager**: $0.40 per secret per month + $0.05 per 10,000 API calls
- **Fargate**: Pay only for vCPU and memory used
- **ECR**: $0.10 per GB per month for storage
- **CloudWatch Logs**: $0.50 per GB ingested

Estimated monthly cost for 3 environments: ~$5-10 (excluding Fargate compute)

## References

- [AWS Secrets Manager Documentation](https://docs.aws.amazon.com/secretsmanager/)
- [ECS Task Definition Secrets](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data-secrets.html)
- [Fargate Task Execution IAM Role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
