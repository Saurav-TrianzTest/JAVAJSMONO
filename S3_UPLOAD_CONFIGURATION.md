# S3 Pre-Signed URL Upload Configuration

## Overview
This application has been configured to use S3 pre-signed URLs for file uploads, eliminating local filesystem dependencies and enabling horizontal scaling in containerized environments.

## Architecture
- **Frontend**: jQuery File Upload plugin configured to upload directly to S3
- **Backend**: ECS Fargate service generates short-lived pre-signed URLs
- **Storage**: AWS S3 bucket for persistent file storage

## Required Environment Variables

### Backend (ECS Fargate)
```bash
AWS_REGION=us-east-1                    # AWS region for S3 bucket
S3_BUCKET=my-upload-bucket              # S3 bucket name for uploads
AWS_ACCESS_KEY_ID=AKIA...              # AWS access key (use IAM role in production)
AWS_SECRET_ACCESS_KEY=...              # AWS secret key (use IAM role in production)
```

### Frontend
```bash
REACT_APP_BACKEND_URL=https://api.example.com  # Backend API URL
BACKEND_URL=https://api.example.com            # Alternative backend URL
```

## S3 Bucket Configuration

### 1. Create S3 Bucket
```bash
aws s3 mb s3://my-upload-bucket --region us-east-1
```

### 2. Configure CORS Policy
The S3 bucket must allow cross-origin requests from your frontend domain:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST", "GET"],
    "AllowedOrigins": ["https://your-frontend-domain.com", "http://localhost:3000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Apply CORS configuration:
```bash
aws s3api put-bucket-cors --bucket my-upload-bucket --cors-configuration file://cors.json
```

### 3. IAM Policy for Pre-Signed URLs
The ECS task role needs permission to generate pre-signed URLs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::my-upload-bucket/uploads/*"
    }
  ]
}
```

## Usage

### Frontend Integration with jQuery File Upload

```javascript
import { getJQueryFileUploadConfig } from './api/upload';

// Initialize jQuery File Upload with S3 configuration
$('#fileupload').fileupload(getJQueryFileUploadConfig());
```

### Direct API Usage

```javascript
import { uploadToDisk } from './api/upload';

// Upload a file
const file = document.getElementById('fileInput').files[0];
const result = await uploadToDisk(file);
console.log('File uploaded:', result.fileKey);
```

## Benefits

1. **No Local Filesystem**: Files never touch the container filesystem
2. **Horizontal Scaling**: Multiple container instances can run without shared storage
3. **Performance**: Direct browser-to-S3 upload reduces backend load
4. **Reliability**: Files persist in S3, surviving container restarts and pod evictions
5. **Cost Efficiency**: Reduced data transfer through backend infrastructure

## Production Deployment

### ECS Fargate Task Definition
```json
{
  "family": "upload-service",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/ecs-s3-upload-role",
  "containerDefinitions": [
    {
      "name": "backend",
      "image": "your-backend-image:latest",
      "environment": [
        {"name": "AWS_REGION", "value": "us-east-1"},
        {"name": "S3_BUCKET", "value": "my-upload-bucket"}
      ]
    }
  ]
}
```

### Security Best Practices
1. Use IAM roles instead of access keys in production
2. Set appropriate pre-signed URL expiry (default: 1 hour)
3. Implement file size limits in backend validation
4. Use S3 bucket policies to restrict access
5. Enable S3 server-side encryption
6. Implement virus scanning for uploaded files

## Monitoring

Monitor the following metrics:
- Pre-signed URL generation rate
- S3 upload success/failure rate
- Upload latency
- S3 storage usage

## Troubleshooting

### CORS Errors
- Verify S3 bucket CORS configuration
- Check frontend origin matches allowed origins
- Ensure pre-signed URL includes correct headers

### Upload Failures
- Verify IAM permissions for S3 bucket
- Check pre-signed URL expiry time
- Validate file size limits
- Review S3 bucket policies

### Backend Errors
- Verify environment variables are set
- Check ECS task role has S3 permissions
- Review CloudWatch logs for errors
