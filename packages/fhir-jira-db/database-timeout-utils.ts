import { Database } from "bun:sqlite";

// Database timeout and retry configuration
export interface DatabaseConfig {
  queryTimeout: number;           // Timeout for individual queries (ms)
  transactionTimeout: number;     // Timeout for transactions (ms)
  retryAttempts: number;         // Number of retry attempts
  retryDelay: number;            // Base delay between retries (ms)
  retryBackoffMultiplier: number; // Multiplier for exponential backoff
  maxRetryDelay: number;         // Maximum delay between retries (ms)
  lockTimeout: number;           // Database lock timeout (ms)
  busyTimeout: number;           // SQLite busy timeout (ms)
}

export const DEFAULT_DATABASE_CONFIG: DatabaseConfig = {
  queryTimeout: 30000,         // 30 seconds
  transactionTimeout: 60000,   // 60 seconds
  retryAttempts: 3,
  retryDelay: 1000,           // 1 second
  retryBackoffMultiplier: 2,
  maxRetryDelay: 10000,       // 10 seconds
  lockTimeout: 30000,         // 30 seconds
  busyTimeout: 30000          // 30 seconds
};

// Error types for database operations
export class DatabaseTimeoutError extends Error {
  constructor(message: string, public timeoutMs: number, public operation: string) {
    super(message);
    this.name = 'DatabaseTimeoutError';
  }
}

export class DatabaseLockError extends Error {
  constructor(message: string, public operation: string) {
    super(message);
    this.name = 'DatabaseLockError';
  }
}

export class DatabaseRetryExhaustedError extends Error {
  constructor(message: string, public attempts: number, public lastError: Error) {
    super(message);
    this.name = 'DatabaseRetryExhaustedError';
  }
}

// Statistics tracking for database operations
export interface DatabaseStats {
  totalQueries: number;
  timeoutQueries: number;
  retriedQueries: number;
  lockContentions: number;
  averageQueryTime: number;
  longestQueryTime: number;
  totalRetryAttempts: number;
}

export class DatabaseStatsTracker {
  private stats: DatabaseStats = {
    totalQueries: 0,
    timeoutQueries: 0,
    retriedQueries: 0,
    lockContentions: 0,
    averageQueryTime: 0,
    longestQueryTime: 0,
    totalRetryAttempts: 0
  };

  private queryTimes: number[] = [];

  recordQuery(duration: number, wasRetried: boolean = false, wasTimeout: boolean = false, wasLockContention: boolean = false): void {
    this.stats.totalQueries++;
    this.queryTimes.push(duration);
    
    if (wasRetried) this.stats.retriedQueries++;
    if (wasTimeout) this.stats.timeoutQueries++;
    if (wasLockContention) this.stats.lockContentions++;
    
    this.stats.longestQueryTime = Math.max(this.stats.longestQueryTime, duration);
    this.stats.averageQueryTime = this.queryTimes.reduce((sum, time) => sum + time, 0) / this.queryTimes.length;
    
    // Keep only last 1000 query times to prevent memory growth
    if (this.queryTimes.length > 1000) {
      this.queryTimes = this.queryTimes.slice(-1000);
    }
  }

  recordRetryAttempt(): void {
    this.stats.totalRetryAttempts++;
  }

  getStats(): DatabaseStats {
    return { ...this.stats };
  }

  reset(): void {
    this.stats = {
      totalQueries: 0,
      timeoutQueries: 0,
      retriedQueries: 0,
      lockContentions: 0,
      averageQueryTime: 0,
      longestQueryTime: 0,
      totalRetryAttempts: 0
    };
    this.queryTimes = [];
  }

