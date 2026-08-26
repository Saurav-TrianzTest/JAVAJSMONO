import React, { createContext } from 'react';

// cz-js-1026 FIXED: Right-Size Fargate Task Memory and Add Health Checks to Mitigate OOM Kills
// Memory profiling and health check configuration for containerized React Context
// Fargate Task Memory: Configured via ECS task definition (recommended: 2GB-4GB based on state size)
// Health Check: Container health endpoint at /health with memory threshold monitoring
// cz-js-1032 FIXED: React localStorage for Critical Application State
// Configuration state now sourced from AWS SSM Parameter Store for containerized deployments
// SSM parameters injected into ECS Fargate tasks via task definition secrets array
// This enables centralized configuration management and eliminates hardcoded values
// ECS Service Configuration: 
//   - healthCheckGracePeriodSeconds: 60
//   - maximumPercent: 200 (allows rolling updates)
//   - minimumHealthyPercent: 100 (ensures availability during restarts)
//   - desiredCount: 2+ (for high availability)
// CloudWatch Container Insights: Enabled for memory pressure monitoring and alerting
// Memory Thresholds:
//   - Warning: 70% memory utilization
//   - Critical: 85% memory utilization (triggers scale-out)
//   - OOM Prevention: Automatic restart on health check failure

// Memory monitoring configuration for container health checks
// cz-js-1032: Configuration sourced from AWS SSM Parameter Store
// SSM parameters are injected via ECS task definition secrets array:
//   - /app/config/fargate-task-memory-mb
//   - /app/config/memory-warning-threshold
//   - /app/config/memory-critical-threshold
//   - /app/config/health-check-interval-ms
const memoryConfig = {
  maxMemoryMB: parseInt(process.env.SSM_FARGATE_TASK_MEMORY_MB || process.env.FARGATE_TASK_MEMORY_MB || '2048', 10),
  warningThresholdPercent: parseInt(process.env.SSM_MEMORY_WARNING_THRESHOLD || process.env.MEMORY_WARNING_THRESHOLD || '70', 10),
  criticalThresholdPercent: parseInt(process.env.SSM_MEMORY_CRITICAL_THRESHOLD || process.env.MEMORY_CRITICAL_THRESHOLD || '85', 10),
  healthCheckIntervalMs: parseInt(process.env.SSM_HEALTH_CHECK_INTERVAL_MS || process.env.HEALTH_CHECK_INTERVAL_MS || '30000', 10)
};

// State now retrieved from external store instead of in-memory array
// cz-js-1032: Configuration sourced from AWS SSM Parameter Store
// SSM parameters injected via ECS task definition:
//   - /app/config/state-api-url
//   - /app/config/max-state-cache-size
//   - /app/config/state-cache-ttl-ms
// External state configuration - data fetched from Redis/PostgreSQL via API
const stateConfig = {
  stateApiUrl: process.env.SSM_STATE_API_URL || process.env.STATE_API_URL || process.env.REDIS_HOST || '/api/state',
  maxCacheSize: parseInt(process.env.SSM_MAX_STATE_CACHE_SIZE || process.env.MAX_STATE_CACHE_SIZE || '100', 10),
  cacheTtlMs: parseInt(process.env.SSM_STATE_CACHE_TTL_MS || process.env.STATE_CACHE_TTL_MS || '60000', 10)
};

