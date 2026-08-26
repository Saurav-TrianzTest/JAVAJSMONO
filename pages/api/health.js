// cz-js-1046 health check API route in Next.js
// cz-js-1026 ENHANCED: Added frontend memory status reporting endpoint

// In-memory store for frontend health status (for demo purposes)
// In production, this should be stored in Redis or a monitoring service
const frontendHealthStatus = {
  lastUpdate: null,
  status: 'unknown',
  memory: null
};

export default function handler(req, res) {
  // Handle POST requests for frontend health status reporting
  if (req.method === 'POST') {
    try {
      const { component, status, memory, timestamp } = req.body;
      
      // Store frontend health status
      frontendHealthStatus.lastUpdate = timestamp || new Date().toISOString();
      frontendHealthStatus.status = status || 'unknown';
      frontendHealthStatus.memory = memory || null;
      frontendHealthStatus.component = component || 'unknown';
      
      // Log memory status for CloudWatch
      console.log(`[HEALTH] Frontend memory status: ${status}`, {
        component,
        memory,
        timestamp
      });
      
      // Return success
      res.status(200).json({ 
        received: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[HEALTH] Error processing frontend health status:', error);
      res.status(500).json({ 
        error: 'Failed to process health status',
        timestamp: new Date().toISOString()
      });
    }
    return;
  }
  
  // Handle GET requests for overall health check
  if (req.method === 'GET') {
    // Check if frontend health status is recent (within last 2 minutes)
    const isRecentUpdate = frontendHealthStatus.lastUpdate && 
      (new Date() - new Date(frontendHealthStatus.lastUpdate)) < 120000;
    
    // Determine overall health status
    let overallStatus = 'UP';
    let healthDetails = {
      backend: 'UP',
      frontend: frontendHealthStatus.status,
      frontendLastUpdate: frontendHealthStatus.lastUpdate
    };
    
    // If frontend is in critical state, mark overall as degraded
    if (isRecentUpdate && frontendHealthStatus.status === 'critical') {
      overallStatus = 'DEGRADED';
      healthDetails.warning = 'Frontend memory usage is critical';
    }
    
    // Include memory details if available
    if (frontendHealthStatus.memory) {
      healthDetails.frontendMemory = frontendHealthStatus.memory;
    }
    
    // Return health status
    const statusCode = overallStatus === 'UP' ? 200 : 503;
    res.status(statusCode).json({ 
      status: overallStatus,
      timestamp: new Date().toISOString(),
      details: healthDetails
    });
    return;
  }
  
  // Method not allowed
  res.status(405).json({ 
    error: 'Method not allowed',
    allowedMethods: ['GET', 'POST']
  });
}
