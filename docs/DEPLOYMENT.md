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

**Application**: `react-nextjs-host`  
**Technology**: Java 17 (plain JDK HttpServer — no Spring Boot)  
**Build Tool**: Maven 3.9.x  
**Package**: Executable JAR (`react-nextjs-host.jar`)  
**Port**: `8080`  
**Health Endpoint**: `GET /api/health` → `{"status":"UP"}`  
**Base Image (runtime)**: `amazoncorretto:17`  
**Target Platform**: AWS ECS Fargate  

---

## Prerequisites

### Local Development
| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Docker Desktop | 24.x | Build and run containers |
| Docker Compose | 2.x | Local multi-container orchestration |
| Java JDK | 17 | Local build (optional — Docker handles it) |
| Maven | 3.9.x | Local build (optional — Docker handles it) |

### AWS Deployment
| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| AWS CLI | 2.x | Interact with AWS services |
| Docker | 24.x | Build and push images |
| Bash / PowerShell | — | Run deployment scripts |

---

## Project Structure

```
javascript-monoCMP/
├── Dockerfile                  # Multi-stage build (Maven builder + amazoncorretto:17 runtime)
├── docker-compose.yml          # Local development stack (app only)
├── .dockerignore               # Excludes target/, .git/, wrapper files, etc.
├── pom.xml                     # Maven build descriptor
├── src/
│   └── main/java/com/trianz/reactnextjs/
│       ├── Application.java    # Entry point — starts JDK HttpServer on :8080
│       ├── controller/
│       │   └── HealthController.java
│       └── service/
│           └── HealthService.java
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
# From repository root
docker compose up --build
```

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
APP_ENV=staging docker compose up
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
1. Choose a registry (AWS ECR or Docker Hub)
2. Provide registry credentials / region
3. Enter an image tag (defaults to `latest`)

The script automatically:
- Sanitizes the image name (lowercase, hyphens)
- Creates the ECR repository if it does not exist
- Builds the Docker image from the repository root
- Pushes the image to the selected registry

---

## AWS ECS Fargate Prerequisites

### 1. AWS CLI Configuration
```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Region, Output format
```

### 2. VPC and Networking
- A VPC with at least **two subnets in different Availability Zones**
- A **Security Group** that allows:
  - Inbound TCP on port **8080** (from ALB or 0.0.0.0/0 for testing)
  - Outbound all traffic (for ECR image pull and CloudWatch logs)

### 3. IAM Roles

#### ecsTaskExecutionRole (required)
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

#### ecsTaskRole (optional — for task-level AWS API access)
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
aws logs create-log-group --log-group-name /ecs/react-nextjs-host --region us-east-1
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
| `containerPort` | `8080` | Application port |
| `logDriver` | `awslogs` | CloudWatch Logs |

### Valid Fargate CPU/Memory Combinations
| CPU | Memory Options |
|-----|---------------|
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
| `serviceName` | `react-nextjs-host-service` | ECS service name |
| `launchType` | `FARGATE` | Serverless compute |
| `desiredCount` | `2` | Two tasks for HA |
| `networkMode` | `awsvpc` | Each task gets its own ENI |
| `assignPublicIp` | `ENABLED` | Required for public ECR access without NAT |
| `maximumPercent` | `200` | Rolling deploy: up to 2× tasks |
| `minimumHealthyPercent` | `50` | At least 1 task stays healthy |

---

## ECS Fargate Deployment Walkthrough

### Step 1 — Build and push the image
```bash
./scripts/build-push.sh
# Note the full image URI printed at the end
```

### Step 2 — Run the deployment script
```bash
chmod +x scripts/deploy-image.sh
./scripts/deploy-image.sh
```

You will be prompted for:
- AWS Region (e.g. `us-east-1`)
- ECS Cluster name (created automatically if absent)
- ECR Image URI (from Step 1)
- VPC ID
- Subnet IDs (comma-separated, at least 2)
- Security Group ID
- Whether to create an Application Load Balancer

### Step 3 — Verify the deployment
```bash
# Check service status
aws ecs describe-services \
  --cluster react-nextjs-host-cluster \
  --services react-nextjs-host-service \
  --region us-east-1

# Tail application logs
aws logs tail /ecs/react-nextjs-host --follow --region us-east-1
```

### Step 4 — Test the health endpoint
```bash
# If using ALB (DNS printed by deploy script):
curl http://<ALB_DNS>/api/health

# If using direct task IP (find via ECS console or CLI):
curl http://<TASK_IP>:8080/api/health
```

