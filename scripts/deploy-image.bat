@echo off
setlocal enabledelayedexpansion

:: =============================================================================
:: deploy-image.bat – Deploy react-nextjs-host to AWS ECS Fargate (Windows)
:: Usage: scripts\deploy-image.bat  (run from repository root)
:: =============================================================================

set "SERVICE_NAME=react-nextjs-host-service"
set "TASK_FAMILY=react-nextjs-host-task"
set "LOG_GROUP=/ecs/react-nextjs-host"
set "CONTAINER_PORT=8080"

echo ==============================================
echo   react-nextjs-host - ECS Fargate Deployment
echo ==============================================
echo.

:: ---------------------------------------------------------------------------
:: Collect deployment parameters
:: ---------------------------------------------------------------------------
set /p "AWS_REGION=Enter AWS Region [us-east-1]: "
if "!AWS_REGION!"=="" set "AWS_REGION=us-east-1"

set /p "CLUSTER_NAME=Enter ECS Cluster name [react-nextjs-host-cluster]: "
if "!CLUSTER_NAME!"=="" set "CLUSTER_NAME=react-nextjs-host-cluster"

set /p "IMAGE_URI=Enter ECR Image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest): "
if "!IMAGE_URI!"=="" (
    echo ERROR: Image URI is required.
    exit /b 1
)

set /p "SUBNET_1=Enter first Subnet ID (e.g. subnet-aaa): "
if "!SUBNET_1!"=="" (
    echo ERROR: At least one subnet ID is required.
    exit /b 1
)

set /p "SUBNET_2=Enter second Subnet ID (e.g. subnet-bbb) [same as first if only one]: "
if "!SUBNET_2!"=="" set "SUBNET_2=!SUBNET_1!"

set /p "SECURITY_GROUP=Enter Security Group ID (e.g. sg-xxxxxxxx): "
if "!SECURITY_GROUP!"=="" (
    echo ERROR: Security Group ID is required.
    exit /b 1
)

:: ---------------------------------------------------------------------------
:: Derive AWS Account ID
:: ---------------------------------------------------------------------------
echo.
echo Retrieving AWS Account ID...
for /f "tokens=*" %%i in ('aws sts get-caller-identity --query Account --output text') do set "ACCOUNT_ID=%%i"
if !ERRORLEVEL! neq 0 (
    echo ERROR: Failed to retrieve AWS Account ID. Check AWS CLI configuration.
    exit /b 1
)
echo Account ID: !ACCOUNT_ID!

:: ---------------------------------------------------------------------------
:: Ensure ECS cluster exists
:: ---------------------------------------------------------------------------
echo.
echo Checking ECS cluster: !CLUSTER_NAME! ...
for /f "tokens=*" %%i in ('aws ecs describe-clusters --clusters !CLUSTER_NAME! --region !AWS_REGION! --query "clusters[0].status" --output text 2^>nul') do set "CLUSTER_STATUS=%%i"
if "!CLUSTER_STATUS!" neq "ACTIVE" (
    echo Creating ECS cluster: !CLUSTER_NAME! ...
    aws ecs create-cluster --cluster-name !CLUSTER_NAME! --region !AWS_REGION!
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create ECS cluster.
        exit /b 1
    )
)
echo Cluster ready: !CLUSTER_NAME!

:: ---------------------------------------------------------------------------
:: Ensure CloudWatch log group exists
:: ---------------------------------------------------------------------------
echo.
echo Ensuring CloudWatch log group: !LOG_GROUP! ...
aws logs create-log-group --log-group-name !LOG_GROUP! --region !AWS_REGION! >nul 2>&1

:: ---------------------------------------------------------------------------
:: Load balancer prompt
:: ---------------------------------------------------------------------------
echo.
set /p "NEED_LB=Do you need an Application Load Balancer for this service? (y/n) [n]: "
if "!NEED_LB!"=="" set "NEED_LB=n"

set "TARGET_GROUP_ARN="
set "LB_DNS="

if /i "!NEED_LB!"=="y" (
    set /p "VPC_ID=Enter VPC ID for the load balancer (e.g. vpc-xxxxxxxx): "
    if "!VPC_ID!"=="" (
        echo ERROR: VPC ID is required for load balancer creation.
        exit /b 1
    )

    set "LB_NAME=react-nextjs-host-alb"
    set "TG_NAME=react-nextjs-host-tg"

    echo.
    echo Creating Application Load Balancer: !LB_NAME! ...
    for /f "tokens=*" %%i in ('aws elbv2 create-load-balancer --name !LB_NAME! --subnets !SUBNET_1! !SUBNET_2! --security-groups !SECURITY_GROUP! --scheme internet-facing --type application --region !AWS_REGION! --query "LoadBalancers[0].LoadBalancerArn" --output text') do set "LB_ARN=%%i"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create load balancer.
        exit /b 1
    )
    echo ALB ARN: !LB_ARN!

    for /f "tokens=*" %%i in ('aws elbv2 describe-load-balancers --load-balancer-arns !LB_ARN! --region !AWS_REGION! --query "LoadBalancers[0].DNSName" --output text') do set "LB_DNS=%%i"

    echo Creating Target Group: !TG_NAME! ...
    for /f "tokens=*" %%i in ('aws elbv2 create-target-group --name !TG_NAME! --protocol HTTP --port !CONTAINER_PORT! --vpc-id !VPC_ID! --target-type ip --health-check-path "/api/health" --health-check-interval-seconds 30 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region !AWS_REGION! --query "TargetGroups[0].TargetGroupArn" --output text') do set "TARGET_GROUP_ARN=%%i"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create target group.
        exit /b 1
    )
    echo Target Group ARN: !TARGET_GROUP_ARN!

    echo Creating ALB Listener on port 80...
    aws elbv2 create-listener --load-balancer-arn !LB_ARN! --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=!TARGET_GROUP_ARN! --region !AWS_REGION! >nul
)

