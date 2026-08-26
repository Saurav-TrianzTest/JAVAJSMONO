# Containerization Fix: cz-js-1026 - Large State in React Context Without Externalization

## Overview
This document describes the remediation applied to fix blocker **cz-js-1026** - "Large State in React Context Without Externalization" using the strategy: **Right-Size Fargate Task Memory and Add Health Checks to Mitigate OOM Kills**.

## Problem Statement
React Context or Redux stores holding large application state in memory without external persistence create memory pressure in containers with resource limits, causing OOM (Out of Memory) kills. Container memory constraints require proper memory sizing and health monitoring to ensure horizontal scalability and resilience in Kubernetes/ECS pod replicas.

## Remediation Strategy
As a fast interim fix, we have:
1. Profiled and right-sized the Fargate task memory allocation
2. Added container health checks with memory threshold monitoring
3. Configured ECS Service restart policies to recover quickly from OOM events
4. Implemented CloudWatch alarms for proactive memory monitoring

## Changes Applied

### 1. Application Code Changes

#### File: `src/store/AppContext.js`
**Lines Modified:** 4-4 (expanded to include comprehensive memory monitoring)

**Changes:**
- Added memory configuration with environment variable support:
  - `FARGATE_TASK_MEMORY_MB`: Total task memory (default: 2048MB)
  - `MEMORY_WARNING_THRESHOLD`: Warning threshold percentage (default: 70%)
  - `MEMORY_CRITICAL_THRESHOLD`: Critical threshold percentage (default: 85%)
  - `HEALTH_CHECK_INTERVAL_MS`: Health check interval (default: 30000ms)

- Implemented `MemoryMonitor` class:
  - Monitors JavaScript heap memory usage using `performance.memory` API
  - Triggers cache cleanup at critical threshold to prevent OOM
  - Reports health status: 'healthy', 'warning', or 'critical'
  - Logs memory usage metrics for CloudWatch Container Insights

- Added `reportHealthStatus()` function:
  - Reports frontend memory status to backend health endpoint
  - Integrates with ECS container health checks
  - Provides real-time memory metrics for monitoring

- Automatic memory monitoring:
  - Starts on module load in browser environments
  - Can be disabled via `ENABLE_MEMORY_MONITORING=false`

### 2. Infrastructure Configuration

#### File: `ecs-task-definition.json` (NEW)
**Purpose:** ECS Fargate task definition with memory configuration

**Key Settings:**
- **CPU:** 1024 (1 vCPU)
- **Memory:** 2048 MB (right-sized based on profiling)
- **Health Check:**
  - Command: `curl -f http://localhost/api/health || exit 1`
  - Interval: 30 seconds
  - Timeout: 5 seconds
  - Retries: 3
  - Start Period: 60 seconds (grace period)

**Environment Variables:**
- `FARGATE_TASK_MEMORY_MB=2048`
- `MEMORY_WARNING_THRESHOLD=70`
- `MEMORY_CRITICAL_THRESHOLD=85`
- `HEALTH_CHECK_INTERVAL_MS=30000`
- `ENABLE_MEMORY_MONITORING=true`

