# Deployment Guide — react-nextjs-host on AWS ECS Fargate

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
**Technology**: Java 17 (plain JDK HTTP server, Maven)  
**Packaging**: Executable JAR (`react-nextjs-host.jar`)  
**Application Port**: `8080`  
**Health Endpoint**: `GET /api/health` → `{"status":"UP"}`  
**Target Platform**: AWS ECS Fargate  
**Base Image (runtime)**: `eclipse-temurin:17-jdk`

---

## Prerequisites

### Local Development
| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Docker | 24.x | Build and run containers |
| Docker Compose | 2.x | Local multi-container orchestration |
| Java JDK | 17 | Local build (optional — Docker handles it) |
| Maven | 3.9.x | Local build (optional — Docker handles it) |

### AWS Deployment
| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| AWS CLI | v2 | Interact with AWS services |
| IAM permissions | — | ECR, ECS, CloudWatch, ELB, IAM |

---

## Project Structure

```
JAVAJSMONO/
├── Dockerfile                  # Multi-stage build (Maven builder + JDK runtime)
├── docker-compose.yml          # Local development stack (app only)
├── .dockerignore               # Excludes build artefacts, wrapper files, IDE files
├── pom.xml                     # Maven build descriptor
├── src/
│   └── main/java/com/trianz/reactnextjs/
│       ├── Application.java    # Entry point — starts HTTP server on :8080
│       ├── controller/HealthController.java
│       └── service/HealthService.java
├── ecs/
│   ├── task-definition.json    # ECS Fargate task definition
│   └── service-definition.json # ECS Fargate service definition
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
# Build and start
docker compose up --build

# Start in background
docker compose up --build -d

# View logs
docker compose logs -f react-nextjs-host

# Stop
docker compose down
```

### Verify the application is running

```bash
# Health check
curl http://localhost:8080/api/health
# Expected: {"status":"UP"}
```

### Environment variable overrides

Edit `docker-compose.yml` or pass variables on the command line:

```bash
JAVA_OPTS="-Xmx1g -Xms512m" docker compose up
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

Both scripts will interactively prompt for:
1. **Image tag** (default: `latest`)
2. **Registry type**: AWS ECR or Docker Hub
3. Registry-specific credentials and repository details

The scripts automatically:
- Sanitize the image name (lowercase, hyphenated)
- Create the ECR repository if it does not exist
- Authenticate to the selected registry
- Build the Docker image from the repository root
- Push the image

### Manual build

```bash
# Build
docker build -t react-nextjs-host:latest .

# Tag for ECR
docker tag react-nextjs-host:latest \
  123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest

# Push
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest
```

---

## AWS ECS Fargate Prerequisites

### 1. AWS CLI Configuration

```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Region, Output format
aws sts get-caller-identity   # Verify credentials
```

### 2. IAM Roles

#### ECS Task Execution Role (`ecsTaskExecutionRole`)
Required for ECS to pull images from ECR and write logs to CloudWatch.

```bash
# Create the role (if it doesn't exist)
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

#### ECS Task Role (`ecsTaskRole`)
Optional — grants the running container permissions to call AWS services.

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
# Attach additional policies as needed (e.g., S3, DynamoDB)
```

### 3. VPC and Networking

Fargate tasks require **awsvpc** network mode. You need:
- A VPC with at least **2 subnets** in different Availability Zones
- A **Security Group** that allows:
  - Inbound TCP `8080` from the load balancer (or `0.0.0.0/0` for testing)
  - Outbound all traffic (for ECR image pull, CloudWatch logs)

```bash
# List available VPCs
aws ec2 describe-vpcs --query "Vpcs[*].{ID:VpcId,CIDR:CidrBlock}" --output table

# List subnets
aws ec2 describe-subnets --query "Subnets[*].{ID:SubnetId,AZ:AvailabilityZone,CIDR:CidrBlock}" --output table

# Create security group
aws ec2 create-security-group \
  --group-name react-nextjs-host-sg \
  --description "Security group for react-nextjs-host ECS tasks" \
  --vpc-id vpc-xxxxxxxx

# Allow inbound on port 8080
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 8080 \
  --cidr 0.0.0.0/0
```

### 4. ECR Repository

```bash
aws ecr create-repository \
  --repository-name react-nextjs-host \
  --region us-east-1
