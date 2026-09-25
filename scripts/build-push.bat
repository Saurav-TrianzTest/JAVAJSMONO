@echo off
setlocal enabledelayedexpansion

REM =============================================================================
REM build-push.bat — Build and push the react-nextjs-host Docker image (Windows)
REM Usage: scripts\build-push.bat
REM Run from the repository root directory.
REM =============================================================================

set "PROJECT_NAME=react-nextjs-host"
set "DOCKERFILE_PATH=Dockerfile"

echo ==============================================
echo   react-nextjs-host -- Docker Build ^& Push
echo ==============================================
echo.

REM ---------------------------------------------------------------------------
REM Prompt for image tag
REM ---------------------------------------------------------------------------
set /p "IMAGE_TAG_INPUT=Enter image tag [latest]: "
if "!IMAGE_TAG_INPUT!"=="" set "IMAGE_TAG_INPUT=latest"

REM Sanitize tag: lowercase via PowerShell
for /f "delims=" %%i in ('powershell -Command "\"!IMAGE_TAG_INPUT!\".ToLower() -replace '[^a-z0-9._-]','-' -replace '^-+','' -replace '-+$',''"') do set "IMAGE_TAG=%%i"
if "!IMAGE_TAG!"=="" set "IMAGE_TAG=latest"
echo Using tag: !IMAGE_TAG!
echo.

REM ---------------------------------------------------------------------------
REM Registry selection
REM ---------------------------------------------------------------------------
echo Select container registry:
echo   1. AWS ECR
echo   2. Docker Hub
set /p "REGISTRY_CHOICE=Enter choice [1]: "
if "!REGISTRY_CHOICE!"=="" set "REGISTRY_CHOICE=1"

if "!REGISTRY_CHOICE!"=="1" goto :ecr_setup
if "!REGISTRY_CHOICE!"=="2" goto :dockerhub_setup
echo Invalid choice. Exiting.
exit /b 1

REM ---------------------------------------------------------------------------
REM AWS ECR
REM ---------------------------------------------------------------------------
:ecr_setup
echo.
echo --- AWS ECR Configuration ---
set /p "AWS_REGION=Enter AWS Region [us-east-1]: "
if "!AWS_REGION!"=="" set "AWS_REGION=us-east-1"

set /p "AWS_ACCOUNT_ID=Enter AWS Account ID (leave blank to auto-detect): "
if "!AWS_ACCOUNT_ID!"=="" (
    echo Fetching AWS Account ID from STS...
    for /f "delims=" %%i in ('aws sts get-caller-identity --query Account --output text') do set "AWS_ACCOUNT_ID=%%i"
    echo Account ID: !AWS_ACCOUNT_ID!
)

set /p "ECR_REPO_INPUT=Enter ECR repository name [react-nextjs-host]: "
if "!ECR_REPO_INPUT!"=="" set "ECR_REPO_INPUT=react-nextjs-host"
set "ECR_REPO=!ECR_REPO_INPUT!"

set "REGISTRY_URL=!AWS_ACCOUNT_ID!.dkr.ecr.!AWS_REGION!.amazonaws.com"
set "FULL_IMAGE_NAME=!REGISTRY_URL!/!ECR_REPO!:!IMAGE_TAG!"

echo.
echo Logging in to ECR...
aws ecr get-login-password --region !AWS_REGION! | docker login --username AWS --password-stdin !REGISTRY_URL!
if !ERRORLEVEL! neq 0 (
    echo ECR login failed.
    exit /b 1
)

echo Checking / creating ECR repository '!ECR_REPO!'...
aws ecr describe-repositories --repository-names !ECR_REPO! --region !AWS_REGION! >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo Creating ECR repository...
    aws ecr create-repository --repository-name !ECR_REPO! --region !AWS_REGION!
    if !ERRORLEVEL! neq 0 (
        echo Failed to create ECR repository.
        exit /b 1
    )
)
echo ECR repository ready.
goto :build

REM ---------------------------------------------------------------------------
REM Docker Hub
REM ---------------------------------------------------------------------------
:dockerhub_setup
echo.
echo --- Docker Hub Configuration ---
set /p "DOCKER_USERNAME=Enter Docker Hub username: "
set /p "DOCKER_PASSWORD=Enter Docker Hub password/token: "
set /p "DOCKER_REPO_INPUT=Enter Docker Hub repository [!DOCKER_USERNAME!/react-nextjs-host]: "
if "!DOCKER_REPO_INPUT!"=="" set "DOCKER_REPO_INPUT=!DOCKER_USERNAME!/react-nextjs-host"
set "FULL_IMAGE_NAME=!DOCKER_REPO_INPUT!:!IMAGE_TAG!"

echo.
echo Logging in to Docker Hub...
echo !DOCKER_PASSWORD! | docker login --username !DOCKER_USERNAME! --password-stdin
if !ERRORLEVEL! neq 0 (
    echo Docker Hub login failed.
    exit /b 1
)
goto :build

REM ---------------------------------------------------------------------------
REM Build
REM ---------------------------------------------------------------------------
:build
echo.
echo Building Docker image: !FULL_IMAGE_NAME!
echo Build context: . (repository root)
docker build -f "!DOCKERFILE_PATH!" -t "!FULL_IMAGE_NAME!" .
if !ERRORLEVEL! neq 0 (
    echo Docker build failed.
    exit /b 1
)
echo Build complete.

REM ---------------------------------------------------------------------------
REM Push
REM ---------------------------------------------------------------------------
echo.
echo Pushing image: !FULL_IMAGE_NAME!
docker push "!FULL_IMAGE_NAME!"
if !ERRORLEVEL! neq 0 (
    echo Docker push failed.
    exit /b 1
)

echo.
echo ==============================================
echo   Image pushed successfully!
echo   !FULL_IMAGE_NAME!
echo ==============================================

endlocal
exit /b 0