**Secrets (from AWS Secrets Manager):**
- `API_KEY`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`

#### File: `ecs-service-definition.json` (NEW)
**Purpose:** ECS service configuration with restart policies

**Key Settings:**
- **Desired Count:** 2 (high availability)
- **Health Check Grace Period:** 60 seconds
- **Deployment Configuration:**
  - Maximum Percent: 200% (allows rolling updates)
  - Minimum Healthy Percent: 100% (ensures availability)
  - Circuit Breaker: Enabled with automatic rollback
- **Auto-restart:** Enabled via health check failures

#### File: `cloudwatch-alarms.json` (NEW)
**Purpose:** CloudWatch monitoring and alerting configuration

**Alarms:**
1. **Memory Warning (70% threshold):**
   - Triggers SNS notification
   - Evaluation: 2 periods of 5 minutes
   - Action: Alert operations team

2. **Memory Critical (85% threshold):**
   - Triggers SNS notification + auto-scaling
   - Evaluation: 2 periods of 1 minute
   - Action: Scale out ECS service

3. **Unhealthy Tasks:**
   - Monitors ALB target group health
   - Triggers alert when healthy host count < 1
   - Indicates health check failures

4. **OOM Kills:**
   - Monitors container restart events
   - Indicates memory needs to be increased
   - Critical alert for capacity planning

**Dashboard:**
- Real-time memory utilization visualization
- Health check status monitoring
- Threshold annotations for quick assessment

## Deployment Instructions

### 1. Deploy Application Code
```bash
# Build and push Docker image
docker build -t react-nextjs-host:latest .
docker tag react-nextjs-host:latest ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/react-nextjs-host:latest
docker push ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/react-nextjs-host:latest
```

### 2. Register ECS Task Definition
```bash
# Update placeholders in ecs-task-definition.json
# - ACCOUNT_ID: Your AWS account ID
# - REGION: Your AWS region
# - Secret ARNs: Your Secrets Manager ARNs

aws ecs register-task-definition \
  --cli-input-json file://ecs-task-definition.json
```

### 3. Create/Update ECS Service
```bash
# Update placeholders in ecs-service-definition.json
# - Subnet IDs
# - Security Group IDs
# - Target Group ARN

aws ecs create-service \
  --cli-input-json file://ecs-service-definition.json
```

### 4. Configure CloudWatch Alarms
```bash
# Update placeholders in cloudwatch-alarms.json
# - REGION: Your AWS region
# - ACCOUNT_ID: Your AWS account ID
# - SNS Topic ARNs
# - Auto-scaling policy ARN

# Create alarms
for alarm in $(jq -r '.alarms[] | @base64' cloudwatch-alarms.json); do
  echo $alarm | base64 -d | jq '.' | \
  aws cloudwatch put-metric-alarm --cli-input-json file:///dev/stdin
done

# Create dashboard
aws cloudwatch put-dashboard \
  --dashboard-name react-nextjs-host-memory-monitoring \
  --dashboard-body "$(jq -c '.dashboards[0].dashboardBody' cloudwatch-alarms.json)"
```

## Monitoring and Validation

### 1. Verify Health Checks
```bash
# Check ECS service health
aws ecs describe-services \
  --cluster production-cluster \
  --services react-nextjs-host-service

# Check target group health
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:REGION:ACCOUNT_ID:targetgroup/react-nextjs-tg/XXXXXXXXXXXX
```

### 2. Monitor Memory Usage
```bash
# View CloudWatch Container Insights
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name MemoryUtilization \
  --dimensions Name=ServiceName,Value=react-nextjs-host-service Name=ClusterName,Value=production-cluster \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum
```

### 3. Test Health Endpoint
```bash
# Test health endpoint
curl http://your-alb-dns/api/health

# Expected response:
# {"status":"UP","timestamp":"2024-01-01T00:00:00Z"}
```

### 4. Simulate Memory Pressure (Testing)
```javascript
// In browser console, simulate high memory usage
const memoryTest = [];
for (let i = 0; i < 1000000; i++) {
  memoryTest.push(new Array(1000).fill('test'));
}

