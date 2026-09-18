@echo off
setlocal enabledelayedexpansion

:: =============================================================================
:: deploy-image.bat — Deploy react-nextjs-host to AWS ECS Fargate (Windows)
:: Usage: scripts\deploy-image.bat  (run from repository root)
:: =============================================================================

set "SERVICE_NAME=react-nextjs-host-service"
set "TASK_FAMILY=react-nextjs-host-task"
set "LOG_GROUP=/ecs/react-nextjs-host"
set "TASK_DEF_FILE=ecs\task-definition.json"
set "SVC_DEF_FILE=ecs\service-definition.json"

echo ==============================================
echo   Deploy react-nextjs-host to AWS ECS Fargate
echo ==============================================

:: ── Gather inputs ─────────────────────────────────────────────────────────────
set /p "AWS_REGION=Enter AWS Region [us-east-1]: "
if "!AWS_REGION!"=="" set "AWS_REGION=us-east-1"

set /p "CLUSTER_NAME=Enter ECS Cluster name [react-nextjs-host-cluster]: "
if "!CLUSTER_NAME!"=="" set "CLUSTER_NAME=react-nextjs-host-cluster"

set /p "IMAGE_URI=Enter ECR Image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest): "
if "!IMAGE_URI!"=="" (
    echo ERROR: Image URI is required.
    exit /b 1
)

set /p "VPC_ID=Enter VPC ID: "
if "!VPC_ID!"=="" (
    echo ERROR: VPC ID is required.
    exit /b 1
)

set /p "SUBNETS_INPUT=Enter Subnet IDs (comma-separated, e.g. subnet-aaa,subnet-bbb): "
if "!SUBNETS_INPUT!"=="" (
    echo ERROR: At least one subnet is required.
    exit /b 1
)

:: Parse first two subnets
for /f "tokens=1,2 delims=," %%a in ("!SUBNETS_INPUT!") do (
    set "SUBNET_1=%%a"
    set "SUBNET_2=%%b"
)
if "!SUBNET_2!"=="" set "SUBNET_2=!SUBNET_1!"

set /p "SECURITY_GROUP=Enter Security Group ID: "
if "!SECURITY_GROUP!"=="" (
    echo ERROR: Security Group ID is required.
    exit /b 1
)

:: ── Resolve AWS Account ID ────────────────────────────────────────────────────
echo.
echo Resolving AWS Account ID...
for /f "delims=" %%i in ('aws sts get-caller-identity --query Account --output text') do set "ACCOUNT_ID=%%i"
echo Account ID: !ACCOUNT_ID!

:: ── Ensure CloudWatch log group exists ────────────────────────────────────────
echo.
echo Ensuring CloudWatch log group '!LOG_GROUP!' exists...
aws logs create-log-group --log-group-name "!LOG_GROUP!" --region "!AWS_REGION!" >nul 2>&1

:: ── Ensure ECS cluster exists ─────────────────────────────────────────────────
echo Checking ECS cluster '!CLUSTER_NAME!'...
for /f "delims=" %%i in ('aws ecs describe-clusters --clusters "!CLUSTER_NAME!" --region "!AWS_REGION!" --query "clusters[0].status" --output text 2^>nul') do set "CLUSTER_STATUS=%%i"
if not "!CLUSTER_STATUS!"=="ACTIVE" (
    echo Creating ECS cluster '!CLUSTER_NAME!'...
    aws ecs create-cluster --cluster-name "!CLUSTER_NAME!" --region "!AWS_REGION!"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create ECS cluster.
        exit /b 1
    )
)

:: ── Load balancer prompt ──────────────────────────────────────────────────────
echo.
set /p "NEED_LB=Do you need an Application Load Balancer for this service? (y/n) [n]: "
if "!NEED_LB!"=="" set "NEED_LB=n"

set "TARGET_GROUP_ARN="
set "ALB_DNS="

if /i "!NEED_LB!"=="y" (
    echo.
    echo Creating Application Load Balancer...

    for /f "delims=" %%i in ('aws elbv2 create-load-balancer --name "react-nextjs-host-alb" --subnets !SUBNETS_INPUT! --security-groups "!SECURITY_GROUP!" --scheme internet-facing --type application --region "!AWS_REGION!" --query "LoadBalancers[0].LoadBalancerArn" --output text') do set "ALB_ARN=%%i"
    echo ALB ARN: !ALB_ARN!

    for /f "delims=" %%i in ('aws elbv2 describe-load-balancers --load-balancer-arns "!ALB_ARN!" --region "!AWS_REGION!" --query "LoadBalancers[0].DNSName" --output text') do set "ALB_DNS=%%i"

    echo Creating Target Group...
    for /f "delims=" %%i in ('aws elbv2 create-target-group --name "react-nextjs-host-tg" --protocol HTTP --port 8080 --vpc-id "!VPC_ID!" --target-type ip --health-check-path "/api/health" --health-check-interval-seconds 30 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region "!AWS_REGION!" --query "TargetGroups[0].TargetGroupArn" --output text') do set "TARGET_GROUP_ARN=%%i"
    echo Target Group ARN: !TARGET_GROUP_ARN!

    aws elbv2 create-listener --load-balancer-arn "!ALB_ARN!" --protocol HTTP --port 80 --default-actions "Type=forward,TargetGroupArn=!TARGET_GROUP_ARN!" --region "!AWS_REGION!" >nul
)