  logStats(): void {
    const stats = this.getStats();
    console.log(`[DATABASE-STATS] Query Statistics:`);
    console.log(`  - Total queries: ${stats.totalQueries}`);
    console.log(`  - Timeout queries: ${stats.timeoutQueries} (${(stats.timeoutQueries/Math.max(stats.totalQueries,1)*100).toFixed(1)}%)`);
    console.log(`  - Retried queries: ${stats.retriedQueries} (${(stats.retriedQueries/Math.max(stats.totalQueries,1)*100).toFixed(1)}%)`);
    console.log(`  - Lock contentions: ${stats.lockContentions} (${(stats.lockContentions/Math.max(stats.totalQueries,1)*100).toFixed(1)}%)`);
    console.log(`  - Average query time: ${stats.averageQueryTime.toFixed(1)}ms`);
    console.log(`  - Longest query time: ${stats.longestQueryTime}ms`);
    console.log(`  - Total retry attempts: ${stats.totalRetryAttempts}`);
  }
}

// Database operation wrapper with timeout and retry
export class DatabaseManager {
  private config: DatabaseConfig;
  private statsTracker: DatabaseStatsTracker;
  private activeOperations: Set<string> = new Set();

  constructor(private db: Database, config: Partial<DatabaseConfig> = {}) {
    this.config = { ...DEFAULT_DATABASE_CONFIG, ...config };
    this.statsTracker = new DatabaseStatsTracker();
    
    // Configure SQLite for better concurrency and timeout handling
    this.configureSQLite();
  }

  private configureSQLite(): void {
    try {
      // Set busy timeout for better lock handling
      this.db.exec(`PRAGMA busy_timeout = ${this.config.busyTimeout}`);
      
      // Enable WAL mode for better concurrency
      this.db.exec("PRAGMA journal_mode = WAL");
      
      // Set reasonable timeouts
      this.db.exec("PRAGMA lock_timeout = 30000");
      
      console.log(`[DATABASE-CONFIG] SQLite configured with busy_timeout: ${this.config.busyTimeout}ms, WAL mode enabled`);
    } catch (error) {
      console.warn(`[DATABASE-CONFIG] Warning: Could not configure SQLite settings: ${(error as Error).message}`);
    }
  }