```

### 5. CloudWatch Log Group

```bash
aws logs create-log-group \
  --log-group-name /ecs/react-nextjs-host \
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
| `executionRoleArn` | `ecsTaskExecutionRole` | Allows ECR pull + CloudWatch logs |
| `taskRoleArn` | `ecsTaskRole` | Application-level AWS permissions |

### Valid Fargate CPU/Memory Combinations

| CPU | Valid Memory Values |
|-----|-------------------|
| 256 (.25 vCPU) | 512, 1024, 2048 MB |
| **512 (.5 vCPU)** | **1024**, 2048, 3072, 4096 MB |
| 1024 (1 vCPU) | 2048–8192 MB |
| 2048 (2 vCPU) | 4096–16384 MB |
| 4096 (4 vCPU) | 8192–30720 MB |

### Container Definition

```json
{
  "name": "react-nextjs-host",
  "image": "{{IMAGE_URI}}",
  "essential": true,
  "portMappings": [{"containerPort": 8080, "protocol": "tcp"}],
  "environment": [
    {"name": "JAVA_OPTS", "value": "-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -Xms256m -Xmx512m"},
    {"name": "TZ", "value": "UTC"}
  ],
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/react-nextjs-host",
      "awslogs-region": "us-east-1",
      "awslogs-stream-prefix": "ecs"
    }
  }
}
```

---

## ECS Service Configuration

File: `ecs/service-definition.json`

| Field | Value | Notes |
|-------|-------|-------|
| `serviceName` | `react-nextjs-host-service` | ECS service name |
| `launchType` | `FARGATE` | Serverless compute |
| `desiredCount` | `2` | Two tasks for high availability |
| `assignPublicIp` | `ENABLED` | Required if tasks need internet access |
| `maximumPercent` | `200` | Rolling deploy: up to 2× tasks |
| `minimumHealthyPercent` | `50` | At least 1 task healthy during deploy |

---

## ECS Fargate Deployment Walkthrough

### Step 1 — Push the image

```bash
./scripts/build-push.sh
# Select: 1 (AWS ECR)
# Enter region, account ID, repository name, tag
```

### Step 2 — Deploy to ECS

```bash
chmod +x scripts/deploy-image.sh
./scripts/deploy-image.sh
```

The script will prompt for:
- AWS Region
- ECS Cluster name
- ECR Image URI
- Subnet IDs (comma-separated)
- Security Group ID
- Whether to create an Application Load Balancer

### Step 3 — Verify deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster react-nextjs-host-cluster \
  --services react-nextjs-host-service \
  --region us-east-1 \
  --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount}"

# List running tasks
aws ecs list-tasks \
  --cluster react-nextjs-host-cluster \
  --service-name react-nextjs-host-service \
  --region us-east-1

# View application logs
aws logs tail /ecs/react-nextjs-host --follow --region us-east-1
```

### Step 4 — Test the health endpoint

```bash
# If using ALB
curl http://<ALB_DNS_NAME>/api/health
# Expected: {"status":"UP"}

# If using public IP (testing only)
TASK_ARN=$(aws ecs list-tasks --cluster react-nextjs-host-cluster \
  --service-name react-nextjs-host-service --query "taskArns[0]" --output text)
ENI_ID=$(aws ecs describe-tasks --cluster react-nextjs-host-cluster \
  --tasks $TASK_ARN --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" --output text)
PUBLIC_IP=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI_ID \
  --query "NetworkInterfaces[0].Association.PublicIp" --output text)
curl http://$PUBLIC_IP:8080/api/health
```

---

## ECS-Specific Troubleshooting

### Task fails to start

```bash
# Check stopped task reason
aws ecs describe-tasks \
  --cluster react-nextjs-host-cluster \
  --tasks <TASK_ARN> \
  --region us-east-1 \
  --query "tasks[0].{Status:lastStatus,StopReason:stoppedReason,Containers:containers[*].{Name:name,Reason:reason,ExitCode:exitCode}}"
```

Common causes:
- **ImagePullBackOff**: ECR permissions missing on `ecsTaskExecutionRole`, or wrong image URI
- **OutOfMemory**: Increase `memory` in task definition (use valid Fargate combination)
- **Port conflict**: Ensure `containerPort` matches the application port (8080)
- **IAM role missing**: Ensure `ecsTaskExecutionRole` exists and has `AmazonECSTaskExecutionRolePolicy`

### Network issues

```bash
# Verify security group allows port 8080
aws ec2 describe-security-groups --group-ids sg-xxxxxxxx \
  --query "SecurityGroups[0].IpPermissions"

