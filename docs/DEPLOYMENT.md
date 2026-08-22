# Deployment Guide – react-nextjs-host on AWS ECS Fargate

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Project Structure](#project-structure)
4. [Local Development with Docker Compose](#local-development-with-docker-compose)
5. [Build and Push Docker Image](#build-and-push-docker-image)
6. [AWS ECS Fargate Prerequisites](#aws-ecs-fargate-prerequisites)
7. [ECS Task Definition Explained](#ecs-task-definition-explained)
8. [ECS Service Configuration](#ecs-service-configuration)
9. [ECS Fargate Deployment Walkthrough](#ecs-fargate-deployment-walkthrough)
10. [ECS-Specific Troubleshooting](#ecs-specific-troubleshooting)
11. [ECS Fargate Scaling and Management](#ecs-fargate-scaling-and-management)
12. [Configuration Management](#configuration-management)
13. [Security Considerations](#security-considerations)
14. [Java-Specific Notes](#java-specific-notes)

---

## Overview

**Application**: react-nextjs-host  
**Technology**: Java 17 (Maven), plain JDK HTTP server  
**Runtime Base Image**: `mcr.microsoft.com/openjdk/jdk:17-ubuntu`  
**Application Port**: 8080  
**Health Endpoint**: `/api/health`  
**Target Platform**: AWS ECS Fargate  

This guide covers building, pushing, and deploying the `react-nextjs-host` Java application as a containerized service on AWS ECS Fargate.

---

## Prerequisites

### Local Development
| Tool | Version | Purpose |
|------|---------|---------|
| Docker | 24.x+ | Build and run containers |
| Docker Compose | 2.x+ | Local multi-container orchestration |
| Java JDK | 17+ | Local development (optional) |
| Maven | 3.9.x+ | Local builds (optional) |

### AWS Deployment
| Tool | Version | Purpose |
|------|---------|---------|
| AWS CLI | 2.x+ | Interact with AWS services |
| Docker | 24.x+ | Build and push images |
| Bash / PowerShell | Any | Run deployment scripts |

---

## Project Structure

```
JAVAJSGIT/
├── Dockerfile                  # Multi-stage build (Maven builder + MS OpenJDK runtime)
├── docker-compose.yml          # Local development stack (app only)
├── .dockerignore               # Excludes build artifacts, wrapper files, IDE files
├── pom.xml                     # Maven project descriptor
├── src/
│   └── main/java/com/trianz/reactnextjs/
│       ├── Application.java    # Entry point – starts HTTP server on port 8080
│       ├── controller/HealthController.java
│       └── service/HealthService.java
├── ecs/
│   ├── task-definition.json    # ECS Fargate task definition
│   └── service-definition.json # ECS service definition
├── scripts/
│   ├── build-push.sh           # Linux/macOS: build & push to ECR or Docker Hub
│   ├── build-push.bat          # Windows: build & push to ECR or Docker Hub
│   ├── deploy-image.sh         # Linux/macOS: deploy to ECS Fargate
│   └── deploy-image.bat        # Windows: deploy to ECS Fargate
└── docs/
    └── DEPLOYMENT.md           # This file
```

---

## Local Development with Docker Compose

### Start the application locally

```bash
# Build and start
docker compose up --build

# Run in background
docker compose up --build -d

# View logs
docker compose logs -f react-nextjs-host

# Stop
docker compose down
```

### Verify the application

```bash
# Health check
curl http://localhost:8080/api/health
# Expected: {"status":"UP"}
```

### Environment variable overrides

Edit `docker-compose.yml` or create a `.env` file in the project root:

```env
JAVA_OPTS=-Xmx768m -Xms256m -XX:+UseContainerSupport
APP_ENV=local
TZ=America/New_York
```

---

## Build and Push Docker Image

### Linux / macOS

```bash
chmod +x scripts/build-push.sh
./scripts/build-push.sh
```

### Windows

```cmd
scripts\build-push.bat
```

The script will prompt you to:
1. Enter an image tag (default: `latest`)
2. Select a registry: **1. AWS ECR** or **2. Docker Hub**
3. Provide registry-specific credentials

**ECR flow**: The script automatically retrieves your AWS Account ID, logs in to ECR, creates the repository if it does not exist, builds the image, and pushes it.

**Docker Hub flow**: Prompts for username, password/token, and repository name.

---

## AWS ECS Fargate Prerequisites

### 1. AWS CLI Configuration

```bash
aws configure
# Enter: AWS Access Key ID, Secret Access Key, Default region, Output format
```

### 2. IAM Roles

#### ecsTaskExecutionRole (required)
Allows ECS to pull images from ECR and write logs to CloudWatch.

```bash
# Create the role
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach the managed policy
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

#### ecsTaskRole (optional – for application AWS API access)
```bash
aws iam create-role \
  --role-name ecsTaskRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'
```

### 3. VPC and Networking

Fargate tasks require **awsvpc** network mode. You need:
- A VPC with at least **2 subnets** in different Availability Zones
- A **Security Group** that allows inbound TCP on port **8080**

```bash
# Example: allow inbound on port 8080
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 8080 \
  --cidr 0.0.0.0/0
```

### 4. CloudWatch Log Group

```bash
aws logs create-log-group \
  --log-group-name /ecs/react-nextjs-host \
  --region us-east-1
```

### 5. ECR Repository

```bash
aws ecr create-repository \
  --repository-name react-nextjs-host \
  --region us-east-1
```

---

## ECS Task Definition Explained

File: `ecs/task-definition.json`

| Field | Value | Notes |
|-------|-------|-------|
| `family` | `react-nextjs-host-task` | Task definition family name |
| `requiresCompatibilities` | `["FARGATE"]` | Fargate launch type |
| `networkMode` | `awsvpc` | Required for Fargate |
| `cpu` | `"512"` | 0.5 vCPU |
| `memory` | `"1024"` | 1 GB RAM |
| `executionRoleArn` | `ecsTaskExecutionRole` | ECR pull + CloudWatch logs |
| `taskRoleArn` | `ecsTaskRole` | Application AWS API access |

### Valid Fargate CPU/Memory Combinations

| CPU | Memory Options |
|-----|---------------|
| 256 (.25 vCPU) | 512, 1024, 2048 MB |
| **512 (.5 vCPU)** | **1024**, 2048, 3072, 4096 MB |
| 1024 (1 vCPU) | 2048–8192 MB |
| 2048 (2 vCPU) | 4096–16384 MB |
| 4096 (4 vCPU) | 8192–30720 MB |

### Container Definition Highlights

- **Image**: Replaced at deploy time with the actual ECR URI
- **Port**: 8080 (TCP)
- **JAVA_OPTS**: Container-aware JVM flags (`-XX:+UseContainerSupport`, `-XX:MaxRAMPercentage=75.0`)
- **Logging**: CloudWatch Logs via `awslogs` driver → `/ecs/react-nextjs-host`

---

## ECS Service Configuration

File: `ecs/service-definition.json`

| Field | Value | Notes |
|-------|-------|-------|
| `serviceName` | `react-nextjs-host-service` | ECS service name |
| `launchType` | `FARGATE` | Serverless compute |
| `desiredCount` | `2` | Two running tasks for HA |
| `maximumPercent` | `200` | Rolling deploy headroom |
| `minimumHealthyPercent` | `50` | Minimum tasks during deploy |
| `assignPublicIp` | `ENABLED` | Required for public ECR access |

---

## ECS Fargate Deployment Walkthrough

### Step 1: Build and push the image

```bash
./scripts/build-push.sh
# Select ECR, enter region and repo name
# Note the full image URI printed at the end
```

### Step 2: Run the deployment script

```bash
chmod +x scripts/deploy-image.sh
./scripts/deploy-image.sh
```

You will be prompted for:
- AWS Region (e.g., `us-east-1`)
- ECS Cluster name (created automatically if it does not exist)
- ECR Image URI (from Step 1)
- Subnet IDs (comma-separated)
- Security Group ID
- Whether to create an Application Load Balancer

### Step 3: Verify the deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster react-nextjs-host-cluster \
  --services react-nextjs-host-service \
  --region us-east-1

# List running tasks
aws ecs list-tasks \
  --cluster react-nextjs-host-cluster \
  --region us-east-1

# Tail application logs
aws logs tail /ecs/react-nextjs-host --follow --region us-east-1
```

### Step 4: Access the application

If you created a load balancer, the DNS name is printed at the end of the deploy script:
```
http://<alb-dns-name>/api/health
```

Without a load balancer, find the task's public IP:
```bash
TASK_ARN=$(aws ecs list-tasks --cluster react-nextjs-host-cluster --query "taskArns[0]" --output text)
aws ecs describe-tasks --cluster react-nextjs-host-cluster --tasks $TASK_ARN \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" --output text
# Then look up the ENI's public IP in EC2 console or via CLI
```

---

## ECS-Specific Troubleshooting

### Task fails to start (STOPPED state)

```bash
# Get stopped reason
aws ecs describe-tasks \
  --cluster react-nextjs-host-cluster \
  --tasks <TASK_ARN> \
  --query "tasks[0].{Status:lastStatus,StoppedReason:stoppedReason,Containers:containers[*].{Name:name,Reason:reason,ExitCode:exitCode}}"
```

Common causes:
| Error | Cause | Fix |
|-------|-------|-----|
| `CannotPullContainerError` | ECR auth failure or wrong image URI | Verify `executionRoleArn` has ECR pull permissions |
| `ResourceInitializationError` | Secrets Manager / SSM access denied | Add permissions to `executionRoleArn` |
| `OutOfMemoryError` in logs | JVM heap exceeds container memory | Increase task memory or reduce `-Xmx` |
| Exit code 137 | OOM kill | Increase task memory |
| Exit code 1 | Application startup failure | Check CloudWatch logs |

### Network connectivity issues

```bash
# Verify security group allows port 8080
aws ec2 describe-security-groups --group-ids sg-xxxxxxxx \
  --query "SecurityGroups[0].IpPermissions"

# Check task ENI
aws ecs describe-tasks --cluster react-nextjs-host-cluster --tasks <TASK_ARN> \
  --query "tasks[0].attachments"
```

### CloudWatch logs not appearing

- Verify the log group `/ecs/react-nextjs-host` exists
- Confirm `executionRoleArn` has `logs:CreateLogStream` and `logs:PutLogEvents` permissions
- Check `awslogs-region` matches the deployment region

### JVM startup too slow (health check failures)

The JVM can take 30–60 seconds to fully initialize. If the ALB marks tasks unhealthy:
- Increase `healthCheckGracePeriodSeconds` to `300` in the service definition
- Adjust ALB target group health check thresholds

---

## ECS Fargate Scaling and Management

### Manual scaling

```bash
aws ecs update-service \
  --cluster react-nextjs-host-cluster \
  --service react-nextjs-host-service \
  --desired-count 4 \
  --region us-east-1
```

### Auto Scaling

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/react-nextjs-host-cluster/react-nextjs-host-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# CPU-based scaling policy
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/react-nextjs-host-cluster/react-nextjs-host-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'
```

### Blue/Green Deployment with CodeDeploy

1. Create a CodeDeploy application and deployment group for ECS
2. Configure two target groups (blue and green) on the ALB
3. Use `aws deploy create-deployment` to trigger blue/green rollouts

### Force new deployment (rolling restart)

```bash
aws ecs update-service \
  --cluster react-nextjs-host-cluster \
  --service react-nextjs-host-service \
  --force-new-deployment \
  --region us-east-1
```

---

## Configuration Management

### Environment Variables

All runtime configuration is passed via ECS task definition environment variables. To update:

1. Edit `ecs/task-definition.json` → `containerDefinitions[0].environment`
2. Re-register the task definition
3. Update the service to use the new revision

### AWS Secrets Manager (recommended for secrets)

```json
"secrets": [
  {
    "name": "DB_PASSWORD",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:react-nextjs-host/db-password"
  }
]
```

Add `secretsmanager:GetSecretValue` to the `executionRoleArn` policy.

### JVM Tuning

Adjust `JAVA_OPTS` in the task definition environment:

```
-Xmx512m -Xms256m          # Heap bounds (tune to ~75% of task memory)
-XX:+UseContainerSupport    # Enable container-aware memory detection
-XX:MaxRAMPercentage=75.0   # Auto-size heap to 75% of container RAM
-XX:+UseG1GC                # G1 garbage collector (good for low-latency)
-XX:+UseStringDeduplication # Reduce heap usage for string-heavy apps
```

---

## Security Considerations

1. **Non-root user**: The container runs as `appuser` (non-root) – never override with `--user root`
2. **No secrets in images**: Use AWS Secrets Manager or SSM Parameter Store for all secrets
3. **Minimal runtime image**: `mcr.microsoft.com/openjdk/jdk:17-ubuntu` – no build tools in production
4. **Security Groups**: Restrict inbound to only required ports (8080) and trusted CIDR ranges
5. **ECR image scanning**: Enable ECR image scanning on push:
   ```bash
   aws ecr put-image-scanning-configuration \
     --repository-name react-nextjs-host \
     --image-scanning-configuration scanOnPush=true
   ```
6. **Task role least privilege**: Grant `ecsTaskRole` only the AWS permissions the application actually needs
7. **VPC isolation**: Deploy tasks in private subnets with a NAT Gateway for outbound traffic in production

---

## Java-Specific Notes

### JVM Container Awareness

Java 17 with `-XX:+UseContainerSupport` (enabled by default in JDK 8u191+) correctly reads cgroup memory limits. The flag `-XX:MaxRAMPercentage=75.0` automatically sizes the heap to 75% of the container's memory limit, avoiding OOM kills.

### Graceful Shutdown

The `ENTRYPOINT` uses `exec java ...` so the JVM receives `SIGTERM` directly (PID 1). The JVM's shutdown hooks run on `SIGTERM`, allowing in-flight requests to complete before the container stops. ECS sends `SIGTERM` and waits `stopTimeout` seconds (default 30) before `SIGKILL`.

### Startup Time

The JVM typically takes 2–5 seconds to start for this lightweight application. If you add Spring Boot or other frameworks, startup may increase to 10–30 seconds. Adjust ALB health check grace periods accordingly.

### Logging

Application output goes to stdout/stderr, which ECS captures and forwards to CloudWatch Logs. View logs:

```bash
aws logs tail /ecs/react-nextjs-host --follow --region us-east-1
```

For structured logging, consider adding SLF4J + Logback with JSON layout to the project dependencies.