:: ---------------------------------------------------------------------------
:: Prepare task definition (replace placeholders using PowerShell)
:: ---------------------------------------------------------------------------
echo.
echo Preparing task definition...
set "TASK_DEF_FILE=%TEMP%\task-def-deploy.json"
powershell -Command "(Get-Content 'ecs\task-definition.json') -replace '{{ACCOUNT_ID}}', '!ACCOUNT_ID!' -replace '{{AWS_REGION}}', '!AWS_REGION!' -replace '{{IMAGE_URI}}', '!IMAGE_URI!' | Set-Content '!TASK_DEF_FILE!'"
if !ERRORLEVEL! neq 0 (
    echo ERROR: Failed to prepare task definition.
    exit /b 1
)

:: ---------------------------------------------------------------------------
:: Register task definition
:: ---------------------------------------------------------------------------
echo Registering ECS task definition...
for /f "tokens=*" %%i in ('aws ecs register-task-definition --cli-input-json file://!TASK_DEF_FILE! --region !AWS_REGION! --query "taskDefinition.taskDefinitionArn" --output text') do set "TASK_DEF_ARN=%%i"
if !ERRORLEVEL! neq 0 (
    echo ERROR: Failed to register task definition.
    exit /b 1
)
echo Task Definition ARN: !TASK_DEF_ARN!
del "!TASK_DEF_FILE!" >nul 2>&1

:: ---------------------------------------------------------------------------
:: Prepare service definition (replace placeholders using PowerShell)
:: ---------------------------------------------------------------------------
echo.
echo Preparing service definition...
set "SVC_DEF_FILE=%TEMP%\svc-def-deploy.json"
powershell -Command "(Get-Content 'ecs\service-definition.json') -replace '{{CLUSTER_NAME}}', '!CLUSTER_NAME!' -replace '{{SUBNET_1}}', '!SUBNET_1!' -replace '{{SUBNET_2}}', '!SUBNET_2!' -replace '{{SECURITY_GROUP}}', '!SECURITY_GROUP!' | Set-Content '!SVC_DEF_FILE!'"
if !ERRORLEVEL! neq 0 (
    echo ERROR: Failed to prepare service definition.
    exit /b 1
)

:: ---------------------------------------------------------------------------
:: Create or update ECS service
:: ---------------------------------------------------------------------------
echo.
for /f "tokens=*" %%i in ('aws ecs describe-services --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION! --query "services[?status!='INACTIVE'].serviceName" --output text 2^>nul') do set "EXISTING_SERVICE=%%i"

if "!EXISTING_SERVICE!"=="" (
    echo Creating ECS service: !SERVICE_NAME! ...
    aws ecs create-service --cli-input-json file://!SVC_DEF_FILE! --region !AWS_REGION!
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create ECS service.
        exit /b 1
    )
) else (
    echo Updating existing ECS service: !SERVICE_NAME! ...
    aws ecs update-service --cluster !CLUSTER_NAME! --service !SERVICE_NAME! --task-definition !TASK_DEF_ARN! --region !AWS_REGION!
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to update ECS service.
        exit /b 1
    )
)
del "!SVC_DEF_FILE!" >nul 2>&1

:: ---------------------------------------------------------------------------
:: Wait for service stability
:: ---------------------------------------------------------------------------
echo.
echo Waiting for service to stabilize (this may take a few minutes)...
aws ecs wait services-stable --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION!
if !ERRORLEVEL! neq 0 (
    echo WARNING: Service did not stabilize within the expected time. Check ECS console.
)

:: ---------------------------------------------------------------------------
:: Verify deployment
:: ---------------------------------------------------------------------------
echo.
echo Verifying deployment...
aws ecs describe-services --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION! --query "services[0].{ServiceName:serviceName,Status:status,Running:runningCount,Desired:desiredCount}" --output table

echo.
echo ==============================================
echo   Deployment Complete!
echo   Service:    !SERVICE_NAME!
echo   Cluster:    !CLUSTER_NAME!
echo   Region:     !AWS_REGION!
echo   CloudWatch: !LOG_GROUP!
if not "!LB_DNS!"=="" (
    echo   Load Balancer: http://!LB_DNS!
)
echo ==============================================
echo.
echo Troubleshooting tips:
echo   - View logs:  aws logs tail !LOG_GROUP! --follow --region !AWS_REGION!
echo   - List tasks: aws ecs list-tasks --cluster !CLUSTER_NAME! --region !AWS_REGION!

endlocal
