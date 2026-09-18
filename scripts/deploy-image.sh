#!/usr/bin/env bash
# =============================================================================
# deploy-image.sh — Deploy react-nextjs-host to AWS ECS Fargate
# Usage: ./scripts/deploy-image.sh  (run from repository root)
# =============================================================================
set -e
set -o pipefail

SERVICE_NAME="react-nextjs-host-service"
TASK_FAMILY="react-nextjs-host-task"
LOG_GROUP="/ecs/react-nextjs-host"
TASK_DEF_FILE="ecs/task-definition.json"
SVC_DEF_FILE="ecs/service-definition.json"

echo "=============================================="
echo "  Deploy react-nextjs-host to AWS ECS Fargate"
echo "=============================================="

# ── Gather inputs ─────────────────────────────────────────────────────────────
read -rp "Enter AWS Region [us-east-1]: " AWS_REGION
AWS_REGION="${AWS_REGION:-us-east-1}"

read -rp "Enter ECS Cluster name [react-nextjs-host-cluster]: " CLUSTER_NAME
CLUSTER_NAME="${CLUSTER_NAME:-react-nextjs-host-cluster}"

read -rp "Enter ECR Image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest): " IMAGE_URI
if [ -z "$IMAGE_URI" ]; then
  echo "ERROR: Image URI is required." >&2
  exit 1
fi

read -rp "Enter VPC ID: " VPC_ID
if [ -z "$VPC_ID" ]; then
  echo "ERROR: VPC ID is required." >&2
  exit 1
fi

read -rp "Enter Subnet IDs (comma-separated, e.g. subnet-aaa,subnet-bbb): " SUBNETS_INPUT
if [ -z "$SUBNETS_INPUT" ]; then
  echo "ERROR: At least one subnet is required." >&2
  exit 1
fi
SUBNET_1=$(echo "$SUBNETS_INPUT" | cut -d',' -f1 | tr -d ' ')
SUBNET_2=$(echo "$SUBNETS_INPUT" | cut -d',' -f2 | tr -d ' ')
if [ -z "$SUBNET_2" ]; then SUBNET_2="$SUBNET_1"; fi

read -rp "Enter Security Group ID: " SECURITY_GROUP
if [ -z "$SECURITY_GROUP" ]; then
  echo "ERROR: Security Group ID is required." >&2
  exit 1
fi

# ── Resolve AWS Account ID ────────────────────────────────────────────────────
echo ""
echo "Resolving AWS Account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: $ACCOUNT_ID"

# ── Ensure CloudWatch log group exists ────────────────────────────────────────
echo ""
echo "Ensuring CloudWatch log group '$LOG_GROUP' exists..."
aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$AWS_REGION" 2>/dev/null || true