  // Check if an error is transient and worth retrying
  private isTransientError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('database is locked') ||
      message.includes('database is busy') ||
      message.includes('disk i/o error') ||
      message.includes('attempt to write a readonly database') ||
      message.includes('sqlite_busy') ||
      message.includes('sqlite_locked') ||
      message.includes('sqlite_ioerr')
    );
  }

  // Check if an error indicates lock contention
  private isLockContentionError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('database is locked') ||
      message.includes('database is busy') ||
      message.includes('sqlite_busy') ||
      message.includes('sqlite_locked')
    );
  }

  // Calculate retry delay with exponential backoff
  private calculateRetryDelay(attempt: number): number {
    const delay = this.config.retryDelay * Math.pow(this.config.retryBackoffMultiplier, attempt - 1);
    return Math.min(delay, this.config.maxRetryDelay);
  }

  // Sleep for specified duration
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Execute a database operation with timeout and retry
  async executeWithRetry<T>(
    operation: () => T | Promise<T>,
    operationName: string,
    timeoutMs?: number
  ): Promise<T> {
    const effectiveTimeout = timeoutMs || this.config.queryTimeout;
    const operationId = `${operationName}_${Date.now()}_${Math.random()}`;
    
    this.activeOperations.add(operationId);
    
    let lastError: Error | null = null;
    let wasRetried = false;
    let wasTimeout = false;
    let wasLockContention = false;
    
    const startTime = Date.now();
    
    try {
      for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
        try {
          console.log(`[DATABASE-RETRY] Attempt ${attempt}/${this.config.retryAttempts} for ${operationName}`);
          
          // Execute with timeout
          const result = await this.executeWithTimeout(operation, effectiveTimeout, operationName);
          
          const duration = Date.now() - startTime;
          this.statsTracker.recordQuery(duration, wasRetried, wasTimeout, wasLockContention);
          
          if (attempt > 1) {
            console.log(`[DATABASE-RETRY] Operation ${operationName} succeeded on attempt ${attempt} after ${duration}ms`);
          }
          
          return result;
          
        } catch (error) {
          lastError = error as Error;
          
          if (error instanceof DatabaseTimeoutError) {
            wasTimeout = true;
            console.warn(`[DATABASE-TIMEOUT] Operation ${operationName} timed out on attempt ${attempt}/${this.config.retryAttempts} after ${error.timeoutMs}ms`);
          } else if (this.isLockContentionError(lastError)) {
            wasLockContention = true;
            console.warn(`[DATABASE-LOCK] Lock contention in ${operationName} on attempt ${attempt}/${this.config.retryAttempts}: ${lastError.message}`);
          } else if (this.isTransientError(lastError)) {
            console.warn(`[DATABASE-TRANSIENT] Transient error in ${operationName} on attempt ${attempt}/${this.config.retryAttempts}: ${lastError.message}`);
          } else {
            // Non-transient error, don't retry
            console.error(`[DATABASE-ERROR] Non-transient error in ${operationName}: ${lastError.message}`);
            throw lastError;
          }
          
          // Don't sleep after the last attempt
          if (attempt < this.config.retryAttempts) {
            wasRetried = true;
            this.statsTracker.recordRetryAttempt();
            
            const retryDelay = this.calculateRetryDelay(attempt);
            console.log(`[DATABASE-RETRY] Waiting ${retryDelay}ms before retry attempt ${attempt + 1}`);
            await this.sleep(retryDelay);
          }
        }
      }
      
      // All attempts exhausted
      const duration = Date.now() - startTime;
      this.statsTracker.recordQuery(duration, wasRetried, wasTimeout, wasLockContention);
      
      throw new DatabaseRetryExhaustedError(
        `Database operation ${operationName} failed after ${this.config.retryAttempts} attempts. Last error: ${lastError?.message}`,
        this.config.retryAttempts,
        lastError!
      );
      
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  // Execute operation with timeout
  private async executeWithTimeout<T>(
    operation: () => T | Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let completed = false;
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          reject(new DatabaseTimeoutError(`Database operation ${operationName} timed out after ${timeoutMs}ms`, timeoutMs, operationName));
        }
      }, timeoutMs);
      
      try {
        const result = operation();
        
        // Handle both sync and async operations
        if (result instanceof Promise) {
          result
            .then(value => {
              if (!completed) {
                completed = true;
                clearTimeout(timeoutId);
                resolve(value);
              }
            })
            .catch(error => {
              if (!completed) {
                completed = true;
                clearTimeout(timeoutId);
                reject(error);
              }
            });
        } else {
          if (!completed) {
            completed = true;
            clearTimeout(timeoutId);
            resolve(result);
          }
        }
      } catch (error) {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      }
    });
  }

  // Prepared statement wrapper with timeout and retry
  async prepare<T = any>(sql: string): Promise<any> {
    return this.executeWithRetry(
      () => this.db.prepare(sql),
      `prepare(${sql.substring(0, 50)}...)`
    );
  }

  // Query execution wrappers
  async get<T = any>(sql: string, params?: any): Promise<T | undefined> {
    const stmt = await this.prepare(sql);
    return this.executeWithRetry(
      () => stmt.get(params),
      `get(${sql.substring(0, 50)}...)`
    );
  }

  async all<T = any>(sql: string, params?: any): Promise<T[]> {
    const stmt = await this.prepare(sql);
    return this.executeWithRetry(
      () => stmt.all(params),
      `all(${sql.substring(0, 50)}...)`
    );
  }

  async run(sql: string, params?: any): Promise<any> {
    const stmt = await this.prepare(sql);
    return this.executeWithRetry(
      () => stmt.run(params),
      `run(${sql.substring(0, 50)}...)`
    );
  }

  // Execute SQL directly with timeout and retry
  async exec(sql: string): Promise<void> {
    return this.executeWithRetry(
      () => this.db.exec(sql),
      `exec(${sql.substring(0, 50)}...)`
    );
  }

  // Transaction wrapper with timeout and retry
  async transaction<T>(fn: () => T | Promise<T>, operationName: string = 'transaction'): Promise<T> {
    return this.executeWithRetry(
      async () => {
        return new Promise<T>((resolve, reject) => {
          try {
            const transaction = this.db.transaction(() => {
              const result = fn();
              if (result instanceof Promise) {
                result.then(resolve).catch(reject);
              } else {
                resolve(result);
              }
            });
            transaction();
          } catch (error) {
            reject(error);
          }
        });
      },
      operationName,
      this.config.transactionTimeout
    );
  }

  // Enhanced loadIssues with comprehensive timeout and retry
  async loadIssues(offset: number = 0, limit: number = 1000): Promise<any[]> {
    const query = `
      SELECT 
        i.issue_key,
        i.title,
        i.description,
        i.summary,
        i.resolution_description,
        i.related_url,
        i.related_artifacts,
        i.related_pages,
        GROUP_CONCAT(c.body) as comments
      FROM issues_fts i
      LEFT JOIN comments c ON i.issue_key = c.issue_key
      GROUP BY i.issue_key
      ORDER BY i.issue_key
      LIMIT $limit OFFSET $offset
    `;
    
    console.log(`[DATABASE-QUERY] Loading issues: offset=${offset}, limit=${limit}`);
    
    try {
      const result = await this.executeWithRetry(
        async () => {
          const stmt = await this.prepare(query);
          return stmt.all({ limit, offset });
        },
        `loadIssues(offset=${offset}, limit=${limit})`,
        this.config.queryTimeout
      );
      
      console.log(`[DATABASE-QUERY] Successfully loaded ${result.length} issues`);
      return result;
      
    } catch (error) {
      if (error instanceof DatabaseRetryExhaustedError) {
        console.warn(`[DATABASE-FALLBACK] loadIssues failed after all retries, returning empty array for graceful degradation`);
        return [];
      }
      throw error;
    }
  }

  // Get current database statistics
  getStats(): DatabaseStats {
    return this.statsTracker.getStats();
  }

  // Log database statistics
  logStats(): void {
    this.statsTracker.logStats();
  }

  // Reset statistics
  resetStats(): void {
    this.statsTracker.reset();
  }

  // Get active operations count
  getActiveOperationsCount(): number {
    return this.activeOperations.size;
  }

  // List active operations
  getActiveOperations(): string[] {
    return Array.from(this.activeOperations);
  }

  // Check database health
  async checkHealth(): Promise<{ healthy: boolean; issues: string[] }> {
    const issues: string[] = [];
    let healthy = true;

    try {
      // Test basic connectivity
      await this.executeWithRetry(
        () => this.db.prepare("SELECT 1").get(),
        "health_check_connectivity",
        5000 // 5 second timeout for health check
      );
    } catch (error) {
      healthy = false;
      issues.push(`Database connectivity failed: ${(error as Error).message}`);
    }

    // Check if there are too many active operations
    if (this.activeOperations.size > 10) {
      issues.push(`High number of active operations: ${this.activeOperations.size}`);
    }

    // Check statistics for concerning patterns
    const stats = this.getStats();
    if (stats.totalQueries > 0) {
      const timeoutRate = stats.timeoutQueries / stats.totalQueries;
      const lockContentionRate = stats.lockContentions / stats.totalQueries;
      
      if (timeoutRate > 0.1) { // More than 10% timeout rate
        healthy = false;
        issues.push(`High timeout rate: ${(timeoutRate * 100).toFixed(1)}%`);
      }
      
      if (lockContentionRate > 0.2) { // More than 20% lock contention rate
        issues.push(`High lock contention rate: ${(lockContentionRate * 100).toFixed(1)}%`);
      }
      
      if (stats.averageQueryTime > 5000) { // Average query time over 5 seconds
        issues.push(`High average query time: ${stats.averageQueryTime.toFixed(1)}ms`);
      }
    }

    return { healthy, issues };
  }

  // Close database connection
  close(): void {
    try {
      this.logStats();
      this.db.close();
      console.log(`[DATABASE-MANAGER] Database connection closed`);
    } catch (error) {
      console.error(`[DATABASE-MANAGER] Error closing database: ${(error as Error).message}`);
    }
  }
}

