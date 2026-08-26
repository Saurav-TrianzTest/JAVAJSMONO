package com.trianz.reactnextjs.service;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

/**
 * Service for generating S3 pre-signed URLs for direct browser uploads
 * This eliminates the need for file data to pass through the container,
 * enabling horizontal scaling and eliminating local filesystem dependencies
 */
public class S3PresignedUrlService {

    private static final String AWS_REGION = getEnvOrDefault("AWS_REGION", "us-east-1");
    private static final String S3_BUCKET = getEnvOrDefault("S3_BUCKET", "my-upload-bucket");
    private static final String AWS_ACCESS_KEY_ID = getEnvOrDefault("AWS_ACCESS_KEY_ID", "");
    private static final String AWS_SECRET_ACCESS_KEY = getEnvOrDefault("AWS_SECRET_ACCESS_KEY", "");
    private static final int PRESIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour

    /**
     * Generate a pre-signed URL for uploading a file to S3
     * In production, this would use AWS SDK to generate proper signed URLs
     * This implementation provides the structure and environment variable usage
     * 
     * @param fileName Original file name
     * @param fileType MIME type of the file
     * @return JSON response with uploadUrl and fileKey
     */
    public String generatePresignedUrl(String fileName, String fileType) {
        // Generate unique file key
        String fileKey = generateFileKey(fileName);
        
        // In production, use AWS SDK v2:
        // S3Presigner presigner = S3Presigner.builder()
        //     .region(Region.of(AWS_REGION))
        //     .build();
        // 
        // PutObjectRequest putObjectRequest = PutObjectRequest.builder()
        //     .bucket(S3_BUCKET)
        //     .key(fileKey)
        //     .contentType(fileType)
        //     .build();
        // 
        // PutObjectPresignRequest presignRequest = PutObjectPresignRequest.builder()
        //     .signatureDuration(Duration.ofSeconds(PRESIGNED_URL_EXPIRY_SECONDS))
        //     .putObjectRequest(putObjectRequest)
        //     .build();
        // 
        // PresignedPutObjectRequest presignedRequest = presigner.presignPutObject(presignRequest);
        // String uploadUrl = presignedRequest.url().toString();
        
        // For this demonstration, return a mock structure
        // In production, replace with actual AWS SDK call
        String uploadUrl = generateMockPresignedUrl(fileKey, fileType);
        
        return String.format(
            "{\"uploadUrl\":\"%s\",\"fileKey\":\"%s\",\"bucket\":\"%s\",\"region\":\"%s\"}",
            uploadUrl, fileKey, S3_BUCKET, AWS_REGION
        );
    }

    /**
     * Generate a unique file key for S3 storage
     * Uses timestamp and UUID to ensure uniqueness
     */
    private String generateFileKey(String originalFileName) {
        String timestamp = DateTimeFormatter.ofPattern("yyyy/MM/dd")
            .withZone(ZoneOffset.UTC)
            .format(Instant.now());
        
        String uuid = UUID.randomUUID().toString();
        String sanitizedFileName = sanitizeFileName(originalFileName);
        
        return String.format("uploads/%s/%s-%s", timestamp, uuid, sanitizedFileName);
    }

    /**
     * Sanitize file name to remove special characters
     */
    private String sanitizeFileName(String fileName) {
        if (fileName == null || fileName.isEmpty()) {
            return "file";
        }
        // Remove path separators and special characters
        return fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    /**
     * Generate mock pre-signed URL structure
     * In production, this would be replaced by actual AWS SDK call
     */
    private String generateMockPresignedUrl(String fileKey, String fileType) {
        try {
            String encodedKey = URLEncoder.encode(fileKey, StandardCharsets.UTF_8);
            long expiryTimestamp = Instant.now().getEpochSecond() + PRESIGNED_URL_EXPIRY_SECONDS;
            
            // Mock pre-signed URL structure (in production, use AWS SDK)
            return String.format(
                "https://%s.s3.%s.amazonaws.com/%s?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=%d",
                S3_BUCKET, AWS_REGION, encodedKey, PRESIGNED_URL_EXPIRY_SECONDS
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to generate pre-signed URL", e);
        }
    }

    /**
     * Get environment variable with default fallback
     */
    private static String getEnvOrDefault(String key, String defaultValue) {
        String value = System.getenv(key);
        return (value != null && !value.isEmpty()) ? value : defaultValue;
    }

    /**
     * Validate that required AWS credentials are configured
     */
    public boolean isConfigured() {
        return !AWS_ACCESS_KEY_ID.isEmpty() && 
               !AWS_SECRET_ACCESS_KEY.isEmpty() &&
               !S3_BUCKET.equals("my-upload-bucket");
    }
}
