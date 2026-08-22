@echo off
setlocal enabledelayedexpansion

:: =============================================================================
:: build-push.bat – Build and push the react-nextjs-host Docker image (Windows)
:: Supports: AWS ECR and Docker Hub
:: Usage: scripts\build-push.bat  (run from repository root)
:: =============================================================================

set "PROJECT_NAME=react-nextjs-host"
set "DOCKERFILE_PATH=Dockerfile"

echo ==============================================
echo   react-nextjs-host - Docker Build ^& Push
echo ==============================================
echo.

:: ---------------------------------------------------------------------------
:: Prompt for image tag
:: ---------------------------------------------------------------------------
set /p "IMAGE_TAG_INPUT=Enter image tag [latest]: "
if "!IMAGE_TAG_INPUT!"=="" (
    set "IMAGE_TAG=latest"
) else (
    set "IMAGE_TAG=!IMAGE_TAG_INPUT!"
)
echo Using tag: !IMAGE_TAG!
echo.

:: ---------------------------------------------------------------------------
:: Registry selection
:: ---------------------------------------------------------------------------
echo Select container registry:
echo   1. AWS ECR
echo   2. Docker Hub
set /p "REGISTRY_CHOICE=Enter choice [1]: "
if "!REGISTRY_CHOICE!"=="" set "REGISTRY_CHOICE=1"

:: ---------------------------------------------------------------------------
:: Registry-specific configuration
:: ---------------------------------------------------------------------------
if "!REGISTRY_CHOICE!"=="1" (
    echo.
    echo --- AWS ECR Configuration ---
    set /p "AWS_REGION=Enter AWS Region [us-east-1]: "
    if "!AWS_REGION!"=="" set "AWS_REGION=us-east-1"

    set /p "ECR_REPO_INPUT=Enter ECR repository name [react-nextjs-host]: "
    if "!ECR_REPO_INPUT!"=="" (
        set "ECR_REPO=react-nextjs-host"
    ) else (
        set "ECR_REPO=!ECR_REPO_INPUT!"
    )

    echo.
    echo Retrieving AWS Account ID...
    for /f "tokens=*" %%i in ('aws sts get-caller-identity --query Account --output text') do set "ACCOUNT_ID=%%i"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to retrieve AWS Account ID. Check AWS CLI configuration.
        exit /b 1
    )

    set "REGISTRY_URL=!ACCOUNT_ID!.dkr.ecr.!AWS_REGION!.amazonaws.com"
    set "FULL_IMAGE_NAME=!REGISTRY_URL!/!ECR_REPO!:!IMAGE_TAG!"

    echo.
    echo Logging in to ECR...
    aws ecr get-login-password --region !AWS_REGION! | docker login --username AWS --password-stdin !REGISTRY_URL!
    if !ERRORLEVEL! neq 0 (
        echo ERROR: ECR login failed.
        exit /b 1
    )

    echo Checking ECR repository...
    aws ecr describe-repositories --repository-names !ECR_REPO! --region !AWS_REGION! >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo Creating ECR repository: !ECR_REPO!
        aws ecr create-repository --repository-name !ECR_REPO! --region !AWS_REGION!
        if !ERRORLEVEL! neq 0 (
            echo ERROR: Failed to create ECR repository.
            exit /b 1
        )
    )
    echo ECR repository ready: !ECR_REPO!

) else if "!REGISTRY_CHOICE!"=="2" (
    echo.
    echo --- Docker Hub Configuration ---
    set /p "DOCKER_USERNAME=Enter Docker Hub username: "
    set /p "DOCKER_PASSWORD=Enter Docker Hub password/token: "
    set /p "DOCKER_REPO_INPUT=Enter Docker Hub repository [!DOCKER_USERNAME!/react-nextjs-host]: "
    if "!DOCKER_REPO_INPUT!"=="" (
        set "FULL_IMAGE_NAME=!DOCKER_USERNAME!/react-nextjs-host:!IMAGE_TAG!"
    ) else (
        set "FULL_IMAGE_NAME=!DOCKER_REPO_INPUT!:!IMAGE_TAG!"
    )

    echo.
    echo Logging in to Docker Hub...
    echo !DOCKER_PASSWORD! | docker login --username !DOCKER_USERNAME! --password-stdin
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Docker Hub login failed.
        exit /b 1
    )

) else (
    echo ERROR: Invalid choice. Exiting.
    exit /b 1
)

:: ---------------------------------------------------------------------------
:: Build Docker image (build context is repository root)
:: ---------------------------------------------------------------------------
echo.
echo Building Docker image: !FULL_IMAGE_NAME!
echo Build context: . (repository root)
docker build -f "!DOCKERFILE_PATH!" -t "!FULL_IMAGE_NAME!" .
if !ERRORLEVEL! neq 0 (
    echo ERROR: Docker build failed.
    exit /b 1
)

echo.
echo Build successful: !FULL_IMAGE_NAME!

:: ---------------------------------------------------------------------------
:: Push image
:: ---------------------------------------------------------------------------
echo.
echo Pushing image to registry...
docker push "!FULL_IMAGE_NAME!"
if !ERRORLEVEL! neq 0 (
    echo ERROR: Docker push failed.
    exit /b 1
)

echo.
echo ==============================================
echo   Image pushed successfully!
echo   !FULL_IMAGE_NAME!
echo ==============================================

endlocal