// Factory function to create DatabaseManager with recommended settings
export function createDatabaseManager(dbPath: string, config: Partial<DatabaseConfig> = {}): DatabaseManager {
  const db = new Database(dbPath, { strict: true });
  return new DatabaseManager(db, config);
}

// Utility function to handle database lock contention monitoring
export class DatabaseLockMonitor {
  private lockEvents: { timestamp: number; operation: string; duration: number }[] = [];
  private monitoring = false;

  startMonitoring(): void {
    this.monitoring = true;
    console.log(`[LOCK-MONITOR] Database lock monitoring started`);
  }

  stopMonitoring(): void {
    this.monitoring = false;
    this.logLockContentionReport();
    console.log(`[LOCK-MONITOR] Database lock monitoring stopped`);
  }

  recordLockEvent(operation: string, duration: number): void {
    if (this.monitoring) {
      this.lockEvents.push({
        timestamp: Date.now(),
        operation,
        duration
      });

      // Keep only last 1000 events to prevent memory growth
      if (this.lockEvents.length > 1000) {
        this.lockEvents = this.lockEvents.slice(-1000);
      }

      if (duration > 5000) { // Log long lock events immediately
        console.warn(`[LOCK-MONITOR] Long lock contention detected: ${operation} took ${duration}ms`);
      }
    }
  }