// Check memory monitor status
import { memoryMonitor } from './src/store/AppContext';
console.log(memoryMonitor.checkMemoryUsage());
```

## Memory Sizing Recommendations

### Current Configuration
- **Task Memory:** 2048 MB (2 GB)
- **Warning Threshold:** 70% (1434 MB)
- **Critical Threshold:** 85% (1741 MB)

### Scaling Guidelines

| Application State Size | Recommended Task Memory | Warning Threshold | Critical Threshold |
|------------------------|-------------------------|-------------------|-------------------|
| Small (<500 MB)        | 1024 MB (1 GB)         | 70%               | 85%               |
| Medium (500-1000 MB)   | 2048 MB (2 GB)         | 70%               | 85%               |
| Large (1-2 GB)         | 4096 MB (4 GB)         | 70%               | 85%               |
| Very Large (>2 GB)     | 8192 MB (8 GB)         | 60%               | 75%               |

### When to Increase Memory
- Memory Critical alarms trigger frequently (>2 times per day)
- OOM kill alarms are triggered
- Health checks fail due to memory pressure
- Application performance degrades under load

### When to Decrease Memory
- Memory usage consistently below 50%
- No memory warnings in past 30 days
- Cost optimization required

## Auto-Scaling Configuration

### Target Tracking Scaling Policy
```json
{
  "TargetValue": 75.0,
  "PredefinedMetricSpecification": {
    "PredefinedMetricType": "ECSServiceAverageMemoryUtilization"
  },
  "ScaleOutCooldown": 60,
  "ScaleInCooldown": 300
}
```

### Step Scaling Policy (Alternative)
```json
{
  "AdjustmentType": "PercentChangeInCapacity",
  "StepAdjustments": [
    {
      "MetricIntervalLowerBound": 0,
      "MetricIntervalUpperBound": 10,
      "ScalingAdjustment": 10
    },
    {
      "MetricIntervalLowerBound": 10,
      "ScalingAdjustment": 30
    }
  ],
  "MetricAggregationType": "Average"
}
```

## Troubleshooting

### Issue: Frequent OOM Kills
**Symptoms:** Tasks restart frequently, OOM kill alarms trigger
**Solution:**
1. Increase task memory in `ecs-task-definition.json`
2. Review application code for memory leaks
3. Increase cache cleanup frequency
4. Reduce `MAX_STATE_CACHE_SIZE`

### Issue: Health Checks Failing
**Symptoms:** Tasks marked unhealthy, service restarts containers
**Solution:**
1. Increase `healthCheckGracePeriodSeconds` to 120
2. Check health endpoint response time
3. Review application logs for errors
4. Verify network connectivity to health endpoint

### Issue: High Memory Usage but No OOM
**Symptoms:** Memory usage at 80-90% but stable
**Solution:**
1. This is normal if application is handling load efficiently
2. Monitor for trends - if increasing, scale up
3. Ensure critical threshold alarms are configured
4. Consider increasing memory for headroom

### Issue: Memory Monitor Not Working
**Symptoms:** No memory metrics in logs
**Solution:**
1. Verify `ENABLE_MEMORY_MONITORING=true` is set
2. Check browser compatibility (Chrome/Edge required for `performance.memory`)
3. Review browser console for errors
4. Ensure health endpoint `/api/health/frontend` exists

## Best Practices

1. **Regular Monitoring:** Review CloudWatch dashboards weekly
2. **Load Testing:** Test memory usage under peak load before production
3. **Gradual Scaling:** Increase memory in 512 MB increments
4. **Cost Optimization:** Right-size after 30 days of production metrics
5. **Alerting:** Ensure SNS topics are configured and tested
6. **Documentation:** Update this document when changing memory configuration

## Related Fixes

This fix complements other containerization improvements:
- **cz-js-1002:** Large state externalized to Redis/PostgreSQL backend
- **cz-js-1031:** Externalized session state using Redis with AWS SSM
- **cz-js-1008:** Angular localStorage replaced with ElastiCache Redis

## References

- [AWS ECS Task Definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- [AWS ECS Health Checks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#container_definition_healthcheck)
- [CloudWatch Container Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html)
- [ECS Service Auto Scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)

## Support

For issues or questions regarding this fix:
1. Check CloudWatch logs: `/ecs/react-nextjs-host`
2. Review ECS service events in AWS Console
3. Contact DevOps team for infrastructure issues
4. Review application logs for memory-related errors
