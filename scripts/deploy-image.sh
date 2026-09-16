#!/usr/bin/env bash
# =============================================================================
# deploy-image.sh – Deploy react-nextjs-host to AWS ECS Fargate
# Usage: ./scripts/deploy-image.sh
# Prerequisites: aws CLI configured, jq installed
# =============================================================================
set -e
set -o pipefail

PROJECT_NAME="react-nextjs-host"
SERVICE_NAME="${PROJECT_NAME}-service"
TASK_FAMILY="${PROJECT_NAME}-task"
LOG_GROUP="/ecs/${PROJECT_NAME}"

echo "=============================================="
echo "  Deploy: $PROJECT_NAME → AWS ECS Fargate"
echo "=============================================="

# ── AWS configuration ─────────────────────────────────────────────────────────
read -rp "Enter AWS region [us-east-1]: " AWS_REGION
AWS_REGION="${AWS_REGION:-us-east-1}"

echo "Retrieving AWS Account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: $ACCOUNT_ID"

# ── ECS Cluster ───────────────────────────────────────────────────────────────
read -rp "Enter ECS cluster name [react-nextjs-host-cluster]: " CLUSTER_NAME
CLUSTER_NAME="${CLUSTER_NAME:-react-nextjs-host-cluster}"

echo "Checking ECS cluster '$CLUSTER_NAME'..."
CLUSTER_STATUS=$(aws ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$AWS_REGION" \
  --query "clusters[0].status" --output text 2>/dev/null || echo "MISSING")

if [ "$CLUSTER_STATUS" != "ACTIVE" ]; then
  echo "Creating ECS cluster '$CLUSTER_NAME'..."
  aws ecs create-cluster --cluster-name "$CLUSTER_NAME" --region "$AWS_REGION"
fi
echo "Cluster '$CLUSTER_NAME' is ready."

# ── Network configuration ─────────────────────────────────────────────────────
echo ""
echo "--- Network Configuration ---"
read -rp "Enter VPC ID: " VPC_ID
read -rp "Enter subnet IDs (comma-separated, e.g. subnet-aaa,subnet-bbb): " SUBNETS_INPUT
read -rp "Enter security group ID: " SECURITY_GROUP

# Parse subnets into JSON array
SUBNET_1=$(echo "$SUBNETS_INPUT" | cut -d',' -f1 | tr -d ' ')
SUBNET_2=$(echo "$SUBNETS_INPUT" | cut -d',' -f2 | tr -d ' ')
if [ -z "$SUBNET_2" ]; then
  SUBNET_2="$SUBNET_1"
fi

# ── Image URI ─────────────────────────────────────────────────────────────────
echo ""
read -rp "Enter full image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest): " IMAGE_URI

# ── CloudWatch log group ──────────────────────────────────────────────────────
echo ""
echo "Ensuring CloudWatch log group '$LOG_GROUP' exists..."
aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$AWS_REGION" 2>/dev/null || true

# ── Prepare task definition ───────────────────────────────────────────────────
echo "Preparing task definition..."
cp ecs/task-definition.json /tmp/task-definition-deploy.json

sed -i "s|{{IMAGE_URI}}|${IMAGE_URI}|g"       /tmp/task-definition-deploy.json
sed -i "s|{{AWS_REGION}}|${AWS_REGION}|g"     /tmp/task-definition-deploy.json
sed -i "s|{{ACCOUNT_ID}}|${ACCOUNT_ID}|g"     /tmp/task-definition-deploy.json

# ── Register task definition ──────────────────────────────────────────────────
echo "Registering task definition '$TASK_FAMILY'..."
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json file:///tmp/task-definition-deploy.json \
  --region "$AWS_REGION" \
  --query "taskDefinition.taskDefinitionArn" \
  --output text)
echo "Registered: $TASK_DEF_ARN"

# ── Load balancer ─────────────────────────────────────────────────────────────
echo ""
read -rp "Do you need an Application Load Balancer for this service? (y/n) [n]: " NEED_LB
NEED_LB="${NEED_LB:-n}"

USE_LB=false
TARGET_GROUP_ARN=""