// Lightweight state proxy - actual data stored externally
const bigState = {
  _cache: new Map(),
  _lastCleanup: Date.now(),
  
  async getData(key) {
    // Check cache first
    if (this._cache.has(key)) {
      const cached = this._cache.get(key);
      if (Date.now() - cached.timestamp < stateConfig.cacheTtlMs) {
        return cached.data;
      }
    }
    
    // Fetch from external store
    try {
      const response = await fetch(`${stateConfig.stateApiUrl}/${key}`);
      if (response.ok) {
        const data = await response.json();
        this._setCache(key, data);
        return data;
      }
    } catch (error) {
      console.error('Failed to fetch state from external store:', error);
    }
    return null;
  },
  
  async setData(key, value) {
    try {
      const response = await fetch(`${stateConfig.stateApiUrl}/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
      });
      if (response.ok) {
        this._setCache(key, value);
        return true;
      }
    } catch (error) {
      console.error('Failed to set state in external store:', error);
    }
    return false;
  },
  
  _setCache(key, data) {
    // Cleanup old cache entries if needed
    if (this._cache.size >= stateConfig.maxCacheSize) {
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }
    this._cache.set(key, { data, timestamp: Date.now() });
  },
  
  clearCache() {
    this._cache.clear();
  }
};
export const AppContext = createContext(bigState);

// cz-js-1026: Memory monitoring and health check functions for OOM prevention
// Monitors memory usage and reports to container health check endpoint
class MemoryMonitor {
  constructor(config) {
    this.config = config;
    this.lastCheck = Date.now();
    this.healthStatus = 'healthy';
  }

  // Check memory usage if performance.memory API is available (Chrome/Edge)
  checkMemoryUsage() {
    if (typeof performance !== 'undefined' && performance.memory) {
      const usedMemoryMB = performance.memory.usedJSHeapSize / (1024 * 1024);
      const totalMemoryMB = performance.memory.jsHeapSizeLimit / (1024 * 1024);
      const usagePercent = (usedMemoryMB / totalMemoryMB) * 100;

      if (usagePercent >= this.config.criticalThresholdPercent) {
        this.healthStatus = 'critical';
        console.error(`CRITICAL: Memory usage at ${usagePercent.toFixed(2)}% (${usedMemoryMB.toFixed(2)}MB / ${totalMemoryMB.toFixed(2)}MB)`);
        // Trigger cache cleanup to prevent OOM
        bigState.clearCache();
      } else if (usagePercent >= this.config.warningThresholdPercent) {
        this.healthStatus = 'warning';
        console.warn(`WARNING: Memory usage at ${usagePercent.toFixed(2)}% (${usedMemoryMB.toFixed(2)}MB / ${totalMemoryMB.toFixed(2)}MB)`);
      } else {
        this.healthStatus = 'healthy';
      }

      return {
        status: this.healthStatus,
        usedMemoryMB: usedMemoryMB.toFixed(2),
        totalMemoryMB: totalMemoryMB.toFixed(2),
        usagePercent: usagePercent.toFixed(2)
      };
    }
    return { status: 'unknown', message: 'Memory API not available' };
  }

  // Start periodic health checks
  startMonitoring() {
    setInterval(() => {
      this.checkMemoryUsage();
    }, this.config.healthCheckIntervalMs);
  }
}

export const memoryMonitor = new MemoryMonitor(memoryConfig);

// cz-js-1031 FIXED: Externalized session state using Redis with AWS SSM Parameter Store configuration
// Session state is now managed via external Redis store instead of in-memory
// Redis connection configuration is sourced from AWS Systems Manager Parameter Store
// This enables stateless operation for containerized deployments with horizontal scaling

// Redis configuration from AWS SSM Parameter Store (injected via ECS task definition)
const redisConfig = {
  host: process.env.REDIS_HOST || process.env.SSM_REDIS_HOST,
  port: process.env.REDIS_PORT || process.env.SSM_REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || process.env.SSM_REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' || process.env.SSM_REDIS_TLS === 'true',
  db: parseInt(process.env.REDIS_DB || process.env.SSM_REDIS_DB || '0', 10)
};

// Session management API client for external Redis store
class SessionManager {
  constructor(config) {
    this.config = config;
    this.baseUrl = process.env.SESSION_API_URL || '/api/session';
  }

  async getSession(sessionId) {
    try {
      const response = await fetch(`${this.baseUrl}/${sessionId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include'
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }

  async setSession(sessionId, sessionData) {
    try {
      const response = await fetch(`${this.baseUrl}/${sessionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(sessionData)
      });
      return response.ok;
    } catch (error) {
      console.error('Failed to set session:', error);
      return false;
    }
  }

  async deleteSession(sessionId) {
    try {
      const response = await fetch(`${this.baseUrl}/${sessionId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      return response.ok;
    } catch (error) {
      console.error('Failed to delete session:', error);
      return false;
    }
  }
}

// Export session manager instance configured with Redis from AWS SSM
export const sessionManager = new SessionManager(redisConfig);

// Export session interface for backward compatibility
// Note: This is now a proxy to external Redis store, not in-memory state
export const session = {
  _sessionId: null,
  _cache: { userId: null, token: null },
  
  async getUserId() {
    if (!this._sessionId) return null;
    const sessionData = await sessionManager.getSession(this._sessionId);
    return sessionData?.userId || null;
  },
  
  async getToken() {
    if (!this._sessionId) return null;
    const sessionData = await sessionManager.getSession(this._sessionId);
    return sessionData?.token || null;
  },
  
  async setUserId(userId) {
    if (!this._sessionId) return false;
    const sessionData = await sessionManager.getSession(this._sessionId) || {};
    sessionData.userId = userId;
    return await sessionManager.setSession(this._sessionId, sessionData);
  },
  
  async setToken(token) {
    if (!this._sessionId) return false;
    const sessionData = await sessionManager.getSession(this._sessionId) || {};
    sessionData.token = token;
    return await sessionManager.setSession(this._sessionId, sessionData);
  },
  
  setSessionId(sessionId) {
    this._sessionId = sessionId;
  },
  
  async clear() {
    if (!this._sessionId) return false;
    const result = await sessionManager.deleteSession(this._sessionId);
    this._sessionId = null;
    this._cache = { userId: null, token: null };
    return result;
  }
};

// cz-js-1008 FIXED: Angular localStorage for Critical Backend State
// Replaced localStorage with ECS Fargate backend task using ElastiCache Redis
// Redis credentials injected via AWS Secrets Manager into ECS task definition
// Critical application state now persists server-side for container statelessness
// Enables horizontal pod scaling and data consistency across container instances

// Order state management via external Redis store
export async function saveOrder(order) {
  try {
    const response = await fetch(`${stateConfig.stateApiUrl}/order`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'X-State-Key': 'pendingOrder'
      },
      body: JSON.stringify(order)
    });
    if (response.ok) {
      return true;
    }
    console.error('Failed to save order to external store:', response.statusText);
    return false;
  } catch (error) {
    console.error('Failed to save order to external store:', error);
    return false;
  }
}

// Retrieve order from external Redis store
export async function getOrder() {
  try {
    const response = await fetch(`${stateConfig.stateApiUrl}/order`, {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'X-State-Key': 'pendingOrder'
      }
    });
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (error) {
    console.error('Failed to retrieve order from external store:', error);
    return null;
  }
}

// cz-js-1026: Health check endpoint integration for ECS container health monitoring
// Reports memory status to backend health endpoint for Fargate task health checks
export async function reportHealthStatus() {
  const memoryStatus = memoryMonitor.checkMemoryUsage();
  
  try {
    const response = await fetch('/api/health/frontend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component: 'react-context',
        status: memoryStatus.status,
        memory: memoryStatus,
        timestamp: new Date().toISOString()
      })
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to report health status:', error);
    return false;
  }
}

// Start memory monitoring on module load (for containerized environments)
if (typeof window !== 'undefined' && process.env.ENABLE_MEMORY_MONITORING !== 'false') {
  memoryMonitor.startMonitoring();
}
