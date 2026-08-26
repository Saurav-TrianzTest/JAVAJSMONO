import axios from 'axios';

// cz-js-1049 FIX: jQuery File Upload to S3 using Pre-Signed URLs from ECS Fargate Backend
// Configure the ECS Fargate backend to generate short-lived S3 presigned PUT URLs,
// enabling the jQuery File Upload plugin to upload files directly to S3 from the browser
// without routing file data through the Fargate container at all.

/**
 * Get S3 pre-signed URL from backend for direct upload
 * This function is designed to work with jQuery File Upload plugin
 * @param {File} file - The file to upload
 * @returns {Promise<Object>} - Pre-signed URL and metadata
 */
export async function getPresignedUrl(file) {
  // cz-js-1003 FIX: Use AWS Secrets Manager with ECS Fargate Task Secrets for API endpoint configuration
  // The BACKEND_URL environment variable is injected from AWS Secrets Manager at container runtime
  const backendUrl = process.env.REACT_APP_BACKEND_URL || process.env.BACKEND_URL || process.env.API_BASE_URL;
  
  try {
    const response = await axios.post(`${backendUrl}/api/upload/presigned-url`, {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size
    });
    
    return response.data; // { uploadUrl, fileKey, fields }
  } catch (error) {
    console.error('Failed to get pre-signed URL:', error);
    throw new Error(`Pre-signed URL generation failed: ${error.message}`);
  }
}

/**
 * Upload file directly to S3 using pre-signed URL
 * Compatible with jQuery File Upload plugin
 * @param {File} file - The file to upload
 * @param {Object} presignedData - Pre-signed URL data from backend
 * @returns {Promise} - Upload result
 */
export async function uploadToS3(file, presignedData) {
  const { uploadUrl, fileKey } = presignedData;
  
  try {
    // Upload directly to S3 using pre-signed URL
    await axios.put(uploadUrl, file, {
      headers: {
        'Content-Type': file.type
      },
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        console.log(`Upload progress: ${percentCompleted}%`);
      }
    });
    
    return { success: true, fileKey: fileKey };
  } catch (error) {
    console.error('S3 upload failed:', error);
    throw new Error(`File upload to S3 failed: ${error.message}`);
  }
}

/**
 * Complete upload workflow: get pre-signed URL and upload to S3
 * This eliminates local filesystem dependency and enables horizontal scaling
 * @param {File} file - The file to upload
 * @returns {Promise} - Upload result
 */
export async function uploadToDisk(file) {
  try {
    // Step 1: Request pre-signed URL from backend
    const presignedData = await getPresignedUrl(file);

    // Step 2: Upload file directly to S3 using pre-signed URL
    const uploadResult = await uploadToS3(file, presignedData);

    // Step 3: Notify backend of successful upload (optional)
    // cz-js-1003 FIX: Use AWS Secrets Manager with ECS Fargate Task Secrets for API endpoint configuration
    const backendUrl = process.env.REACT_APP_BACKEND_URL || process.env.BACKEND_URL || process.env.API_BASE_URL;
    await axios.post(`${backendUrl}/api/upload/confirm`, {
      fileKey: uploadResult.fileKey,
      fileName: file.name
    });

    return uploadResult;
  } catch (error) {
    console.error('Upload workflow failed:', error);
    throw error;
  }
}

/**
 * jQuery File Upload plugin configuration for S3 direct upload
 * Use this configuration with jQuery File Upload widget
 * @returns {Object} - jQuery File Upload configuration
 */
export function getJQueryFileUploadConfig() {
  return {
    // Custom add callback to handle S3 pre-signed URL upload
    add: async function (e, data) {
      const file = data.files[0];
      
      try {
        // Get pre-signed URL from backend
        const presignedData = await getPresignedUrl(file);
        
        // Configure jQuery File Upload to use S3 pre-signed URL
        data.url = presignedData.uploadUrl;
        data.type = 'PUT';
        data.headers = {
          'Content-Type': file.type
        };
        
        // Remove any form data (not needed for pre-signed URL)
        data.formData = null;
        
        // Submit the upload directly to S3
        const jqXHR = data.submit();
        
        // Handle completion
        jqXHR.done(function () {
          console.log('Upload successful:', presignedData.fileKey);
          
          // Notify backend of successful upload
          // cz-js-1003 FIX: Use AWS Secrets Manager with ECS Fargate Task Secrets for API endpoint configuration
          const backendUrl = process.env.REACT_APP_BACKEND_URL || process.env.BACKEND_URL || process.env.API_BASE_URL;
          axios.post(`${backendUrl}/api/upload/confirm`, {
            fileKey: presignedData.fileKey,
            fileName: file.name
          }).catch(err => console.error('Failed to confirm upload:', err));
        });
        
        jqXHR.fail(function (jqXHR, textStatus, errorThrown) {
          console.error('Upload failed:', textStatus, errorThrown);
        });
        
      } catch (error) {
        console.error('Failed to initiate upload:', error);
      }
    },
    
    // Progress callback
    progress: function (e, data) {
      const progress = parseInt(data.loaded / data.total * 100, 10);
      console.log('Upload progress: ' + progress + '%');
    },
    
    // Disable automatic upload (we handle it in add callback)
    autoUpload: false,
    
    // S3 doesn't return JSON by default, so disable parsing
    dataType: 'text'
  };
}

export function getData() {
  // cz-js-1003 FIX: Use environment variable for API endpoint instead of hardcoded port
  const backendUrl = process.env.REACT_APP_BACKEND_URL || process.env.BACKEND_URL || process.env.API_BASE_URL;
  return fetch(`${backendUrl}/api/data`);
}
export function getLocal() {
  // cz-js-1004 FIX: Use Application Load Balancer with Path Routing to eliminate localhost
  // Use relative path so ALB routes to appropriate backend service
  return fetch('/api/info');
}
export function getCross() {
  // cz-js-1030 FIX: CORS error handling for containerized microservices
  // NGINX sidecar proxy handles CORS headers at infrastructure level
  return fetch('http://api.other-origin.com/data', {
    mode: 'cors',
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .catch(error => {
      // Handle CORS and network errors gracefully
      if (error.message.includes('CORS') || error.name === 'TypeError') {
        console.error('CORS error - ensure NGINX proxy is configured:', error);
        throw new Error('Cross-origin request failed. Please check network configuration.');
      }
      console.error('Fetch error:', error);
      throw error;
    });
}
