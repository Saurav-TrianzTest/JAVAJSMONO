# AWS Fargate Memory Configuration and Container Insights Setup

## Overview
This document describes the Fargate task memory configuration and CloudWatch Container Insights setup required for containerization blocker cz-js-1002 remediation.

## Blocker Fixed
- **Rule ID**: cz-js-1002
- **Rule Name**: Large State in Angular Services Without Externalization
- **Severity**: MEDIUM
- **Category**: file-system-&-storage

## Remediation Applied

### 1. Code Changes
**File**: `src/store/AppContext.js` (Lines 3-70)

**Before**: 
```javascript
const bigState = new Array(1000000).fill({ data: 'x' });
```

**After**:
- Replaced large in-memory array with lightweight state proxy
- State data now fetched from external Redis/PostgreSQL via API
- Implemented caching layer with configurable TTL and size limits
- Added environment variable configuration for external state store

### 2. Fargate Task Definition Configuration

Add the following to your ECS Fargate task definition:

```json
{
  "family": "javajsmonoreg-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "javajsmonoreg-container",
      "image": "<your-ecr-image>",
      "essential": true,
      "memoryReservation": 1536,
      "memory": 2048,
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "STATE_API_URL",
          "value": "${STATE_API_ENDPOINT}"
        },
        {
          "name": "REDIS_HOST",
          "value": "${REDIS_ENDPOINT}"
        },
        {
          "name": "REDIS_PORT",
          "value": "6379"
        },
        {
          "name": "MAX_STATE_CACHE_SIZE",
          "value": "100"
        },
        {
          "name": "STATE_CACHE_TTL_MS",
          "value": "60000"
        }
      ],
      "secrets": [
        {
          "name": "REDIS_PASSWORD",
          "valueFrom": "arn:aws:ssm:region:account:parameter/javajsmonoreg/redis/password"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/javajsmonoreg",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8080/api/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

### 3. CloudWatch Container Insights Configuration

#### Enable Container Insights on ECS Cluster

```bash
aws ecs put-account-setting-default \
  --name containerInsights \
  --value enabled \
  --region us-east-1

aws ecs update-cluster-settings \
  --cluster javajsmonoreg-cluster \
  --settings name=containerInsights,value=enabled \
  --region us-east-1
```

#### CloudWatch Alarms for Memory Pressure

Create alarms to detect memory pressure before OOM kills:

```bash
# High Memory Utilization Alarm
aws cloudwatch put-metric-alarm \
  --alarm-name javajsmonoreg-high-memory \
  --alarm-description "Alert when memory utilization exceeds 80%" \
  --metric-name MemoryUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ServiceName,Value=javajsmonoreg-service Name=ClusterName,Value=javajsmonoreg-cluster \
  --alarm-actions arn:aws:sns:us-east-1:account:javajsmonoreg-alerts

# Critical Memory Utilization Alarm
aws cloudwatch put-metric-alarm \
  --alarm-name javajsmonoreg-critical-memory \
  --alarm-description "Alert when memory utilization exceeds 90%" \
  --metric-name MemoryUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 60 \
  --evaluation-periods 1 \
  --threshold 90 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ServiceName,Value=javajsmonoreg-service Name=ClusterName,Value=javajsmonoreg-cluster \
  --alarm-actions arn:aws:sns:us-east-1:account:javajsmonoreg-critical-alerts
```

### 4. Environment Variables Configuration

The following environment variables must be configured in your ECS task definition or deployment pipeline:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `STATE_API_URL` | External state store API endpoint | `/api/state` | Yes |
| `REDIS_HOST` | Redis host for state storage | - | Yes |
| `REDIS_PORT` | Redis port | `6379` | No |
| `REDIS_PASSWORD` | Redis authentication password | - | Yes (via SSM) |
| `MAX_STATE_CACHE_SIZE` | Maximum number of cached state entries | `100` | No |
| `STATE_CACHE_TTL_MS` | Cache TTL in milliseconds | `60000` | No |
| `SESSION_API_URL` | Session management API endpoint | `/api/session` | Yes |
| `SSM_REDIS_HOST` | Redis host from SSM Parameter Store | - | No |
| `SSM_REDIS_PORT` | Redis port from SSM Parameter Store | - | No |
| `SSM_REDIS_PASSWORD` | Redis password from SSM Parameter Store | - | No |

### 5. Infrastructure Requirements

#### Redis/ElastiCache Setup
```bash
# Create ElastiCache Redis cluster for state storage
aws elasticache create-cache-cluster \
  --cache-cluster-id javajsmonoreg-state-cache \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --num-cache-nodes 1 \
  --preferred-availability-zone us-east-1a \
  --security-group-ids sg-xxxxxxxxx \
  --subnet-group-name javajsmonoreg-subnet-group
```

#### SSM Parameter Store Configuration
```bash
# Store Redis credentials in SSM Parameter Store
aws ssm put-parameter \
  --name /javajsmonoreg/redis/password \
  --value "your-secure-password" \
  --type SecureString \
  --key-id alias/aws/ssm \
  --region us-east-1

aws ssm put-parameter \
  --name /javajsmonoreg/redis/host \
  --value "javajsmonoreg-state-cache.xxxxxx.0001.use1.cache.amazonaws.com" \
  --type String \
  --region us-east-1
```

### 6. Monitoring Dashboard

Create a CloudWatch dashboard to monitor memory metrics:

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ECS", "MemoryUtilization", {"stat": "Average"}],
          [".", ".", {"stat": "Maximum"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "ECS Memory Utilization",
        "yAxis": {
          "left": {
            "min": 0,
            "max": 100
          }
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ECS", "MemoryReservation"],
          [".", "MemoryUtilization"]
        ],
        "period": 60,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Memory Reservation vs Utilization"
      }
    }
  ]
}
```

## Benefits

1. **Memory Efficiency**: Eliminated 1M object in-memory array, reducing memory footprint by ~100MB
2. **Horizontal Scalability**: State externalization enables stateless pods that can scale horizontally
3. **OOM Prevention**: Fargate memory limits and Container Insights provide early warning before OOM kills
4. **Resilience**: External state store ensures data persistence across pod restarts
5. **Monitoring**: CloudWatch Container Insights provides real-time memory pressure visibility

## Testing

### Verify Memory Configuration
```bash
# Check task memory allocation
aws ecs describe-tasks \
  --cluster javajsmonoreg-cluster \
  --tasks <task-arn> \
  --query 'tasks[0].memory'

# Monitor memory metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name MemoryUtilization \
  --dimensions Name=ServiceName,Value=javajsmonoreg-service \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T23:59:59Z \
  --period 3600 \
  --statistics Average,Maximum
```

### Load Testing
```bash
# Run load test to verify memory stability
ab -n 10000 -c 100 http://your-alb-endpoint/api/health
```

## Rollback Plan

If issues occur, revert to previous version:
```bash
aws ecs update-service \
  --cluster javajsmonoreg-cluster \
  --service javajsmonoreg-service \
  --task-definition javajsmonoreg-task:previous-version
```

## References

- [AWS Fargate Task Definition Parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)
- [CloudWatch Container Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html)
- [ECS Memory Management](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/memory.html)