# ── Ensure ECS cluster exists ─────────────────────────────────────────────────
echo "Checking ECS cluster '$CLUSTER_NAME'..."
CLUSTER_STATUS=$(aws ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$AWS_REGION" \
  --query "clusters[0].status" --output text 2>/dev/null || echo "MISSING")
if [ "$CLUSTER_STATUS" != "ACTIVE" ]; then
  echo "Creating ECS cluster '$CLUSTER_NAME'..."
  aws ecs create-cluster --cluster-name "$CLUSTER_NAME" --region "$AWS_REGION"
fi

# ── Load balancer prompt ──────────────────────────────────────────────────────
echo ""
read -rp "Do you need an Application Load Balancer for this service? (y/n) [n]: " NEED_LB
NEED_LB="${NEED_LB:-n}"

TARGET_GROUP_ARN=""
ALB_DNS=""
if [[ "$NEED_LB" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Creating Application Load Balancer..."

  # Resolve subnet IDs into an array for ALB (needs at least 2 AZs)
  SUBNET_ARRAY=()
  IFS=',' read -ra SUBNET_ARRAY <<< "$SUBNETS_INPUT"

  ALB_ARN=$(aws elbv2 create-load-balancer \
    --name "react-nextjs-host-alb" \
    --subnets "${SUBNET_ARRAY[@]}" \
    --security-groups "$SECURITY_GROUP" \
    --scheme internet-facing \
    --type application \
    --region "$AWS_REGION" \
    --query "LoadBalancers[0].LoadBalancerArn" --output text)
  echo "ALB ARN: $ALB_ARN"

  ALB_DNS=$(aws elbv2 describe-load-balancers \
    --load-balancer-arns "$ALB_ARN" \
    --region "$AWS_REGION" \
    --query "LoadBalancers[0].DNSName" --output text)

  echo "Creating Target Group (target-type: ip for Fargate awsvpc)..."
  TARGET_GROUP_ARN=$(aws elbv2 create-target-group \
    --name "react-nextjs-host-tg" \
    --protocol HTTP \
    --port 8080 \
    --vpc-id "$VPC_ID" \
    --target-type ip \
    --health-check-path "/api/health" \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --region "$AWS_REGION" \
    --query "TargetGroups[0].TargetGroupArn" --output text)
  echo "Target Group ARN: $TARGET_GROUP_ARN"

  # Create listener
  aws elbv2 create-listener \
    --load-balancer-arn "$ALB_ARN" \
    --protocol HTTP \
    --port 80 \
    --default-actions "Type=forward,TargetGroupArn=$TARGET_GROUP_ARN" \
    --region "$AWS_REGION" >/dev/null
fi

# ── Prepare task definition JSON ──────────────────────────────────────────────
echo ""
echo "Preparing task definition..."
TASK_DEF_TMP=$(mktemp /tmp/task-def-XXXXXX.json)
cp "$TASK_DEF_FILE" "$TASK_DEF_TMP"

sed -i "s|{{IMAGE_URI}}|${IMAGE_URI}|g"     "$TASK_DEF_TMP"
sed -i "s|{{AWS_REGION}}|${AWS_REGION}|g"   "$TASK_DEF_TMP"
sed -i "s|{{ACCOUNT_ID}}|${ACCOUNT_ID}|g"   "$TASK_DEF_TMP"

# ── Register task definition ──────────────────────────────────────────────────
echo "Registering task definition..."
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json "file://${TASK_DEF_TMP}" \
  --region "$AWS_REGION" \
  --query "taskDefinition.taskDefinitionArn" --output text)
echo "Task Definition ARN: $TASK_DEF_ARN"
rm -f "$TASK_DEF_TMP"

# ── Prepare service definition JSON ──────────────────────────────────────────
echo "Preparing service definition..."
SVC_DEF_TMP=$(mktemp /tmp/svc-def-XXXXXX.json)
cp "$SVC_DEF_FILE" "$SVC_DEF_TMP"

sed -i "s|{{CLUSTER_NAME}}|${CLUSTER_NAME}|g"     "$SVC_DEF_TMP"
sed -i "s|{{SUBNET_1}}|${SUBNET_1}|g"             "$SVC_DEF_TMP"
sed -i "s|{{SUBNET_2}}|${SUBNET_2}|g"             "$SVC_DEF_TMP"
sed -i "s|{{SECURITY_GROUP}}|${SECURITY_GROUP}|g" "$SVC_DEF_TMP"

# Inject load balancer config if requested
if [[ "$NEED_LB" =~ ^[Yy]$ ]]; then
  python3 - <<PYEOF "$SVC_DEF_TMP" "$TARGET_GROUP_ARN"
import json, sys
path, tg_arn = sys.argv[1], sys.argv[2]
with open(path) as f:
    d = json.load(f)
d["loadBalancers"] = [{
    "targetGroupArn": tg_arn,
    "containerName": "react-nextjs-host",
    "containerPort": 8080
}]
d["healthCheckGracePeriodSeconds"] = 300
with open(path, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF
fi

# ── Create or update ECS service ──────────────────────────────────────────────
echo ""
EXISTING_SERVICE=$(aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query "services[?status=='ACTIVE'].serviceName" \
  --output text 2>/dev/null || echo "")

if [ -z "$EXISTING_SERVICE" ] || [ "$EXISTING_SERVICE" = "None" ]; then
  echo "Creating ECS service '$SERVICE_NAME'..."
  aws ecs create-service \
    --cli-input-json "file://${SVC_DEF_TMP}" \
    --region "$AWS_REGION"
else
  echo "Updating existing ECS service '$SERVICE_NAME'..."
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --region "$AWS_REGION"
fi
rm -f "$SVC_DEF_TMP"

# ── Wait for stability ────────────────────────────────────────────────────────
echo ""
echo "Waiting for service to stabilize (this may take a few minutes)..."
aws ecs wait services-stable \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION"

# ── Verify deployment ─────────────────────────────────────────────────────────
echo ""
echo "Deployment complete. Service details:"
aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount,TaskDef:taskDefinition}" \
  --output table

echo ""
echo "CloudWatch Log Group: $LOG_GROUP"
if [ -n "$ALB_DNS" ]; then
  echo "Application URL:      http://$ALB_DNS"
fi
echo ""
echo "Troubleshooting tips:"
echo "  - View logs:  aws logs tail $LOG_GROUP --follow --region $AWS_REGION"
echo "  - List tasks: aws ecs list-tasks --cluster $CLUSTER_NAME --region $AWS_REGION"
echo "  - Task detail: aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks <TASK_ARN> --region $AWS_REGION"
echo "=============================================="
echo "  Deployment finished successfully!"
echo "=============================================="