---

## ECS-Specific Troubleshooting

### Task fails to start (STOPPED state)
```bash
# Get stopped task ARN
aws ecs list-tasks --cluster react-nextjs-host-cluster \
  --desired-status STOPPED --region us-east-1

# Inspect stop reason
aws ecs describe-tasks \
  --cluster react-nextjs-host-cluster \
  --tasks <TASK_ARN> \
  --region us-east-1 \
  --query "tasks[0].{StopCode:stopCode,StopReason:stoppedReason,Containers:containers[*].{Name:name,Reason:reason,ExitCode:exitCode}}"
```

### Common errors and fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `CannotPullContainerError` | ECR auth or network issue | Check `executionRoleArn`, security group outbound rules |
| `ResourceInitializationError` | Secrets Manager / SSM access | Verify task execution role permissions |
| `OutOfMemoryError` in logs | JVM heap exceeds container memory | Increase `memory` in task definition or reduce `JAVA_OPTS` heap |
| `InvalidParameterException: cpu/memory` | Invalid Fargate combination | Use valid CPU/memory pairs (see table above) |
| Service stuck in `DRAINING` | Old tasks not stopping | Check `minimumHealthyPercent` and task health |

### View container logs
```bash
aws logs tail /ecs/react-nextjs-host --follow --region us-east-1
```

### Force new deployment (rolling restart)
```bash
aws ecs update-service \
  --cluster react-nextjs-host-cluster \
  --service react-nextjs-host-service \
  --force-new-deployment \
  --region us-east-1
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

### Auto Scaling (Application Auto Scaling)
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

### Blue/Green Deployment with CodeDeploy
1. Create a CodeDeploy application with `ECS` compute platform
2. Create a deployment group pointing to the ECS service
3. Use `appspec.yaml` to define traffic shifting hooks
4. Trigger deployment via CodeDeploy console or CLI

---

## Configuration Management

### Environment Variables
All runtime configuration is passed via ECS task definition `environment` array.  
Sensitive values should use `secrets` (AWS Secrets Manager or SSM Parameter Store):

```json
"secrets": [
  {
    "name": "DB_PASSWORD",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:myapp/db-password"
  }
]
```

### Application Profiles
The application currently uses `APP_ENV` to distinguish environments.  
Add environment-specific overrides in the task definition `environment` array.

---

## Security Considerations

1. **Non-root container user**: The Dockerfile creates and uses `appuser` (non-root).
2. **No secrets in images**: Never bake credentials into the Docker image; use ECS secrets.
3. **Minimal runtime image**: `amazoncorretto:17` contains only the JRE — no build tools.
4. **Security Group**: Restrict inbound to ALB only; never expose port 8080 directly to 0.0.0.0/0 in production.
5. **ECR image scanning**: Enable ECR image scanning on push:
   ```bash
   aws ecr put-image-scanning-configuration \
     --repository-name react-nextjs-host \
     --image-scanning-configuration scanOnPush=true
   ```
6. **IAM least privilege**: Scope `ecsTaskRole` to only the AWS resources the application needs.
7. **VPC isolation**: Deploy tasks in private subnets with a NAT Gateway for outbound traffic in production.

---

## Java-Specific Notes

### JVM Tuning for Containers
The following JVM flags are set via `JAVA_OPTS`:

| Flag | Purpose |
|------|---------|
| `-Xmx512m` | Maximum heap size |
| `-Xms256m` | Initial heap size |
| `-XX:+UseContainerSupport` | Respect container CPU/memory limits |
| `-XX:MaxRAMPercentage=75.0` | Use up to 75% of container RAM for heap |
| `-XX:+UseG1GC` | G1 garbage collector (good for low-latency) |
| `-Djava.security.egd=file:/dev/./urandom` | Faster SecureRandom initialization |

### Adjusting Memory
If you increase the ECS task `memory` to `2048`, update `JAVA_OPTS`:
```
-Xmx1536m -Xms512m
```
Or rely on `-XX:MaxRAMPercentage=75.0` and remove explicit `-Xmx`.

### JVM Startup Time
The JDK HttpServer starts in < 1 second. ECS health check `startPeriod` is set to 60 seconds to accommodate any future framework additions.

### Graceful Shutdown
The `ENTRYPOINT` uses `exec java ...` so that the JVM receives `SIGTERM` directly from the container runtime, enabling graceful shutdown.
