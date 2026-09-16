#!/usr/bin/env bash
# =============================================================================
# build-push.sh – Build and push the react-nextjs-host Docker image
# Usage: ./scripts/build-push.sh
# Run from the repository root directory.
# =============================================================================
set -e
set -o pipefail

PROJECT_NAME="react-nextjs-host"

# ── Sanitize image name (lowercase, hyphens only) ────────────────────────────
IMAGE_NAME=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//;s/-*$//')

echo "=============================================="
echo "  Build & Push: $IMAGE_NAME"
echo "=============================================="

# ── Prompt for image tag ──────────────────────────────────────────────────────
read -rp "Enter image tag [latest]: " IMAGE_TAG_INPUT
IMAGE_TAG=$(echo "${IMAGE_TAG_INPUT:-latest}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed 's/^-*//;s/-*$//')
if [ -z "$IMAGE_TAG" ]; then
  IMAGE_TAG="latest"
fi
echo "Using tag: $IMAGE_TAG"

# ── Registry selection ────────────────────────────────────────────────────────
echo ""
echo "Select container registry:"
echo "  1) AWS ECR"
echo "  2) Docker Hub"
read -rp "Enter choice [1]: " REGISTRY_CHOICE
REGISTRY_CHOICE="${REGISTRY_CHOICE:-1}"

if [ "$REGISTRY_CHOICE" = "1" ]; then
  # ── AWS ECR ────────────────────────────────────────────────────────────────
  read -rp "Enter AWS region [us-east-1]: " AWS_REGION
  AWS_REGION="${AWS_REGION:-us-east-1}"

  read -rp "Enter AWS Account ID (leave blank to auto-detect): " AWS_ACCOUNT_ID
  if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo "Auto-detecting AWS Account ID..."
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    echo "Detected Account ID: $AWS_ACCOUNT_ID"
  fi

  read -rp "Enter ECR repository name [$IMAGE_NAME]: " ECR_REPO_INPUT
  ECR_REPO="${ECR_REPO_INPUT:-$IMAGE_NAME}"

  REGISTRY_URL="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  FULL_IMAGE_NAME="${REGISTRY_URL}/${ECR_REPO}:${IMAGE_TAG}"

  echo ""
  echo "Logging in to ECR..."
  aws ecr get-login-password --region "$AWS_REGION" | \
    docker login --username AWS --password-stdin "$REGISTRY_URL"

  echo "Checking / creating ECR repository '$ECR_REPO'..."
  aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$AWS_REGION" >/dev/null 2>&1 || \
    aws ecr create-repository --repository-name "$ECR_REPO" --region "$AWS_REGION"

elif [ "$REGISTRY_CHOICE" = "2" ]; then
  # ── Docker Hub ─────────────────────────────────────────────────────────────
  read -rp "Enter Docker Hub username: " DOCKER_USERNAME
  read -rsp "Enter Docker Hub password/token: " DOCKER_PASSWORD
  echo ""
  read -rp "Enter Docker Hub repository [$DOCKER_USERNAME/$IMAGE_NAME]: " DOCKER_REPO_INPUT
  DOCKER_REPO="${DOCKER_REPO_INPUT:-$DOCKER_USERNAME/$IMAGE_NAME}"

  FULL_IMAGE_NAME="${DOCKER_REPO}:${IMAGE_TAG}"

  echo ""
  echo "Logging in to Docker Hub..."
  echo "$DOCKER_PASSWORD" | docker login --username "$DOCKER_USERNAME" --password-stdin

else
  echo "ERROR: Invalid registry choice '$REGISTRY_CHOICE'. Exiting."
  exit 1
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo ""
echo "Building Docker image: $FULL_IMAGE_NAME"
echo "Build context: $(pwd)"
docker build -f Dockerfile -t "$FULL_IMAGE_NAME" .

echo ""
echo "Tagging image as $IMAGE_NAME:$IMAGE_TAG locally..."
docker tag "$FULL_IMAGE_NAME" "$IMAGE_NAME:$IMAGE_TAG"

# ── Push ──────────────────────────────────────────────────────────────────────
echo ""
echo "Pushing image: $FULL_IMAGE_NAME"
docker push "$FULL_IMAGE_NAME"

echo ""
echo "=============================================="
echo "  SUCCESS"
echo "  Image: $FULL_IMAGE_NAME"
echo "=============================================="
