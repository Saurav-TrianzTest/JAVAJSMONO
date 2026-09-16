@echo off
setlocal enabledelayedexpansion

:: =============================================================================
:: deploy-image.bat – Deploy react-nextjs-host to AWS ECS Fargate (Windows)
:: Usage: scripts\deploy-image.bat
:: Prerequisites: AWS CLI configured, Python 3 in PATH
:: =============================================================================

set "PROJECT_NAME=react-nextjs-host"
set "SERVICE_NAME=react-nextjs-host-service"
set "TASK_FAMILY=react-nextjs-host-task"
set "LOG_GROUP=/ecs/react-nextjs-host"

echo ==============================================
echo   Deploy: react-nextjs-host to AWS ECS Fargate
echo ==============================================

:: ── AWS region ────────────────────────────────────────────────────────────────
set /p "AWS_REGION=Enter AWS region [us-east-1]: "
if "!AWS_REGION!"=="" set "AWS_REGION=us-east-1"

:: ── Account ID ────────────────────────────────────────────────────────────────
echo Retrieving AWS Account ID...
for /f "delims=" %%i in ('aws sts get-caller-identity --query Account --output text') do set "ACCOUNT_ID=%%i"
echo Account ID: !ACCOUNT_ID!

:: ── ECS Cluster ───────────────────────────────────────────────────────────────
set /p "CLUSTER_NAME=Enter ECS cluster name [react-nextjs-host-cluster]: "
if "!CLUSTER_NAME!"=="" set "CLUSTER_NAME=react-nextjs-host-cluster"

echo Checking ECS cluster '!CLUSTER_NAME!'...
for /f "delims=" %%i in ('aws ecs describe-clusters --clusters !CLUSTER_NAME! --region !AWS_REGION! --query "clusters[0].status" --output text 2^>nul') do set "CLUSTER_STATUS=%%i"
if "!CLUSTER_STATUS!" neq "ACTIVE" (
    echo Creating ECS cluster '!CLUSTER_NAME!'...
    aws ecs create-cluster --cluster-name !CLUSTER_NAME! --region !AWS_REGION!
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create cluster.
        exit /b 1
    )
)
echo Cluster '!CLUSTER_NAME!' is ready.

:: ── Network configuration ─────────────────────────────────────────────────────
echo.
echo --- Network Configuration ---
set /p "VPC_ID=Enter VPC ID: "
set /p "SUBNETS_INPUT=Enter subnet IDs (comma-separated, e.g. subnet-aaa,subnet-bbb): "
set /p "SECURITY_GROUP=Enter security group ID: "

:: Parse subnets
for /f "tokens=1,2 delims=," %%a in ("!SUBNETS_INPUT!") do (
    set "SUBNET_1=%%a"
    set "SUBNET_2=%%b"
)
if "!SUBNET_2!"=="" set "SUBNET_2=!SUBNET_1!"

:: Trim spaces
for /f "tokens=*" %%i in ("!SUBNET_1!") do set "SUBNET_1=%%i"
for /f "tokens=*" %%i in ("!SUBNET_2!") do set "SUBNET_2=%%i"

:: ── Image URI ─────────────────────────────────────────────────────────────────
echo.
set /p "IMAGE_URI=Enter full image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest): "

:: ── CloudWatch log group ──────────────────────────────────────────────────────
echo.
echo Ensuring CloudWatch log group '!LOG_GROUP!' exists...
aws logs create-log-group --log-group-name !LOG_GROUP! --region !AWS_REGION! >nul 2>&1

:: ── Prepare task definition ───────────────────────────────────────────────────
echo Preparing task definition...
copy /Y ecs\task-definition.json %TEMP%\task-definition-deploy.json >nul

powershell -NoProfile -Command ^
  "(Get-Content '%TEMP%\task-definition-deploy.json') -replace '{{IMAGE_URI}}','!IMAGE_URI!' -replace '{{AWS_REGION}}','!AWS_REGION!' -replace '{{ACCOUNT_ID}}','!ACCOUNT_ID!' | Set-Content '%TEMP%\task-definition-deploy.json'"

:: ── Register task definition ──────────────────────────────────────────────────
echo Registering task definition '!TASK_FAMILY!'...
for /f "delims=" %%i in ('aws ecs register-task-definition --cli-input-json file://%TEMP%/task-definition-deploy.json --region !AWS_REGION! --query "taskDefinition.taskDefinitionArn" --output text') do set "TASK_DEF_ARN=%%i"
if !ERRORLEVEL! neq 0 (
    echo ERROR: Failed to register task definition.
    exit /b 1
)
echo Registered: !TASK_DEF_ARN!

:: ── Load balancer ─────────────────────────────────────────────────────────────
echo.
set /p "NEED_LB=Do you need an Application Load Balancer for this service? (y/n) [n]: "
if "!NEED_LB!"=="" set "NEED_LB=n"

set "USE_LB=false"
set "TARGET_GROUP_ARN="
set "ALB_DNS="

