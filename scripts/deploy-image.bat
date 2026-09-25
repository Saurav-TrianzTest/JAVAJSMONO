@echo off
setlocal enabledelayedexpansion

REM =============================================================================
REM deploy-image.bat — Deploy react-nextjs-host to AWS ECS Fargate (Windows)
REM Usage: scripts\deploy-image.bat
REM Prerequisites: aws-cli v2 configured with appropriate IAM permissions.
REM =============================================================================

set "SERVICE_NAME=react-nextjs-host-service"
set "TASK_FAMILY=react-nextjs-host-task"
set "CONTAINER_NAME=react-nextjs-host"
set "LOG_GROUP=/ecs/react-nextjs-host"
set "TASK_DEF_FILE=ecs\task-definition.json"
set "SERVICE_DEF_FILE=ecs\service-definition.json"

echo ==============================================
echo   react-nextjs-host -- ECS Fargate Deployment
echo ==============================================
echo.

REM ---------------------------------------------------------------------------
REM Collect configuration
REM ---------------------------------------------------------------------------
set /p "AWS_REGION=Enter AWS Region [us-east-1]: "
if "!AWS_REGION!"=="" set "AWS_REGION=us-east-1"

set /p "CLUSTER_NAME=Enter ECS Cluster name [react-nextjs-host-cluster]: "
if "!CLUSTER_NAME!"=="" set "CLUSTER_NAME=react-nextjs-host-cluster"

set /p "IMAGE_URI=Enter ECR Image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/react-nextjs-host:latest): "
if "!IMAGE_URI!"=="" (
    echo ERROR: Image URI is required.
    exit /b 1
)

set /p "SUBNETS_INPUT=Enter Subnet IDs comma-separated at least 2 (e.g. subnet-aaa,subnet-bbb): "
if "!SUBNETS_INPUT!"=="" (
    echo ERROR: At least one subnet ID is required.
    exit /b 1
)

REM Split subnets
for /f "tokens=1,2 delims=," %%a in ("!SUBNETS_INPUT!") do (
    set "SUBNET_1=%%a"
    set "SUBNET_2=%%b"
)
if "!SUBNET_2!"=="" set "SUBNET_2=!SUBNET_1!"

set /p "SECURITY_GROUP=Enter Security Group ID (must allow inbound TCP 8080): "
if "!SECURITY_GROUP!"=="" (
    echo ERROR: Security Group ID is required.
    exit /b 1
)

REM ---------------------------------------------------------------------------
REM Resolve AWS Account ID
REM ---------------------------------------------------------------------------
echo.
echo Resolving AWS Account ID...
for /f "delims=" %%i in ('aws sts get-caller-identity --query Account --output text') do set "ACCOUNT_ID=%%i"
if !ERRORLEVEL! neq 0 (
    echo ERROR: Failed to get AWS Account ID. Check your AWS CLI configuration.
    exit /b 1
)
echo Account ID: !ACCOUNT_ID!

REM ---------------------------------------------------------------------------
REM Ensure CloudWatch log group exists
REM ---------------------------------------------------------------------------
echo.
echo Ensuring CloudWatch log group '!LOG_GROUP!' exists...
aws logs create-log-group --log-group-name "!LOG_GROUP!" --region "!AWS_REGION!" >nul 2>&1
echo Log group ready.

REM ---------------------------------------------------------------------------
REM Ensure ECS cluster exists
REM ---------------------------------------------------------------------------
echo.
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
echo Cluster ready.

REM ---------------------------------------------------------------------------
REM Load balancer (optional)
REM ---------------------------------------------------------------------------
echo.
set /p "NEED_LB=Do you need an Application Load Balancer for this service? (y/n) [n]: "
if "!NEED_LB!"=="" set "NEED_LB=n"

set "TARGET_GROUP_ARN="
set "LB_DNS="

if /i "!NEED_LB!"=="y" (
    set /p "VPC_ID=Enter VPC ID for the load balancer: "
    if "!VPC_ID!"=="" (
        echo ERROR: VPC ID is required for load balancer creation.
        exit /b 1
    )

    echo.
    echo Creating Application Load Balancer...
    for /f "delims=" %%i in ('aws elbv2 create-load-balancer --name "react-nextjs-host-alb" --subnets "!SUBNET_1!" "!SUBNET_2!" --security-groups "!SECURITY_GROUP!" --scheme internet-facing --type application --region "!AWS_REGION!" --query "LoadBalancers[0].LoadBalancerArn" --output text') do set "LB_ARN=%%i"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create load balancer.
        exit /b 1
    )
    echo ALB ARN: !LB_ARN!

    for /f "delims=" %%i in ('aws elbv2 describe-load-balancers --load-balancer-arns "!LB_ARN!" --region "!AWS_REGION!" --query "LoadBalancers[0].DNSName" --output text') do set "LB_DNS=%%i"

    echo Creating Target Group...
    for /f "delims=" %%i in ('aws elbv2 create-target-group --name "react-nextjs-host-tg" --protocol HTTP --port 8080 --vpc-id "!VPC_ID!" --target-type ip --health-check-path "/api/health" --health-check-interval-seconds 30 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region "!AWS_REGION!" --query "TargetGroups[0].TargetGroupArn" --output text') do set "TARGET_GROUP_ARN=%%i"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create target group.
        exit /b 1
    )
    echo Target Group ARN: !TARGET_GROUP_ARN!

    echo Creating ALB Listener on port 80...
    aws elbv2 create-listener --load-balancer-arn "!LB_ARN!" --protocol HTTP --port 80 --default-actions "Type=forward,TargetGroupArn=!TARGET_GROUP_ARN!" --region "!AWS_REGION!" >nul
    echo Listener created.
)

