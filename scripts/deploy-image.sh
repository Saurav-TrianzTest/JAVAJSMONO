#!/bin/bash
# =============================================================================
# deploy-image.sh – Deploy react-nextjs-host to AWS ECS Fargate
# Usage: ./scripts/deploy-image.sh  (run from repository root)
# =============================================================================
set -e
set -o pipefail

SERVICE_NAME="react-nextjs-host-service"
TASK_FAMILY="react-nextjs-host-task"
LOG_GROUP="/ecs/react-nextjs-host"
CONTAINER_PORT=8080

echo "=============================================="
echo "  react-nextjs-host – ECS Fargate Deployment"
echo "=============================================="
echo ""

# ---------------------------------------------------------------------------
# Collect deployment parameters
# ---------------------------------------------------------------------------
read -rp "Enter AWS Region [us-east-1]: " AWS_REGION
AWS_REGION="${AWS_REGION:-us-east-1}"

read -rp "Enter ECS Cluster name [react-nextjs-host-cluster]: " CLUSTER_NAME
CLUSTER_NAME="${CLUSTER_NAME:-react-nextjs-host-cluster}"

read -rp "Enter ECR Image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest): " IMAGE_URI
if [ -z "$IMAGE_URI" ]; then
  echo "ERROR: Image URI is required."
  exit 1
fi

read -rp "Enter Subnet IDs (comma-separated, e.g. subnet-aaa,subnet-bbb): " SUBNETS_INPUT
if [ -z "$SUBNETS_INPUT" ]; then
  echo "ERROR: At least one subnet ID is required."
  exit 1
fi

read -rp "Enter Security Group ID (e.g. sg-xxxxxxxx): " SECURITY_GROUP
if [ -z "$SECURITY_GROUP" ]; then
  echo "ERROR: Security Group ID is required."
  exit 1
fi

# ---------------------------------------------------------------------------
# Derive AWS Account ID
# ---------------------------------------------------------------------------
echo ""
echo "Retrieving AWS Account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: $ACCOUNT_ID"

# ---------------------------------------------------------------------------
# Parse subnets into JSON array
# ---------------------------------------------------------------------------
SUBNET_JSON=$(echo "$SUBNETS_INPUT" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | \
  awk '{printf "\"%s\",", $0}' | sed 's/,$//')
SUBNET_JSON="[$SUBNET_JSON]"

# ---------------------------------------------------------------------------
# Ensure ECS cluster exists
# ---------------------------------------------------------------------------
echo ""
echo "Checking ECS cluster: $CLUSTER_NAME ..."
CLUSTER_STATUS=$(aws ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$AWS_REGION" \
  --query "clusters[0].status" --output text 2>/dev/null || echo "MISSING")

if [ "$CLUSTER_STATUS" != "ACTIVE" ]; then
  echo "Creating ECS cluster: $CLUSTER_NAME ..."
  aws ecs create-cluster --cluster-name "$CLUSTER_NAME" --region "$AWS_REGION"
fi
echo "Cluster ready: $CLUSTER_NAME"

# ---------------------------------------------------------------------------
# Ensure CloudWatch log group exists
# ---------------------------------------------------------------------------
echo ""
echo "Ensuring CloudWatch log group: $LOG_GROUP ..."
aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$AWS_REGION" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Load balancer prompt
# ---------------------------------------------------------------------------
echo ""
read -rp "Do you need an Application Load Balancer for this service? (y/n) [n]: " NEED_LB
NEED_LB="${NEED_LB:-n}"

TARGET_GROUP_ARN=""
LB_DNS=""

if [[ "$NEED_LB" =~ ^[Yy]$ ]]; then
  read -rp "Enter VPC ID for the load balancer (e.g. vpc-xxxxxxxx): " VPC_ID
  if [ -z "$VPC_ID" ]; then
    echo "ERROR: VPC ID is required for load balancer creation."
    exit 1
  fi

  LB_NAME="react-nextjs-host-alb"
  TG_NAME="react-nextjs-host-tg"

  echo ""
  echo "Creating Application Load Balancer: $LB_NAME ..."
  LB_ARN=$(aws elbv2 create-load-balancer \
    --name "$LB_NAME" \
    --subnets $(echo "$SUBNETS_INPUT" | tr ',' ' ') \
    --security-groups "$SECURITY_GROUP" \
    --scheme internet-facing \
    --type application \
    --region "$AWS_REGION" \
    --query "LoadBalancers[0].LoadBalancerArn" --output text)
  echo "ALB ARN: $LB_ARN"

  LB_DNS=$(aws elbv2 describe-load-balancers \
    --load-balancer-arns "$LB_ARN" \
    --region "$AWS_REGION" \
    --query "LoadBalancers[0].DNSName" --output text)

  echo "Creating Target Group: $TG_NAME ..."
  TARGET_GROUP_ARN=$(aws elbv2 create-target-group \
    --name "$TG_NAME" \
    --protocol HTTP \
    --port "$CONTAINER_PORT" \
    --vpc-id "$VPC_ID" \
    --target-type ip \
    --health-check-path "/api/health" \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --region "$AWS_REGION" \
    --query "TargetGroups[0].TargetGroupArn" --output text)
  echo "Target Group ARN: $TARGET_GROUP_ARN"

  echo "Creating ALB Listener on port 80..."
  aws elbv2 create-listener \
    --load-balancer-arn "$LB_ARN" \
    --protocol HTTP \
    --port 80 \
    --default-actions Type=forward,TargetGroupArn="$TARGET_GROUP_ARN" \
    --region "$AWS_REGION" >/dev/null
fi

# ---------------------------------------------------------------------------
# Prepare task definition JSON (replace placeholders)
# ---------------------------------------------------------------------------
echo ""
echo "Preparing task definition..."
TASK_DEF_FILE=$(mktemp /tmp/task-def-XXXXXX.json)
sed \
  -e "s|{{ACCOUNT_ID}}|${ACCOUNT_ID}|g" \
  -e "s|{{AWS_REGION}}|${AWS_REGION}|g" \
  -e "s|{{IMAGE_URI}}|${IMAGE_URI}|g" \
  ecs/task-definition.json > "$TASK_DEF_FILE"

# ---------------------------------------------------------------------------
# Register task definition
# ---------------------------------------------------------------------------
echo "Registering ECS task definition..."
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json "file://${TASK_DEF_FILE}" \
  --region "$AWS_REGION" \
  --query "taskDefinition.taskDefinitionArn" --output text)