:: ── Prepare task definition (copy and replace placeholders via PowerShell) ────
echo.
echo Preparing task definition...
set "TASK_DEF_TMP=%TEMP%\task-def-tmp.json"
copy /y "!TASK_DEF_FILE!" "!TASK_DEF_TMP!" >nul

powershell -NoProfile -Command ^
  "(Get-Content '!TASK_DEF_TMP!') -replace '{{IMAGE_URI}}','!IMAGE_URI!' -replace '{{AWS_REGION}}','!AWS_REGION!' -replace '{{ACCOUNT_ID}}','!ACCOUNT_ID!' | Set-Content '!TASK_DEF_TMP!'"

:: ── Register task definition ──────────────────────────────────────────────────
echo Registering task definition...
for /f "delims=" %%i in ('aws ecs register-task-definition --cli-input-json "file://!TASK_DEF_TMP!" --region "!AWS_REGION!" --query "taskDefinition.taskDefinitionArn" --output text') do set "TASK_DEF_ARN=%%i"
echo Task Definition ARN: !TASK_DEF_ARN!
del /f /q "!TASK_DEF_TMP!" >nul 2>&1

:: ── Prepare service definition ────────────────────────────────────────────────
echo Preparing service definition...
set "SVC_DEF_TMP=%TEMP%\svc-def-tmp.json"
copy /y "!SVC_DEF_FILE!" "!SVC_DEF_TMP!" >nul

powershell -NoProfile -Command ^
  "(Get-Content '!SVC_DEF_TMP!') -replace '{{CLUSTER_NAME}}','!CLUSTER_NAME!' -replace '{{SUBNET_1}}','!SUBNET_1!' -replace '{{SUBNET_2}}','!SUBNET_2!' -replace '{{SECURITY_GROUP}}','!SECURITY_GROUP!' | Set-Content '!SVC_DEF_TMP!'"

if /i "!NEED_LB!"=="y" (
    powershell -NoProfile -Command ^
      "$d = Get-Content '!SVC_DEF_TMP!' | ConvertFrom-Json; $lb = @{targetGroupArn='!TARGET_GROUP_ARN!'; containerName='react-nextjs-host'; containerPort=8080}; $d | Add-Member -NotePropertyName 'loadBalancers' -NotePropertyValue @($lb) -Force; $d | Add-Member -NotePropertyName 'healthCheckGracePeriodSeconds' -NotePropertyValue 300 -Force; $d | ConvertTo-Json -Depth 10 | Set-Content '!SVC_DEF_TMP!'"
)

:: ── Create or update ECS service ──────────────────────────────────────────────
echo.
for /f "delims=" %%i in ('aws ecs describe-services --cluster "!CLUSTER_NAME!" --services "!SERVICE_NAME!" --region "!AWS_REGION!" --query "services[?status==''ACTIVE''].serviceName" --output text 2^>nul') do set "EXISTING_SERVICE=%%i"

if "!EXISTING_SERVICE!"=="" (
    echo Creating ECS service '!SERVICE_NAME!'...
    aws ecs create-service --cli-input-json "file://!SVC_DEF_TMP!" --region "!AWS_REGION!"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create ECS service.
        del /f /q "!SVC_DEF_TMP!" >nul 2>&1
        exit /b 1
    )
) else (
    echo Updating existing ECS service '!SERVICE_NAME!'...
    aws ecs update-service --cluster "!CLUSTER_NAME!" --service "!SERVICE_NAME!" --task-definition "!TASK_DEF_ARN!" --region "!AWS_REGION!"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to update ECS service.
        del /f /q "!SVC_DEF_TMP!" >nul 2>&1
        exit /b 1
    )
)
del /f /q "!SVC_DEF_TMP!" >nul 2>&1

:: ── Wait for stability ────────────────────────────────────────────────────────
echo.
echo Waiting for service to stabilize (this may take a few minutes)...
aws ecs wait services-stable --cluster "!CLUSTER_NAME!" --services "!SERVICE_NAME!" --region "!AWS_REGION!"
if !ERRORLEVEL! neq 0 (
    echo WARNING: Service did not stabilize within the expected time. Check ECS console.
)

:: ── Verify deployment ─────────────────────────────────────────────────────────
echo.
echo Deployment complete. Service details:
aws ecs describe-services --cluster "!CLUSTER_NAME!" --services "!SERVICE_NAME!" --region "!AWS_REGION!" --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount}" --output table

echo.
echo CloudWatch Log Group: !LOG_GROUP!
if not "!ALB_DNS!"=="" echo Application URL: http://!ALB_DNS!
echo.
echo Troubleshooting tips:
echo   - View logs:  aws logs tail !LOG_GROUP! --follow --region !AWS_REGION!
echo   - List tasks: aws ecs list-tasks --cluster !CLUSTER_NAME! --region !AWS_REGION!
echo ==============================================
echo   Deployment finished successfully!
echo ==============================================

endlocal
exit /b 0