REM ---------------------------------------------------------------------------
REM Prepare task definition (replace placeholders using PowerShell)
REM ---------------------------------------------------------------------------
echo.
echo Preparing task definition...
copy /y "!TASK_DEF_FILE!" "%TEMP%\task-definition-deploy.json" >nul
powershell -Command "(Get-Content '%TEMP%\task-definition-deploy.json') -replace '{{ACCOUNT_ID}}','!ACCOUNT_ID!' -replace '{{AWS_REGION}}','!AWS_REGION!' -replace '{{IMAGE_URI}}','!IMAGE_URI!' | Set-Content '%TEMP%\task-definition-deploy.json'"

REM ---------------------------------------------------------------------------
REM Register task definition
REM ---------------------------------------------------------------------------
echo Registering task definition...
for /f "delims=" %%i in ('aws ecs register-task-definition --cli-input-json file://%TEMP%\task-definition-deploy.json --region "!AWS_REGION!" --query "taskDefinition.taskDefinitionArn" --output text') do set "TASK_DEF_ARN=%%i"
if !ERRORLEVEL! neq 0 (
    echo ERROR: Failed to register task definition.
    exit /b 1
)
echo Task Definition ARN: !TASK_DEF_ARN!

REM ---------------------------------------------------------------------------
REM Prepare service definition (replace placeholders)
REM ---------------------------------------------------------------------------
echo.
echo Preparing service definition...
copy /y "!SERVICE_DEF_FILE!" "%TEMP%\service-definition-deploy.json" >nul
powershell -Command "(Get-Content '%TEMP%\service-definition-deploy.json') -replace '{{CLUSTER_NAME}}','!CLUSTER_NAME!' -replace '{{SUBNET_1}}','!SUBNET_1!' -replace '{{SUBNET_2}}','!SUBNET_2!' -replace '{{SECURITY_GROUP}}','!SECURITY_GROUP!' | Set-Content '%TEMP%\service-definition-deploy.json'"

REM ---------------------------------------------------------------------------
REM Create or update ECS service
REM ---------------------------------------------------------------------------
echo.
echo Checking if ECS service '!SERVICE_NAME!' exists...
for /f "delims=" %%i in ('aws ecs describe-services --cluster "!CLUSTER_NAME!" --services "!SERVICE_NAME!" --region "!AWS_REGION!" --query "services[?status!='INACTIVE'].serviceName" --output text 2^>nul') do set "EXISTING_SERVICE=%%i"

if "!EXISTING_SERVICE!"=="" (
    echo Creating new ECS service '!SERVICE_NAME!'...
    powershell -Command "$s=Get-Content '%TEMP%\service-definition-deploy.json'|ConvertFrom-Json; $s.taskDefinition='!TASK_DEF_ARN!'; $s|ConvertTo-Json -Depth 10|Set-Content '%TEMP%\service-definition-deploy.json'"
    aws ecs create-service --cli-input-json file://%TEMP%\service-definition-deploy.json --region "!AWS_REGION!"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create ECS service.
        exit /b 1
    )
) else (
    echo Updating existing ECS service '!SERVICE_NAME!'...
    aws ecs update-service --cluster "!CLUSTER_NAME!" --service "!SERVICE_NAME!" --task-definition "!TASK_DEF_ARN!" --region "!AWS_REGION!"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to update ECS service.
        exit /b 1
    )
)

REM ---------------------------------------------------------------------------
REM Wait for stability
REM ---------------------------------------------------------------------------
echo.
echo Waiting for service to reach stable state (this may take a few minutes)...
aws ecs wait services-stable --cluster "!CLUSTER_NAME!" --services "!SERVICE_NAME!" --region "!AWS_REGION!"
if !ERRORLEVEL! neq 0 (
    echo WARNING: Service did not reach stable state within the timeout period.
    echo Check the ECS console and CloudWatch logs for details.
)

REM ---------------------------------------------------------------------------
REM Verify and summarise
REM ---------------------------------------------------------------------------
echo.
echo ==============================================
echo   Deployment Complete!
echo ==============================================
aws ecs describe-services --cluster "!CLUSTER_NAME!" --services "!SERVICE_NAME!" --region "!AWS_REGION!" --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount}" --output table

echo.
echo CloudWatch Log Group : !LOG_GROUP!
echo ECS Cluster          : !CLUSTER_NAME!
echo ECS Service          : !SERVICE_NAME!
if not "!LB_DNS!"=="" (
    echo Load Balancer DNS    : http://!LB_DNS!
    echo Health Check URL     : http://!LB_DNS!/api/health
)
echo.
echo Troubleshooting tips:
echo   View logs  : aws logs tail !LOG_GROUP! --follow --region !AWS_REGION!
echo   List tasks : aws ecs list-tasks --cluster !CLUSTER_NAME! --service-name !SERVICE_NAME! --region !AWS_REGION!

endlocal
exit /b 0