# Check task ENI
aws ecs describe-tasks --cluster react-nextjs-host-cluster \
  --tasks <TASK_ARN> \
  --query "tasks[0].attachments"
```

### CPU/Memory errors

Ensure you use valid Fargate combinations. The default (`cpu: "512"`, `memory: "1024"`) is safe for this application.

### CloudWatch logs not appearing

```bash
# Verify log group exists
aws logs describe-log-groups --log-group-name-prefix /ecs/react-nextjs-host

# Check execution role has CloudWatch permissions
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::ACCOUNT_ID:role/ecsTaskExecutionRole \
  --action-names logs:CreateLogStream logs:PutLogEvents \
  --resource-arns "*"
```

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
  --policy-name react-nextjs-host-cpu-scaling \
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

### Blue/Green Deployment (CodeDeploy)

For zero-downtime deployments, configure AWS CodeDeploy with ECS:
1. Create a CodeDeploy application and deployment group targeting the ECS service
2. Use `EXTERNAL` deployment controller in the service definition
3. Trigger deployments via `aws deploy create-deployment`

### Rolling update (default)

The service definition uses `maximumPercent: 200` and `minimumHealthyPercent: 50`, which means:
- ECS starts new tasks before stopping old ones
- At least 1 task remains healthy during the update
- Update a service: `aws ecs update-service --cluster ... --service ... --task-definition <NEW_ARN>`

---

## Configuration Management

### Environment variables

All runtime configuration is passed via environment variables in the task definition. To update:

1. Edit `ecs/task-definition.json` — add/modify the `environment` array
2. Re-register the task definition: `aws ecs register-task-definition --cli-input-json file://ecs/task-definition.json`
3. Update the service: `aws ecs update-service --cluster ... --service ... --task-definition <NEW_ARN>`

### AWS Secrets Manager / SSM Parameter Store

For sensitive values (database passwords, API keys):

```json
"secrets": [
  {
    "name": "DB_PASSWORD",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:myapp/db-password"
  }
]
```

Add the `secretsmanager:GetSecretValue` permission to `ecsTaskExecutionRole`.

---

## Security Considerations

1. **Non-root container user**: The Dockerfile creates and uses `appuser` (non-root)
2. **Minimal runtime image**: `eclipse-temurin:17-jdk` — no unnecessary packages
3. **No secrets in image**: All sensitive config via environment variables or Secrets Manager
4. **Network isolation**: Use private subnets with NAT Gateway for production; restrict security group ingress
5. **ECR image scanning**: Enable ECR image scanning on push:
   ```bash
   aws ecr put-image-scanning-configuration \
     --repository-name react-nextjs-host \
     --image-scanning-configuration scanOnPush=true
   ```
6. **IAM least privilege**: Grant only the permissions the task actually needs
7. **VPC endpoints**: Use VPC endpoints for ECR and CloudWatch to avoid internet traffic

---

## Java-Specific Notes

### JVM Container Awareness

The Dockerfile sets:
```
JAVA_OPTS=-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -Xms256m -Xmx512m -XX:+ExitOnOutOfMemoryError
```

- `-XX:+UseContainerSupport`: JVM reads cgroup memory/CPU limits (Java 8u191+, Java 11+)
- `-XX:MaxRAMPercentage=75.0`: Heap uses up to 75% of container memory (768 MB of 1024 MB)
- `-XX:+ExitOnOutOfMemoryError`: Container exits cleanly on OOM so ECS can restart it

### Tuning for larger workloads

If you increase the Fargate task memory, adjust `MaxRAMPercentage` or explicit heap flags accordingly:

| Task Memory | Recommended `-Xmx` |
|-------------|-------------------|
| 1024 MB | 512m–768m |
| 2048 MB | 1g–1536m |
| 4096 MB | 2g–3g |

### Graceful shutdown

The `ENTRYPOINT` uses `exec java ...` so the JVM receives `SIGTERM` directly from ECS. The JVM shuts down gracefully, running shutdown hooks before exiting.

### Startup time

The plain JDK HTTP server starts in under 1 second. The ECS health check grace period is not required for this application, but the docker-compose health check uses a 60-second `start_period` as a conservative default.

### Logging

Application logs are written to stdout/stderr and captured by the `awslogs` driver into CloudWatch Logs under `/ecs/react-nextjs-host`. To view:

```bash
aws logs tail /ecs/react-nextjs-host --follow --region us-east-1
```
