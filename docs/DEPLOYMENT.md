# Deployment Guide for react-nextjs-host

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Project Overview](#project-overview)
3. [Local Development Setup](#local-development-setup)
4. [Docker Deployment](#docker-deployment)
5. [AWS ECS Fargate Prerequisites](#aws-ecs-fargate-prerequisites)
6. [ECS Fargate Setup](#ecs-fargate-setup)
7. [ECS Task Definition Explained](#ecs-task-definition-explained)
8. [ECS Service Configuration](#ecs-service-configuration)
9. [ECS Fargate Deployment Walkthrough](#ecs-fargate-deployment-walkthrough)
10. [ECS-Specific Troubleshooting](#ecs-specific-troubleshooting)
11. [ECS Fargate Scaling and Management](#ecs-fargate-scaling-and-management)
12. [Configuration Management](#configuration-management)
13. [Security Considerations](#security-considerations)
14. [Technology-Specific Notes](#technology-specific-notes)

---

## Prerequisites

### Required Software
- **Java Development Kit (JDK) 17** or higher
- **Apache Maven 3.9+** for building the application
- **Docker Desktop** (for local containerization)
- **AWS CLI v2** (for ECS deployment)
- **Git** (for version control)

### AWS Account Requirements
- Active AWS account with appropriate permissions
- IAM user with ECS, ECR, VPC, and CloudWatch permissions
- AWS CLI configured with credentials (`aws configure`)

### System Requirements
- **Operating System**: Linux, macOS, or Windows 10/11
- **Memory**: Minimum 4GB RAM (8GB recommended)
- **Disk Space**: At least 2GB free space

---

## Project Overview

### Application Details
- **Name**: react-nextjs-host
- **Type**: Java HTTP Server Application
- **Framework**: JDK Built-in HttpServer
- **Java Version**: 17
- **Build Tool**: Maven
- **Package Type**: JAR
- **Main Class**: com.trianz.reactnextjs.Application
- **Default Port**: 8080

### Application Endpoints
- **Health Check**: `GET /api/health` - Returns application health status
- **Upload Presigned URL**: `POST /api/upload/presigned-url` - Generates S3 presigned URLs
- **Upload Confirm**: `POST /api/upload/confirm` - Confirms upload completion

### Architecture
This is a lightweight Java application that uses the JDK's built-in `HttpServer` to provide REST API endpoints. It's designed to be containerized and deployed on AWS ECS Fargate.

---

## Local Development Setup

### 1. Clone the Repository
```bash
git clone <repository-url>
cd JAVAJSMONOreg
```

### 2. Build the Application
```bash
# Using Maven
mvn clean package

# The JAR file will be created at: target/react-nextjs-host.jar
```

### 3. Run Locally
```bash
# Run the JAR directly
java -jar target/react-nextjs-host.jar

# Or with custom JVM options
java -Xmx512m -Xms256m -jar target/react-nextjs-host.jar
```

### 4. Test the Application
```bash
# Test health endpoint
curl http://localhost:8080/api/health

# Expected response:
# {"status":"UP","timestamp":"2024-01-01T12:00:00Z"}
```

---

## Docker Deployment

### Build Docker Image Locally
```bash
# Build the image
docker build -t react-nextjs-host:latest .

# Run the container
docker run -p 8080:8080 react-nextjs-host:latest

# Test the containerized application
curl http://localhost:8080/api/health
```

### Using Docker Compose
```bash
# Start the application
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

---

## AWS ECS Fargate Prerequisites

### 1. AWS CLI Configuration
```bash
# Configure AWS CLI with your credentials
aws configure

# Verify configuration
aws sts get-caller-identity
```

### 2. Required AWS Resources

#### VPC and Networking
- **VPC**: A Virtual Private Cloud for your ECS resources
- **Subnets**: At least 2 subnets in different availability zones
- **Security Group**: Allow inbound traffic on port 8080
- **Internet Gateway**: For public internet access (if using public subnets)

#### IAM Roles
Two IAM roles are required:

**a) ECS Task Execution Role** (`ecsTaskExecutionRole`)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Attach managed policy: `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`

**b) ECS Task Role** (`ecsTaskRole`)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Add custom policies for S3, Secrets Manager, or other AWS services your application needs.

#### Create IAM Roles
```bash
# Create execution role
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document file://ecs-task-execution-role-trust-policy.json

# Attach managed policy
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Create task role
aws iam create-role \
  --role-name ecsTaskRole \
  --assume-role-policy-document file://ecs-task-role-trust-policy.json
```

### 3. Create Security Group
```bash
# Create security group
aws ec2 create-security-group \
  --group-name react-nextjs-host-sg \
  --description "Security group for react-nextjs-host ECS service" \
  --vpc-id <your-vpc-id>

# Allow inbound traffic on port 8080
aws ec2 authorize-security-group-ingress \
  --group-id <security-group-id> \
  --protocol tcp \
  --port 8080 \
  --cidr 0.0.0.0/0
```

---

## ECS Fargate Setup

### 1. Create CloudWatch Log Group
```bash
aws logs create-log-group \
  --log-group-name /ecs/react-nextjs-host \
  --region us-east-1
```

### 2. Create ECS Cluster
```bash
aws ecs create-cluster \
  --cluster-name react-nextjs-host-cluster \
  --region us-east-1
```

---

## ECS Task Definition Explained

### Key Components

#### Launch Type Configuration
```json
{
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc"
}
```
- **FARGATE**: Serverless compute engine for containers
- **awsvpc**: Each task gets its own elastic network interface

#### CPU and Memory
```json
{
  "cpu": "512",
  "memory": "1024"
}
```

**Valid Fargate CPU/Memory Combinations:**
- CPU: "256" (.25 vCPU) → Memory: 512, 1024, 2048 MB
- CPU: "512" (.5 vCPU) → Memory: 1024, 2048, 3072, 4096 MB
- CPU: "1024" (1 vCPU) → Memory: 2048-8192 MB (increments of 1024)
- CPU: "2048" (2 vCPU) → Memory: 4096-16384 MB (increments of 1024)
- CPU: "4096" (4 vCPU) → Memory: 8192-30720 MB (increments of 1024)

#### Container Definition
```json
{
  "name": "react-nextjs-host",
  "image": "123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest",
  "essential": true,
  "portMappings": [
    {
      "containerPort": 8080,
      "protocol": "tcp"
    }
  ]
}
```

#### Logging Configuration
```json
{
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

### Service Definition Components

#### Launch Type and Networking
```json
{
  "launchType": "FARGATE",
  "networkConfiguration": {
    "awsvpcConfiguration": {
      "subnets": ["subnet-xxx", "subnet-yyy"],
      "securityGroups": ["sg-xxx"],
      "assignPublicIp": "ENABLED"
    }
  }
}
```

#### Deployment Configuration
```json
{
  "deploymentConfiguration": {
    "maximumPercent": 200,
    "minimumHealthyPercent": 50
  }
}
```
- **maximumPercent**: Maximum percentage of tasks that can run during deployment (200% = double capacity)
- **minimumHealthyPercent**: Minimum percentage of tasks that must remain healthy (50% = half capacity)

#### Load Balancer Integration
```json
{
  "loadBalancers": [
    {
      "targetGroupArn": "arn:aws:elasticloadbalancing:...",
      "containerName": "react-nextjs-host",
      "containerPort": 8080
    }
  ],
  "healthCheckGracePeriodSeconds": 300
}
```

---

## ECS Fargate Deployment Walkthrough

### Step 1: Build and Push Docker Image

#### Linux/macOS
```bash
# Make script executable
chmod +x scripts/build-push.sh

# Run the script
./scripts/build-push.sh

# Follow the prompts:
# 1. Select registry (1 for ECR, 2 for Docker Hub)
# 2. Enter AWS region (e.g., us-east-1)
# 3. Enter AWS account ID
# 4. Enter image tag (default: latest)
```

#### Windows
```cmd
# Run the script
scripts\build-push.bat

# Follow the same prompts as above
```

### Step 2: Deploy to ECS Fargate

#### Linux/macOS
```bash
# Make script executable
chmod +x scripts/deploy-image.sh

# Run the deployment script
./scripts/deploy-image.sh

# Follow the prompts:
# 1. Enter AWS region
# 2. Enter ECS cluster name
# 3. Enter VPC ID
# 4. Enter Subnet IDs (2 required)
# 5. Enter Security Group ID
# 6. Enter ECR image URI
# 7. Choose whether to create a load balancer (y/n)
```

#### Windows
```cmd
# Run the deployment script
scripts\deploy-image.bat

# Follow the same prompts as above
```

### Step 3: Verify Deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster react-nextjs-host-cluster \
  --services react-nextjs-host-service \
  --region us-east-1

# View running tasks
aws ecs list-tasks \
  --cluster react-nextjs-host-cluster \
  --service-name react-nextjs-host-service \
  --region us-east-1

# View logs
aws logs tail /ecs/react-nextjs-host --follow --region us-east-1
```

### Step 4: Test the Application

```bash
# If using load balancer
curl http://<alb-dns-name>/api/health

# If using public IP (get from ECS console)
curl http://<task-public-ip>:8080/api/health
```

---

## ECS-Specific Troubleshooting

### Task Fails to Start

**Problem**: Task stops immediately after starting

**Solutions**:
1. Check CloudWatch logs:
   ```bash
   aws logs tail /ecs/react-nextjs-host --follow
   ```

2. Verify task definition:
   ```bash
   aws ecs describe-task-definition --task-definition react-nextjs-host-task
   ```

3. Check IAM role permissions:
   ```bash
   aws iam get-role --role-name ecsTaskExecutionRole
   ```

### Network Issues

**Problem**: Cannot access the application

**Solutions**:
1. Verify security group allows inbound traffic on port 8080
2. Check if public IP is assigned (assignPublicIp: ENABLED)
3. Verify subnets have internet gateway attached
4. Check network ACLs

### CPU/Memory Errors

**Problem**: Task fails with "OutOfMemory" or CPU throttling

**Solutions**:
1. Increase memory in task definition:
   ```json
   {
     "cpu": "1024",
     "memory": "2048"
   }
   ```

2. Optimize JVM settings:
   ```bash
   JAVA_OPTS="-Xmx1536m -Xms512m -XX:MaxRAMPercentage=75.0"
   ```

### Image Pull Errors

**Problem**: "CannotPullContainerError"

**Solutions**:
1. Verify ECR repository exists and image is pushed
2. Check execution role has ECR permissions
3. Verify image URI is correct in task definition

### Service Unstable

**Problem**: Service keeps restarting tasks

**Solutions**:
1. Check health check configuration
2. Increase health check grace period
3. Review application logs for errors
4. Verify environment variables are correct

---

## ECS Fargate Scaling and Management

### Service Auto Scaling

#### Configure Target Tracking Scaling
```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/react-nextjs-host-cluster/react-nextjs-host-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Create scaling policy
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/react-nextjs-host-cluster/react-nextjs-host-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu-scaling-policy \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration file://scaling-policy.json
```

**scaling-policy.json**:
```json
{
  "TargetValue": 70.0,
  "PredefinedMetricSpecification": {
    "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
  },
  "ScaleOutCooldown": 60,
  "ScaleInCooldown": 60
}
```

### Manual Scaling
```bash
# Update desired count
aws ecs update-service \
  --cluster react-nextjs-host-cluster \
  --service react-nextjs-host-service \
  --desired-count 5
```

### Blue/Green Deployments

1. Create new task definition revision
2. Update service with new task definition
3. ECS gradually replaces old tasks with new ones
4. Monitor deployment progress

```bash
# Update service with new task definition
aws ecs update-service \
  --cluster react-nextjs-host-cluster \
  --service react-nextjs-host-service \
  --task-definition react-nextjs-host-task:2
```

---

## Configuration Management

### Environment Variables

Update task definition to add environment variables:
```json
{
  "environment": [
    {
      "name": "JAVA_OPTS",
      "value": "-Xmx512m -Xms256m"
    },
    {
      "name": "TZ",
      "value": "UTC"
    },
    {
      "name": "LOG_LEVEL",
      "value": "INFO"
    }
  ]
}
```

### Secrets Management

Use AWS Secrets Manager or Systems Manager Parameter Store:
```json
{
  "secrets": [
    {
      "name": "DB_PASSWORD",
      "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:db-password"
    },
    {
      "name": "API_KEY",
      "valueFrom": "arn:aws:ssm:us-east-1:123456789:parameter/api-key"
    }
  ]
}
```

---

## Security Considerations

### Network Security
1. **Use Private Subnets**: Deploy tasks in private subnets with NAT gateway
2. **Restrict Security Groups**: Only allow necessary inbound/outbound traffic
3. **Enable VPC Flow Logs**: Monitor network traffic

### Container Security
1. **Non-Root User**: Application runs as non-root user (appuser)
2. **Read-Only Root Filesystem**: Consider enabling in task definition
3. **Scan Images**: Use ECR image scanning for vulnerabilities

### IAM Security
1. **Least Privilege**: Grant only necessary permissions to task role
2. **Separate Roles**: Use different roles for execution and task
3. **Rotate Credentials**: Regularly rotate AWS access keys

### Application Security
1. **HTTPS**: Use Application Load Balancer with SSL/TLS certificate
2. **Authentication**: Implement authentication for API endpoints
3. **Input Validation**: Validate all user inputs
4. **Logging**: Enable comprehensive logging for audit trails

---

## Technology-Specific Notes

### Java 17 Features
- Uses JDK built-in HttpServer (no external dependencies)
- Optimized for containerized environments
- Supports modern JVM features

### JVM Tuning for Containers
```bash
# Recommended JVM options for containers
JAVA_OPTS="-Xmx512m -Xms256m \
  -XX:+UseContainerSupport \
  -XX:MaxRAMPercentage=75.0 \
  -XX:+UnlockExperimentalVMOptions \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200"
```

### Maven Build Optimization
- Dependencies are cached in Docker layer
- Multi-stage build reduces final image size
- Tests are skipped during Docker build

### Monitoring and Observability
1. **CloudWatch Logs**: All application logs sent to CloudWatch
2. **CloudWatch Metrics**: Monitor CPU, memory, network
3. **X-Ray**: Consider enabling AWS X-Ray for distributed tracing
4. **Custom Metrics**: Publish custom application metrics

### Performance Optimization
1. **Connection Pooling**: Implement connection pooling for external services
2. **Caching**: Use caching for frequently accessed data
3. **Async Processing**: Use async processing for long-running tasks
4. **Resource Limits**: Set appropriate CPU and memory limits

---

## Additional Resources

### AWS Documentation
- [ECS Fargate Documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [ECS Task Definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- [ECS Service Auto Scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)

### Java Resources
- [Java 17 Documentation](https://docs.oracle.com/en/java/javase/17/)
- [JVM Container Support](https://docs.oracle.com/en/java/javase/17/docs/specs/man/java.html)

### Docker Resources
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)

---

## Support and Maintenance

### Monitoring Checklist
- [ ] CloudWatch alarms configured for CPU/memory
- [ ] Log retention policies set
- [ ] Service auto-scaling configured
- [ ] Health checks passing
- [ ] Security group rules reviewed

### Regular Maintenance
- Update base images regularly
- Review and rotate credentials
- Monitor costs and optimize resources
- Update dependencies and security patches
- Review and update IAM policies

---

**Last Updated**: 2024
**Version**: 1.0.0
