// cz-js-1026: Frontend memory status reporting endpoint
// This endpoint receives memory status reports from the React Context memory monitor

// In-memory store for frontend health status
const frontendHealthReports = [];
const MAX_REPORTS = 100; // Keep last 100 reports for analysis

export default function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    res.status(405).json({ 
      error: 'Method not allowed',
      allowedMethods: ['POST']
    });
    return;
  }
  
  try {
    const { component, status, memory, timestamp } = req.body;
    
    // Validate required fields
    if (!component || !status) {
      res.status(400).json({ 
        error: 'Missing required fields: component, status',
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    // Create health report
    const report = {
      component,
      status,
      memory: memory || null,
      timestamp: timestamp || new Date().toISOString(),
      receivedAt: new Date().toISOString()
    };
    
    // Store report (keep only last MAX_REPORTS)
    frontendHealthReports.push(report);
    if (frontendHealthReports.length > MAX_REPORTS) {
      frontendHealthReports.shift();
    }
    
    // Log to CloudWatch (structured logging)
    const logLevel = status === 'critical' ? 'ERROR' : 
                     status === 'warning' ? 'WARN' : 'INFO';
    
    console.log(JSON.stringify({
      level: logLevel,
      message: 'Frontend memory status report',
      component,
      status,
      memory,
      timestamp: report.timestamp
    }));
    
    // If critical, log additional alert
    if (status === 'critical') {
      console.error('[CRITICAL] Frontend memory usage critical - potential OOM risk', {
        component,
        memory,
        timestamp: report.timestamp
      });
    }
    
    // Return success with recommendations
    const response = {
      received: true,
      timestamp: new Date().toISOString(),
      status: 'acknowledged'
    };
    
    // Add recommendations based on status
    if (status === 'critical') {
      response.recommendations = [
        'Cache has been cleared automatically',
        'Consider reducing MAX_STATE_CACHE_SIZE',
        'Monitor for repeated critical alerts',
        'May need to increase Fargate task memory'
      ];
    } else if (status === 'warning') {
      response.recommendations = [
        'Monitor memory usage trends',
        'Consider clearing cache if usage increases',
        'Review application state size'
      ];
    }
    
    res.status(200).json(response);
    
  } catch (error) {
    console.error('[ERROR] Failed to process frontend health status:', error);
    res.status(500).json({ 
      error: 'Failed to process health status',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Export function to get recent reports (for monitoring dashboard)
export function getRecentReports(limit = 10) {
  return frontendHealthReports.slice(-limit);
}

// Export function to get health summary
export function getHealthSummary() {
  if (frontendHealthReports.length === 0) {
    return {
      status: 'unknown',
      message: 'No reports received yet'
    };
  }
  
  const recentReports = frontendHealthReports.slice(-10);
  const criticalCount = recentReports.filter(r => r.status === 'critical').length;
  const warningCount = recentReports.filter(r => r.status === 'warning').length;
  
  let overallStatus = 'healthy';
  if (criticalCount > 0) {
    overallStatus = 'critical';
  } else if (warningCount > 3) {
    overallStatus = 'warning';
  }
  
  return {
    status: overallStatus,
    recentReports: recentReports.length,
    criticalCount,
    warningCount,
    lastReport: recentReports[recentReports.length - 1]
  };
}