echo "Task Definition ARN: $TASK_DEF_ARN"
rm -f "$TASK_DEF_FILE"

# ---------------------------------------------------------------------------
# Prepare service definition JSON (replace placeholders)
# ---------------------------------------------------------------------------
echo ""
echo "Preparing service definition..."
SVC_DEF_FILE=$(mktemp /tmp/svc-def-XXXXXX.json)

# Extract subnet array elements for individual placeholders
SUBNET_1=$(echo "$SUBNETS_INPUT" | cut -d',' -f1 | tr -d ' ')
SUBNET_2=$(echo "$SUBNETS_INPUT" | cut -d',' -f2 | tr -d ' ')
if [ -z "$SUBNET_2" ]; then SUBNET_2="$SUBNET_1"; fi

sed \
  -e "s|{{CLUSTER_NAME}}|${CLUSTER_NAME}|g" \
  -e "s|{{SUBNET_1}}|${SUBNET_1}|g" \
  -e "s|{{SUBNET_2}}|${SUBNET_2}|g" \
  -e "s|{{SECURITY_GROUP}}|${SECURITY_GROUP}|g" \
  ecs/service-definition.json > "$SVC_DEF_FILE"

# ---------------------------------------------------------------------------
# Add or remove load balancer section in service definition
# ---------------------------------------------------------------------------
if [[ "$NEED_LB" =~ ^[Yy]$ ]] && [ -n "$TARGET_GROUP_ARN" ]; then
  # Inject loadBalancers and healthCheckGracePeriodSeconds using Python
  python3 - <<PYEOF
import json, sys
with open("$SVC_DEF_FILE") as f:
    svc = json.load(f)
svc["loadBalancers"] = [{
    "targetGroupArn": "$TARGET_GROUP_ARN",
    "containerName": "react-nextjs-host",
    "containerPort": $CONTAINER_PORT
}]
svc["healthCheckGracePeriodSeconds"] = 300
with open("$SVC_DEF_FILE", "w") as f:
    json.dump(svc, f, indent=2)
PYEOF
fi

# ---------------------------------------------------------------------------
# Create or update ECS service
# ---------------------------------------------------------------------------
echo ""
EXISTING_SERVICE=$(aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query "services[?status!='INACTIVE'].serviceName" \
  --output text 2>/dev/null || echo "")

if [ -z "$EXISTING_SERVICE" ] || [ "$EXISTING_SERVICE" = "None" ]; then
  echo "Creating ECS service: $SERVICE_NAME ..."
  aws ecs create-service \
    --cli-input-json "file://${SVC_DEF_FILE}" \
    --region "$AWS_REGION"
else
  echo "Updating existing ECS service: $SERVICE_NAME ..."
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --region "$AWS_REGION"
fi
rm -f "$SVC_DEF_FILE"

# ---------------------------------------------------------------------------
# Wait for service stability
# ---------------------------------------------------------------------------
echo ""
echo "Waiting for service to stabilize (this may take a few minutes)..."
aws ecs wait services-stable \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION"

# ---------------------------------------------------------------------------
# Verify deployment
# ---------------------------------------------------------------------------
echo ""
echo "Verifying deployment..."
aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query "services[0].{ServiceName:serviceName,Status:status,Running:runningCount,Desired:desiredCount,TaskDef:taskDefinition}" \
  --output table

echo ""
echo "=============================================="
echo "  Deployment Complete!"
echo "  Service:       $SERVICE_NAME"
echo "  Cluster:       $CLUSTER_NAME"
echo "  Region:        $AWS_REGION"
echo "  CloudWatch:    $LOG_GROUP"
if [ -n "$LB_DNS" ]; then
  echo "  Load Balancer: http://$LB_DNS"
fi
echo "=============================================="
echo ""
echo "Troubleshooting tips:"
echo "  - View logs:  aws logs tail $LOG_GROUP --follow --region $AWS_REGION"
echo "  - List tasks: aws ecs list-tasks --cluster $CLUSTER_NAME --region $AWS_REGION"
echo "  - Task logs:  aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks <TASK_ARN> --region $AWS_REGION"