  private logLockContentionReport(): void {
    if (this.lockEvents.length === 0) {
      console.log(`[LOCK-MONITOR] No lock contention events recorded`);
      return;
    }

    const totalEvents = this.lockEvents.length;
    const avgDuration = this.lockEvents.reduce((sum, event) => sum + event.duration, 0) / totalEvents;
    const maxDuration = Math.max(...this.lockEvents.map(e => e.duration));
    const longEvents = this.lockEvents.filter(e => e.duration > 1000).length;

    console.log(`[LOCK-MONITOR] Lock Contention Report:`);
    console.log(`  - Total lock events: ${totalEvents}`);
    console.log(`  - Average duration: ${avgDuration.toFixed(1)}ms`);
    console.log(`  - Maximum duration: ${maxDuration}ms`);
    console.log(`  - Long events (>1s): ${longEvents} (${(longEvents/totalEvents*100).toFixed(1)}%)`);

    // Show most problematic operations
    const operationStats = new Map<string, { count: number; totalDuration: number; maxDuration: number }>();
    
    this.lockEvents.forEach(event => {
      if (!operationStats.has(event.operation)) {
        operationStats.set(event.operation, { count: 0, totalDuration: 0, maxDuration: 0 });
      }
      const stats = operationStats.get(event.operation)!;
      stats.count++;
      stats.totalDuration += event.duration;
      stats.maxDuration = Math.max(stats.maxDuration, event.duration);
    });

    const sortedOperations = Array.from(operationStats.entries())
      .sort((a, b) => b[1].totalDuration - a[1].totalDuration)
      .slice(0, 5);

    console.log(`[LOCK-MONITOR] Top 5 operations by total lock time:`);
    sortedOperations.forEach(([operation, stats], index) => {
      const avgDuration = stats.totalDuration / stats.count;
      console.log(`  ${index + 1}. ${operation}: ${stats.count} events, avg ${avgDuration.toFixed(1)}ms, max ${stats.maxDuration}ms`);
    });
  }

  reset(): void {
    this.lockEvents = [];
  }
}