if [[ "$NEED_LB" =~ ^[Yy]$ ]]; then
  USE_LB=true
  echo ""
  echo "Creating Application Load Balancer..."

  ALB_NAME="${PROJECT_NAME}-alb"
  TG_NAME="${PROJECT_NAME}-tg"

  # Create ALB
  ALB_ARN=$(aws elbv2 create-load-balancer \
    --name "$ALB_NAME" \
    --subnets "$SUBNET_1" "$SUBNET_2" \
    --security-groups "$SECURITY_GROUP" \
    --scheme internet-facing \
    --type application \
    --region "$AWS_REGION" \
    --query "LoadBalancers[0].LoadBalancerArn" \
    --output text)
  echo "ALB ARN: $ALB_ARN"

  ALB_DNS=$(aws elbv2 describe-load-balancers \
    --load-balancer-arns "$ALB_ARN" \
    --region "$AWS_REGION" \
    --query "LoadBalancers[0].DNSName" \
    --output text)

  # Create Target Group (target-type ip required for Fargate awsvpc)
  TARGET_GROUP_ARN=$(aws elbv2 create-target-group \
    --name "$TG_NAME" \
    --protocol HTTP \
    --port 8080 \
    --vpc-id "$VPC_ID" \
    --target-type ip \
    --health-check-path "/api/health" \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --region "$AWS_REGION" \
    --query "TargetGroups[0].TargetGroupArn" \
    --output text)
  echo "Target Group ARN: $TARGET_GROUP_ARN"

  # Create listener
  aws elbv2 create-listener \
    --load-balancer-arn "$ALB_ARN" \
    --protocol HTTP \
    --port 80 \
    --default-actions "Type=forward,TargetGroupArn=${TARGET_GROUP_ARN}" \
    --region "$AWS_REGION" >/dev/null
  echo "Listener created on port 80."
fi

# ── Prepare service definition ────────────────────────────────────────────────
echo "Preparing service definition..."
cp ecs/service-definition.json /tmp/service-definition-deploy.json

sed -i "s|{{CLUSTER_NAME}}|${CLUSTER_NAME}|g"     /tmp/service-definition-deploy.json
sed -i "s|{{SUBNET_1}}|${SUBNET_1}|g"             /tmp/service-definition-deploy.json
sed -i "s|{{SUBNET_2}}|${SUBNET_2}|g"             /tmp/service-definition-deploy.json
sed -i "s|{{SECURITY_GROUP}}|${SECURITY_GROUP}|g" /tmp/service-definition-deploy.json

if [ "$USE_LB" = true ]; then
  # Inject loadBalancers block using Python (avoids complex sed escaping)
  python3 - <<PYEOF
import json, sys

with open('/tmp/service-definition-deploy.json') as f:
    svc = json.load(f)

svc['loadBalancers'] = [{
    'targetGroupArn': '${TARGET_GROUP_ARN}',
    'containerName': '${PROJECT_NAME}',
    'containerPort': 8080
}]
svc['healthCheckGracePeriodSeconds'] = 300

with open('/tmp/service-definition-deploy.json', 'w') as f:
    json.dump(svc, f, indent=2)
PYEOF
fi

# ── Create or update ECS service ──────────────────────────────────────────────
echo "Checking if service '$SERVICE_NAME' already exists..."
EXISTING_SERVICE=$(aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query "services[?status!='INACTIVE'].serviceName" \
  --output text 2>/dev/null || echo "")

if [ -z "$EXISTING_SERVICE" ] || [ "$EXISTING_SERVICE" = "None" ]; then
  echo "Creating new ECS service '$SERVICE_NAME'..."
  aws ecs create-service \
    --cli-input-json file:///tmp/service-definition-deploy.json \
    --region "$AWS_REGION"
else
  echo "Updating existing ECS service '$SERVICE_NAME'..."
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --desired-count 2 \
    --region "$AWS_REGION"
fi

# ── Wait for stability ────────────────────────────────────────────────────────
echo ""
echo "Waiting for service to stabilize (this may take a few minutes)..."
aws ecs wait services-stable \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION"

# ── Verify deployment ─────────────────────────────────────────────────────────
echo ""
echo "Deployment verification:"
aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount,TaskDef:taskDefinition}" \
  --output table

echo ""
echo "=============================================="
echo "  DEPLOYMENT COMPLETE"
echo "  Service : $SERVICE_NAME"
echo "  Cluster : $CLUSTER_NAME"
echo "  Region  : $AWS_REGION"
echo "  Logs    : $LOG_GROUP"
if [ "$USE_LB" = true ]; then
  echo "  App URL : http://$ALB_DNS"
fi
echo "=============================================="
echo ""
echo "Troubleshooting tips:"
echo "  View logs  : aws logs tail $LOG_GROUP --follow --region $AWS_REGION"
echo "  List tasks : aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --region $AWS_REGION"
echo "  Task logs  : aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks <TASK_ARN> --region $AWS_REGION"
