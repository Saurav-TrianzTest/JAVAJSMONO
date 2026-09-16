# Deployment Guide – react-nextjs-host on AWS ECS Fargate

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Project Structure](#project-structure)
4. [Local Development with Docker Compose](#local-development-with-docker-compose)
5. [Build & Push Docker Image](#build--push-docker-image)
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

**Application**: `react-nextjs-host`  
**Technology**: Java 17 (plain JDK HttpServer – no Spring Boot)  
**Build Tool**: Apache Maven 3.9+  
**Package**: Executable JAR (`react-nextjs-host.jar`)  
**Application Port**: `8080`  
**Health Endpoint**: `GET /api/health` → `{"status":"UP"}`  
**Target Platform**: AWS ECS Fargate  
**Runtime Base Image**: `amazoncorretto:17`

---

## Prerequisites

### Local Development
| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Docker Desktop | 24.x | Build and run containers |
| Docker Compose | 2.x | Local multi-container orchestration |
| Java JDK | 17 | Local builds (optional – Docker handles it) |
| Maven | 3.9+ | Local builds (optional – Docker handles it) |

### AWS Deployment
| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| AWS CLI | 2.x | Interact with AWS services |
| Python 3 | 3.8+ | Used by deploy scripts for JSON manipulation |
| jq | 1.6+ | JSON parsing in shell scripts (optional) |

---

## Project Structure

```
AWS-ECSCMP/
├── Dockerfile                  # Multi-stage build (builder + amazoncorretto:17 runtime)
├── docker-compose.yml          # Local development stack (app only)
├── .dockerignore               # Excludes build artefacts, wrappers, IDE files
├── pom.xml                     # Maven build descriptor
├── src/
│   └── main/java/com/trianz/reactnextjs/
│       ├── Application.java    # Entry point – starts HttpServer on :8080
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

### Start the application

```bash
# From the repository root
docker compose up --build
```

The application will be available at: `http://localhost:8080`

### Verify health

```bash
curl http://localhost:8080/api/health
# Expected: {"status":"UP"}
```

### Stop the application

```bash
docker compose down
```

### Environment variable overrides

Edit `docker-compose.yml` or pass variables inline:

```bash
APP_PORT=8080 docker compose up
```

---

## Build & Push Docker Image

### Linux / macOS

```bash
chmod +x scripts/build-push.sh
./scripts/build-push.sh
```

### Windows

```cmd
scripts\build-push.bat
```

Both scripts will interactively prompt you to:
1. Choose a registry (AWS ECR or Docker Hub)
2. Provide registry credentials / region
3. Enter an image tag (defaults to `latest`)

The scripts automatically:
- Sanitize the image name (lowercase, hyphens)
- Create the ECR repository if it does not exist
- Build the Docker image from the repository root
- Push the image to the selected registry

---

## AWS ECS Fargate Prerequisites

### 1. AWS CLI Configuration

```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Default Region, Output format
```

### 2. VPC and Networking

Fargate tasks require **awsvpc** network mode. You need:
- A VPC with at least **two subnets** in different Availability Zones
- A **security group** that allows:
  - Inbound TCP on port **8080** (from ALB or direct access)
  - Outbound TCP on port **443** (for ECR image pull and CloudWatch logs)

```bash
# List your VPCs
aws ec2 describe-vpcs --query "Vpcs[*].{ID:VpcId,CIDR:CidrBlock}" --output table

# List subnets in a VPC
aws ec2 describe-subnets --filters "Name=vpc-id,Values=<VPC_ID>" \
  --query "Subnets[*].{ID:SubnetId,AZ:AvailabilityZone,Public:MapPublicIpOnLaunch}" --output table

# Create a security group
aws ec2 create-security-group \
  --group-name react-nextjs-host-sg \
  --description "Security group for react-nextjs-host ECS tasks" \
  --vpc-id <VPC_ID>

# Allow inbound on port 8080
aws ec2 authorize-security-group-ingress \
  --group-id <SG_ID> \
  --protocol tcp --port 8080 --cidr 0.0.0.0/0
```

### 3. IAM Roles

#### ECS Task Execution Role (required)
Allows ECS to pull images from ECR and write logs to CloudWatch.

```bash
# Create the role
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

# Attach the managed policy
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

#### ECS Task Role (optional – for application AWS API calls)
```bash
aws iam create-role \
  --role-name ecsTaskRole \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'
```

### 4. CloudWatch Log Group

```bash
aws logs create-log-group --log-group-name /ecs/react-nextjs-host --region <REGION>
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
| `taskRoleArn` | `ecsTaskRole` | Application AWS API permissions |

### Container Definition

| Field | Value |
|-------|-------|
| `name` | `react-nextjs-host` |
| `image` | `{{IMAGE_URI}}` (replaced at deploy time) |
| `containerPort` | `8080` |
| `logDriver` | `awslogs` → `/ecs/react-nextjs-host` |

### Valid Fargate CPU/Memory Combinations

| CPU | Valid Memory Values |
|-----|-------------------|
| 256 | 512, 1024, 2048 MB |
| **512** | **1024**, 2048, 3072, 4096 MB |
| 1024 | 2048–8192 MB |
| 2048 | 4096–16384 MB |
| 4096 | 8192–30720 MB |

---

## ECS Service Configuration

File: `ecs/service-definition.json`

| Field | Value | Notes |
|-------|-------|-------|
| `serviceName` | `react-nextjs-host-service` | |
| `launchType` | `FARGATE` | |
| `desiredCount` | `2` | Two tasks for HA |
| `assignPublicIp` | `ENABLED` | Required for public subnets |
| `maximumPercent` | `200` | Rolling deploy headroom |
| `minimumHealthyPercent` | `50` | Minimum tasks during deploy |

---

## ECS Fargate Deployment Walkthrough

### Step 1 – Build and push the image

```bash
./scripts/build-push.sh
# Note the full image URI printed at the end, e.g.:
# 123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest
```

### Step 2 – Deploy to ECS Fargate

```bash
chmod +x scripts/deploy-image.sh
./scripts/deploy-image.sh
```

The script will prompt for:
- AWS region
- ECS cluster name (creates it if absent)
- VPC ID
- Subnet IDs (comma-separated)
- Security group ID
- Full image URI
- Whether to create an Application Load Balancer

### Step 3 – Verify the deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster react-nextjs-host-cluster \
  --services react-nextjs-host-service \
  --region us-east-1 \
  --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount}"

# Tail application logs
aws logs tail /ecs/react-nextjs-host --follow --region us-east-1

# Test health endpoint (if public IP assigned)
curl http://<TASK_PUBLIC_IP>:8080/api/health
```

### Step 4 – Update the deployment (new image)

```bash
# Push new image with a new tag
./scripts/build-push.sh   # enter tag: v1.1.0

# Re-run deploy script with the new image URI
./scripts/deploy-image.sh
```

---

## ECS-Specific Troubleshooting

### Task fails to start

```bash
# List stopped tasks and their stop reason
aws ecs list-tasks --cluster react-nextjs-host-cluster \
  --desired-status STOPPED --region us-east-1

aws ecs describe-tasks --cluster react-nextjs-host-cluster \
  --tasks <TASK_ARN> --region us-east-1 \
  --query "tasks[0].{StopCode:stopCode,StopReason:stoppedReason,Containers:containers[*].{Name:name,Reason:reason,ExitCode:exitCode}}"
```

### Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| `CannotPullContainerError` | ECR auth failure or missing execution role | Verify `ecsTaskExecutionRole` has ECR permissions |
| `ResourceInitializationError` | Secrets Manager / SSM access denied | Add permissions to execution role |
| `OutOfMemoryError` in logs | JVM heap exceeds container memory | Increase task memory or tune `JAVA_OPTS` |
| `STOPPED (Essential container exited)` | Application crash on startup | Check CloudWatch logs for stack trace |
| Network timeout | Security group blocks outbound 443 | Allow outbound HTTPS in security group |

### View CloudWatch logs

```bash
# Stream logs in real time
aws logs tail /ecs/react-nextjs-host --follow --region us-east-1

# Get last 100 log events
aws logs get-log-events \
  --log-group-name /ecs/react-nextjs-host \
  --log-stream-name ecs/react-nextjs-host/<TASK_ID> \
  --limit 100 --region us-east-1
```

### CPU/Memory sizing errors

If you see `InvalidParameterException: Invalid CPU or Memory value`, ensure you use a valid Fargate combination. The default in this project is `cpu: "512"` + `memory: "1024"`.

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

# Create CPU-based scaling policy
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

### Blue/Green Deployments with CodeDeploy

1. Enable CodeDeploy in the ECS service definition (`deploymentController: {type: CODE_DEPLOY}`)
2. Create a CodeDeploy application and deployment group targeting the ECS service
3. Use `aws deploy create-deployment` to trigger blue/green deployments

---

## Configuration Management

### Environment Variables

All runtime configuration is passed via ECS task definition environment variables. To update:

1. Edit `ecs/task-definition.json` → `containerDefinitions[0].environment`
2. Re-register the task definition: `aws ecs register-task-definition --cli-input-json file://ecs/task-definition.json`
3. Update the service: `aws ecs update-service --cluster ... --service ... --task-definition <NEW_ARN>`

### AWS Secrets Manager (recommended for secrets)

```bash
# Store a secret
aws secretsmanager create-secret \
  --name /react-nextjs-host/api-key \
  --secret-string "my-secret-value"

# Reference in task definition (secrets section)
# "secrets": [{"name": "API_KEY", "valueFrom": "arn:aws:secretsmanager:..."}]
```

---

## Security Considerations

1. **Non-root container user**: The Dockerfile creates and uses `appuser` (non-root) for all runtime operations.
2. **Minimal base image**: `amazoncorretto:17` contains only the JRE and essential OS packages.
3. **No secrets in images**: All sensitive values are injected via ECS environment variables or Secrets Manager.
4. **Security group least-privilege**: Only open port 8080 inbound; restrict source to ALB security group in production.
5. **ECR image scanning**: Enable ECR image scanning on push to detect CVEs.
6. **Task role least-privilege**: Grant only the AWS permissions the application actually needs.
7. **VPC isolation**: Deploy tasks in private subnets behind an ALB for production workloads.

```bash
# Enable ECR image scanning
aws ecr put-image-scanning-configuration \
  --repository-name react-nextjs-host \
  --image-scanning-configuration scanOnPush=true
```

---

## Java-Specific Notes

### JVM Container Awareness

The Dockerfile sets the following JVM flags via `JAVA_OPTS`:

| Flag | Purpose |
|------|---------|
| `-XX:+UseContainerSupport` | Enables JVM to read cgroup memory/CPU limits |
| `-XX:MaxRAMPercentage=75.0` | Heap uses up to 75% of container memory (768 MB of 1 GB) |
| `-XX:InitialRAMPercentage=50.0` | Initial heap is 50% of container memory |
| `-XX:+UnlockExperimentalVMOptions` | Enables experimental JVM features |
| `-Djava.security.egd=file:/dev/./urandom` | Faster SecureRandom initialization |

### Graceful Shutdown

The container uses `exec java ...` as the entrypoint so the JVM process is PID 1 and receives `SIGTERM` directly from ECS. The JDK `HttpServer` will complete in-flight requests before shutting down.

### Memory Sizing Guidance

| Task Memory | Recommended Heap (`MaxRAMPercentage=75`) |
|-------------|------------------------------------------|
| 512 MB | ~384 MB |
| **1024 MB** | **~768 MB** (default) |
| 2048 MB | ~1536 MB |

To increase memory, update `ecs/task-definition.json` with a valid Fargate CPU/memory combination and re-deploy.

### Logging

Application logs are written to stdout/stderr and captured by the ECS `awslogs` log driver, forwarded to CloudWatch Logs under `/ecs/react-nextjs-host`.

To add structured JSON logging, consider adding SLF4J + Logback with `logstash-logback-encoder` to `pom.xml`.