if /i "!NEED_LB!"=="y" (
    set "USE_LB=true"
    echo.
    echo Creating Application Load Balancer...

    set "ALB_NAME=!PROJECT_NAME!-alb"
    set "TG_NAME=!PROJECT_NAME!-tg"

    for /f "delims=" %%i in ('aws elbv2 create-load-balancer --name !ALB_NAME! --subnets !SUBNET_1! !SUBNET_2! --security-groups !SECURITY_GROUP! --scheme internet-facing --type application --region !AWS_REGION! --query "LoadBalancers[0].LoadBalancerArn" --output text') do set "ALB_ARN=%%i"
    echo ALB ARN: !ALB_ARN!

    for /f "delims=" %%i in ('aws elbv2 describe-load-balancers --load-balancer-arns !ALB_ARN! --region !AWS_REGION! --query "LoadBalancers[0].DNSName" --output text') do set "ALB_DNS=%%i"

    for /f "delims=" %%i in ('aws elbv2 create-target-group --name !TG_NAME! --protocol HTTP --port 8080 --vpc-id !VPC_ID! --target-type ip --health-check-path "/api/health" --health-check-interval-seconds 30 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region !AWS_REGION! --query "TargetGroups[0].TargetGroupArn" --output text') do set "TARGET_GROUP_ARN=%%i"
    echo Target Group ARN: !TARGET_GROUP_ARN!

    aws elbv2 create-listener --load-balancer-arn !ALB_ARN! --protocol HTTP --port 80 --default-actions "Type=forward,TargetGroupArn=!TARGET_GROUP_ARN!" --region !AWS_REGION! >nul
    echo Listener created on port 80.
)

:: ── Prepare service definition ────────────────────────────────────────────────
echo Preparing service definition...
copy /Y ecs\service-definition.json %TEMP%\service-definition-deploy.json >nul

powershell -NoProfile -Command ^
  "(Get-Content '%TEMP%\service-definition-deploy.json') -replace '{{CLUSTER_NAME}}','!CLUSTER_NAME!' -replace '{{SUBNET_1}}','!SUBNET_1!' -replace '{{SUBNET_2}}','!SUBNET_2!' -replace '{{SECURITY_GROUP}}','!SECURITY_GROUP!' | Set-Content '%TEMP%\service-definition-deploy.json'"

if "!USE_LB!"=="true" (
    powershell -NoProfile -Command ^
      "$svc = Get-Content '%TEMP%\service-definition-deploy.json' | ConvertFrom-Json; $svc | Add-Member -Force -NotePropertyName 'loadBalancers' -NotePropertyValue @(@{targetGroupArn='!TARGET_GROUP_ARN!'; containerName='react-nextjs-host'; containerPort=8080}); $svc | Add-Member -Force -NotePropertyName 'healthCheckGracePeriodSeconds' -NotePropertyValue 300; $svc | ConvertTo-Json -Depth 10 | Set-Content '%TEMP%\service-definition-deploy.json'"
)

:: ── Create or update ECS service ──────────────────────────────────────────────
echo Checking if service '!SERVICE_NAME!' already exists...
for /f "delims=" %%i in ('aws ecs describe-services --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION! --query "services[?status!='INACTIVE'].serviceName" --output text 2^>nul') do set "EXISTING_SERVICE=%%i"

if "!EXISTING_SERVICE!"=="" (
    echo Creating new ECS service '!SERVICE_NAME!'...
    aws ecs create-service --cli-input-json file://%TEMP%/service-definition-deploy.json --region !AWS_REGION!
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create service.
        exit /b 1
    )
) else (
    echo Updating existing ECS service '!SERVICE_NAME!'...
    aws ecs update-service --cluster !CLUSTER_NAME! --service !SERVICE_NAME! --task-definition !TASK_DEF_ARN! --desired-count 2 --region !AWS_REGION!
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to update service.
        exit /b 1
    )
)

:: ── Wait for stability ────────────────────────────────────────────────────────
echo.
echo Waiting for service to stabilize (this may take a few minutes)...
aws ecs wait services-stable --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION!
if !ERRORLEVEL! neq 0 (
    echo WARNING: Service did not stabilize within the expected time. Check ECS console.
)

:: ── Verify deployment ─────────────────────────────────────────────────────────
echo.
echo Deployment verification:
aws ecs describe-services --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION! --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount}" --output table

echo.
echo ==============================================
echo   DEPLOYMENT COMPLETE
echo   Service : !SERVICE_NAME!
echo   Cluster : !CLUSTER_NAME!
echo   Region  : !AWS_REGION!
echo   Logs    : !LOG_GROUP!
if "!USE_LB!"=="true" echo   App URL : http://!ALB_DNS!
echo ==============================================
echo.
echo Troubleshooting tips:
echo   View logs  : aws logs tail !LOG_GROUP! --follow --region !AWS_REGION!
echo   List tasks : aws ecs list-tasks --cluster !CLUSTER_NAME! --service-name !SERVICE_NAME! --region !AWS_REGION!

endlocal
