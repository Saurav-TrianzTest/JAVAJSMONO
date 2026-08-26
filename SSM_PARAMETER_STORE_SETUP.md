# AWS SSM Parameter Store Setup for Runtime Configuration

## Overview
This application uses AWS Systems Manager (SSM) Parameter Store to manage runtime configuration for jQuery/React applications running on ECS Fargate. This approach eliminates the need for separate Docker images per environment.

## Parameter Hierarchy

All configuration parameters are organized under the following hierarchy:
```
/react-nextjs/{environment}/{parameter-name}
```

### Production Environment Parameters

1. **API URL**
   - Path: `/react-nextjs/production/api-url`
   - Type: String
   - Description: Backend API endpoint URL
   - Example Value: `https://api.production.example.com`

2. **Feature Flag**
   - Path: `/react-nextjs/production/feature-flag`
   - Type: String
   - Description: Feature toggle flag
   - Example Value: `true` or `false`

### Staging Environment Parameters

1. **API URL**
   - Path: `/react-nextjs/staging/api-url`
   - Type: String
   - Example Value: `https://api.staging.example.com`

2. **Feature Flag**
   - Path: `/react-nextjs/staging/feature-flag`
   - Type: String
   - Example Value: `true` or `false`

### Development Environment Parameters

1. **API URL**
   - Path: `/react-nextjs/development/api-url`
   - Type: String
   - Example Value: `https://api.dev.example.com`

2. **Feature Flag**
   - Path: `/react-nextjs/development/feature-flag`
   - Type: String
   - Example Value: `true` or `false`

## AWS CLI Commands to Create Parameters

### Production
```bash
aws ssm put-parameter \
  --name "/react-nextjs/production/api-url" \
  --value "https://api.production.example.com" \
  --type "String" \
  --description "Production API URL for React/jQuery application" \
  --tags "Key=Environment,Value=production" "Key=Application,Value=react-nextjs-host"

aws ssm put-parameter \
  --name "/react-nextjs/production/feature-flag" \
  --value "true" \
  --type "String" \
  --description "Production feature flag" \
  --tags "Key=Environment,Value=production" "Key=Application,Value=react-nextjs-host"
```

### Staging
```bash
aws ssm put-parameter \
  --name "/react-nextjs/staging/api-url" \
  --value "https://api.staging.example.com" \
  --type "String" \
  --description "Staging API URL for React/jQuery application" \
  --tags "Key=Environment,Value=staging" "Key=Application,Value=react-nextjs-host"

aws ssm put-parameter \
  --name "/react-nextjs/staging/feature-flag" \
  --value "true" \
  --type "String" \
  --description "Staging feature flag" \
  --tags "Key=Environment,Value=staging" "Key=Application,Value=react-nextjs-host"
```

### Development
```bash
aws ssm put-parameter \
  --name "/react-nextjs/development/api-url" \
  --value "https://api.dev.example.com" \
  --type "String" \
  --description "Development API URL for React/jQuery application" \
  --tags "Key=Environment,Value=development" "Key=Application,Value=react-nextjs-host"

aws ssm put-parameter \
  --name "/react-nextjs/development/feature-flag" \
  --value "false" \
  --type "String" \
  --description "Development feature flag" \
  --tags "Key=Environment,Value=development" "Key=Application,Value=react-nextjs-host"
```

## IAM Permissions Required

The ECS Task Execution Role must have permissions to read SSM parameters:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameters",
        "ssm:GetParameter",
        "ssm:GetParametersByPath"
      ],
      "Resource": [
        "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/react-nextjs/*"
      ]
    }
  ]
}
```

## ECS Task Definition Integration

The parameters are injected into the container as environment variables via the `secrets` section:

```json
"secrets": [
  {
    "name": "API_URL",
    "valueFrom": "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/react-nextjs/production/api-url"
  },
  {
    "name": "FEATURE_FLAG",
    "valueFrom": "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/react-nextjs/production/feature-flag"
  }
]
```

## Application Code Changes

### Before (Build-Time Configuration)
```javascript
// Configuration baked at build time
export const config = {
  apiUrl: process.env.REACT_APP_API_URL,  // baked at build time
  feature: process.env.REACT_APP_FEATURE_FLAG,
};
```

### After (Runtime Configuration)
```javascript
// Configuration loaded at runtime
const getRuntimeConfig = () => {
  if (typeof window !== 'undefined') {
    return {
      apiUrl: window.__ENV__?.API_URL || '',
      feature: window.__ENV__?.FEATURE_FLAG || 'false',
    };
  }
  return {
    apiUrl: process.env.API_URL || '',
    feature: process.env.FEATURE_FLAG || 'false',
  };
};

export const config = getRuntimeConfig();
```

## Benefits

1. **Single Docker Image**: One image works across all environments
2. **No Rebuild Required**: Change configuration without rebuilding
3. **Centralized Management**: All config in SSM Parameter Store
4. **Audit Trail**: SSM tracks all parameter changes
5. **Secure**: Parameters can be encrypted with KMS
6. **Version Control**: SSM supports parameter versioning

## Deployment Workflow

1. Build Docker image once
2. Push to ECR
3. Update SSM parameters for target environment
4. Deploy ECS task with environment-specific parameter paths
5. Container reads configuration at runtime

## Troubleshooting

### Container fails to start
- Check ECS Task Execution Role has SSM permissions
- Verify parameter paths exist in SSM
- Check CloudWatch logs for error messages

### Configuration not updating
- Restart ECS tasks to pick up new parameter values
- Verify parameter paths match environment
- Check parameter values in SSM console

### Permission denied errors
- Verify IAM role has `ssm:GetParameter` permission
- Check resource ARN matches parameter path
- Ensure KMS key permissions if using encrypted parameters
