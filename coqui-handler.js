const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Coqui Handler with Circuit Breaker Pattern
 * Auto-fallback to AWS Polly if Coqui fails
 */
class CoquiHandler {
  constructor() {
    this.apiUrl = process.env.COQUI_API_URL || 'https://web-production-00dca9.up.railway.app';
    this.tempDir = path.join(__dirname, '../../temp');
    this.cacheDir = path.join(__dirname, '../../cache');
    this.enabled = false;
    
    // Circuit breaker state
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.circuitOpen = false;
    this.maxFailures = 3; // Open circuit after 3 failures
    this.resetTimeout = 60000; // Try again after 1 minute
    this.halfOpenAttempts = 0;
    this.maxHalfOpenAttempts = 1;
    
    // Performance tracking
    this.stats = {
      requests: 0,
      successes: 0,
      failures: 0,
      avgResponseTime: 0,
      totalResponseTime: 0,
      lastCheck: Date.now(),
      uptime: 0,
      lastSuccess: null,
      lastFailure: null
    };
    
    // Create directories
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    
    // Initial health check
    this.checkAvailability();
    
    // Periodic health check every 30 seconds
    setInterval(() => this.periodicHealthCheck(), 30000);
    
    // Reset circuit breaker periodically
    setInterval(() => this.tryResetCircuit(), this.resetTimeout);
  }
  
  /**
   * Circuit breaker logic
   */
  shouldAttemptRequest() {
    // Circuit is closed - allow requests
    if (!this.circuitOpen) {
      return true;
    }
    
    // Circuit is open - check if we should try half-open
    const timeSinceFailure = Date.now() - this.lastFailureTime;
    if (timeSinceFailure >= this.resetTimeout) {
      console.log('[Coqui] Circuit half-open - attempting test request');
      return true;
    }
    
    return false;
  }
  
  recordSuccess(responseTime) {
    this.failureCount = 0;
    this.circuitOpen = false;
    this.halfOpenAttempts = 0;
    
    this.stats.requests++;
    this.stats.successes++;
    this.stats.totalResponseTime += responseTime;
    this.stats.avgResponseTime = this.stats.totalResponseTime / this.stats.successes;
    this.stats.lastSuccess = new Date().toISOString();
    
    console.log(`[Coqui] Success - Response time: ${responseTime}ms, Avg: ${Math.round(this.stats.avgResponseTime)}ms`);
  }
  
  recordFailure(error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    this.stats.requests++;
    this.stats.failures++;
    this.stats.lastFailure = new Date().toISOString();
    
    if (this.failureCount >= this.maxFailures) {
      this.circuitOpen = true;
      console.error(`[Coqui] Circuit OPEN - Too many failures (${this.failureCount})`);
      console.error(`[Coqui] Will retry in ${this.resetTimeout / 1000}s`);
    } else {
      console.warn(`[Coqui] Failure ${this.failureCount}/${this.maxFailures}: ${error.message}`);
    }
  }
  
  tryResetCircuit() {
    if (this.circuitOpen) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.resetTimeout) {
        console.log('[Coqui] Attempting to close circuit...');
        this.checkAvailability();
      }
    }
  }
  
  async periodicHealthCheck() {
    if (!this.circuitOpen) {
      await this.checkAvailability();
    }
  }
  
  async checkAvailability() {
    try {
      const startTime = Date.now();
      const response = await fetch(`${this.apiUrl}/health`, {
        timeout: 5000
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.ok) {
        const data = await response.json();
        const wasDisabled = !this.enabled;
        this.enabled = data.status === 'healthy';
        
        if (this.enabled) {
          this.recordSuccess(responseTime);
          if (wasDisabled) {
            console.log('[Coqui] Service is now AVAILABLE');
          }
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      this.enabled = false;
      this.recordFailure(error);
    }
  }
  
  isConfigured() {
    return this.enabled && !this.circuitOpen;
  }
  
  getStats() {
    const uptime = this.stats.successes > 0 ? 
      (this.stats.successes / this.stats.requests * 100).toFixed(2) : 0;
    
    return {
      ...this.stats,
      uptime: `${uptime}%`,
      circuitOpen: this.circuitOpen,
      failureCount: this.failureCount
    };
  }
  
  getCacheKey(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }
  
  /**
   * Generate speech with circuit breaker protection
   */
  async generateSpeech(text) {
    // Check circuit breaker
    if (!this.shouldAttemptRequest()) {
      console.warn('[Coqui] Circuit OPEN - skipping request');
      return null;
    }
    
    if (!this.enabled) {
      console.warn('[Coqui] Service not available');
      return null;
    }
    
    try {
      // Check cache first
      const cacheKey = this.getCacheKey(text);
      const cachedFile = path.join(this.cacheDir, `${cacheKey}.wav`);
      
      if (fs.existsSync(cachedFile)) {
        console.log('[Coqui] Cache hit:', cacheKey);
        this.recordSuccess(0); // Cache hit = instant
        return `/audio/${cacheKey}.wav`;
      }
      
      console.log('[Coqui] Generating speech:', text.substring(0, 50) + '...');
      const startTime = Date.now();
      
      // Call Coqui API
      const response = await fetch(`${this.apiUrl}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          use_cache: true
        }),
        timeout: 30000
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
      }
      
      // Save audio file
      const buffer = await response.buffer();
      fs.writeFileSync(cachedFile, buffer);
      
      const responseTime = Date.now() - startTime;
      this.recordSuccess(responseTime);
      
      return `/audio/${cacheKey}.wav`;
      
    } catch (error) {
      this.recordFailure(error);
      return null;
    }
  }
  
  /**
   * Clean up old audio files
   */
  cleanupOldFiles() {
    try {
      const now = Date.now();
      const maxAge = 60 * 60 * 1000; // 1 hour
      
      let cleaned = 0;
      
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        for (const file of files) {
          const filePath = path.join(this.tempDir, file);
          const stats = fs.statSync(filePath);
          
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        }
      }
      
      if (cleaned > 0) {
        console.log(`[Coqui] Cleaned up ${cleaned} old files`);
      }
    } catch (error) {
      console.error('[Coqui] Error cleaning up files:', error);
    }
  }
}

module.exports = CoquiHandler;
