import { Database } from "bun:sqlite";
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Comprehensive Error Recovery System for TF-IDF Processing
 * Implements partial processing, checkpointing, error reporting, and graceful degradation
 */

// Error types for classification
export enum ErrorType {
  DATABASE_ERROR = 'database_error',
  PROCESSING_ERROR = 'processing_error',
  TIMEOUT_ERROR = 'timeout_error',
  MEMORY_ERROR = 'memory_error',
  VALIDATION_ERROR = 'validation_error',
  NETWORK_ERROR = 'network_error',
  SYSTEM_ERROR = 'system_error'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface ErrorRecord {
  id: string;
  timestamp: Date;
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  context: Record<string, any>;
  issueKey?: string;
  batchId?: string;
  recoveryAction?: string;
  retryCount: number;
  stackTrace?: string;
}

export interface ProcessingCheckpoint {
  id: string;
  timestamp: Date;
  processName: string;
  totalIssues: number;
  processedIssues: number;
  successfulIssues: number;
  failedIssues: number;
  skippedIssues: number;
  currentBatch: number;
  lastProcessedIssueKey?: string;
  memoryUsage: number;
  processingStats: Record<string, any>;
  canResume: boolean;
}

export interface RecoveryOptions {
  maxRetries: number;
  retryDelayMs: number;
  skipCorruptedRecords: boolean;
  enablePartialResults: boolean;
  checkpointInterval: number;
  maxErrorsBeforeAbort: number;
  gracefulDegradationThreshold: number;
}

export interface ProcessingResult<T> {
  success: boolean;
  data?: T;
  error?: ErrorRecord;
  partialResults?: T[];
  recovered: boolean;
  retryCount: number;
}

export interface BatchProcessingResult<T> {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  results: T[];
  errors: ErrorRecord[];
  checkpoint?: ProcessingCheckpoint;
  canContinue: boolean;
}

export const DEFAULT_RECOVERY_OPTIONS: RecoveryOptions = {
  maxRetries: 3,
  retryDelayMs: 1000,
  skipCorruptedRecords: true,
  enablePartialResults: true,
  checkpointInterval: 1000, // Every 1000 items
  maxErrorsBeforeAbort: 100,
  gracefulDegradationThreshold: 0.1 // 10% failure rate
};

/**
 * Error Recovery Manager - Central coordinator for all error handling
 */
export class ErrorRecoveryManager {
  private errors: ErrorRecord[] = [];
  private checkpoints: Map<string, ProcessingCheckpoint> = new Map();
  private options: RecoveryOptions;
  private dbPath?: string;
  private errorLogPath: string;
  private checkpointPath: string;

  constructor(options: Partial<RecoveryOptions> = {}, dbPath?: string) {
    this.options = { ...DEFAULT_RECOVERY_OPTIONS, ...options };
    this.dbPath = dbPath;
    this.errorLogPath = join(process.cwd(), 'error-recovery-log.json');
    this.checkpointPath = join(process.cwd(), 'processing-checkpoints.json');
  }

  /**
   * Record an error with comprehensive context
   */
  async recordError(
    type: ErrorType,
    severity: ErrorSeverity,
    message: string,
    context: Record<string, any> = {},
    error?: Error
  ): Promise<string> {
    const errorId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const errorRecord: ErrorRecord = {
      id: errorId,
      timestamp: new Date(),
      type,
      severity,
      message,
      context,
      issueKey: context.issueKey,
      batchId: context.batchId,
      retryCount: context.retryCount || 0,
      stackTrace: error?.stack
    };

    this.errors.push(errorRecord);
    
    // Log error immediately for critical issues
    if (severity === ErrorSeverity.CRITICAL || severity === ErrorSeverity.HIGH) {
      console.error(`[ERROR-RECOVERY] ${severity.toUpperCase()} ${type}: ${message}`);
      if (context.issueKey) {
        console.error(`[ERROR-RECOVERY] Issue: ${context.issueKey}`);
      }
      if (error?.stack && process.env.NODE_ENV === 'development') {
        console.error(`[ERROR-RECOVERY] Stack: ${error.stack}`);
      }
    }

    // Persist errors to file for recovery analysis
    await this.persistErrors();
    
    return errorId;
  }

  /**
   * Create a processing checkpoint
   */
  async createCheckpoint(
    processName: string,
    stats: {
      totalIssues: number;
      processedIssues: number;
      successfulIssues: number;
      failedIssues: number;
      skippedIssues: number;
      currentBatch: number;
      lastProcessedIssueKey?: string;
      memoryUsage: number;
      processingStats?: Record<string, any>;
    }
  ): Promise<string> {
    const checkpointId = `${processName}_${Date.now()}`;
    
    const checkpoint: ProcessingCheckpoint = {
      id: checkpointId,
      timestamp: new Date(),
      processName,
      ...stats,
      processingStats: stats.processingStats || {},
      canResume: stats.processedIssues > 0 && stats.failedIssues < this.options.maxErrorsBeforeAbort
    };

    this.checkpoints.set(checkpointId, checkpoint);
    
    console.log(`[CHECKPOINT] Created checkpoint ${checkpointId} for ${processName}`);
    console.log(`[CHECKPOINT] Progress: ${stats.processedIssues}/${stats.totalIssues} (${(stats.processedIssues/stats.totalIssues*100).toFixed(1)}%)`);
    console.log(`[CHECKPOINT] Success: ${stats.successfulIssues}, Failed: ${stats.failedIssues}, Skipped: ${stats.skippedIssues}`);
    
    await this.persistCheckpoints();
    return checkpointId;
  }

  /**
   * Resume processing from a checkpoint
   */
  async resumeFromCheckpoint(checkpointId: string): Promise<ProcessingCheckpoint | null> {
    // Load checkpoints from file if not in memory
    await this.loadCheckpoints();
    
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      console.warn(`[RECOVERY] Checkpoint ${checkpointId} not found`);
      return null;
    }

    if (!checkpoint.canResume) {
      console.warn(`[RECOVERY] Checkpoint ${checkpointId} is not resumable (too many failures)`);
      return null;
    }

    console.log(`[RECOVERY] Resuming from checkpoint ${checkpointId}`);
    console.log(`[RECOVERY] Process: ${checkpoint.processName}, Progress: ${checkpoint.processedIssues}/${checkpoint.totalIssues}`);
    console.log(`[RECOVERY] Last processed: ${checkpoint.lastProcessedIssueKey || 'N/A'}`);
    
    return checkpoint;
  }

  /**
   * Get the latest checkpoint for a process
   */
  async getLatestCheckpoint(processName: string): Promise<ProcessingCheckpoint | null> {
    await this.loadCheckpoints();
    
    const processCheckpoints = Array.from(this.checkpoints.values())
      .filter(cp => cp.processName === processName)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    return processCheckpoints[0] || null;
  }

  /**
   * Determine if processing should continue based on error patterns
   */
  shouldContinueProcessing(processName: string): { continue: boolean; reason: string } {
    const recentErrors = this.getRecentErrors(5 * 60 * 1000); // Last 5 minutes
    const criticalErrors = recentErrors.filter(e => e.severity === ErrorSeverity.CRITICAL);
    const processErrors = recentErrors.filter(e => e.context.processName === processName);
    
    // Check for critical errors
    if (criticalErrors.length > 0) {
      return { 
        continue: false, 
        reason: `Critical errors detected: ${criticalErrors.length} critical errors in last 5 minutes`
      };
    }

    // Check error rate threshold
    if (processErrors.length > this.options.maxErrorsBeforeAbort) {
      return { 
        continue: false, 
        reason: `Error threshold exceeded: ${processErrors.length} errors > ${this.options.maxErrorsBeforeAbort} max`
      };
    }

    // Check for system resource issues
    const memoryErrors = recentErrors.filter(e => e.type === ErrorType.MEMORY_ERROR);
    if (memoryErrors.length > 3) {
      return { 
        continue: false, 
        reason: `Memory issues detected: ${memoryErrors.length} memory errors in last 5 minutes`
      };
    }

    return { continue: true, reason: 'Error levels within acceptable limits' };
  }

  /**
   * Process a batch with comprehensive error recovery
   */
  async processBatchWithRecovery<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    batchId: string,
    processName: string
  ): Promise<BatchProcessingResult<R>> {
    const results: R[] = [];
    const errors: ErrorRecord[] = [];
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    console.log(`[BATCH-RECOVERY] Processing batch ${batchId} with ${items.length} items`);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let retryCount = 0;
      let success = false;
      let result: R | undefined;

      while (retryCount <= this.options.maxRetries && !success) {
        try {
          // Check if we should continue processing
          const shouldContinue = this.shouldContinueProcessing(processName);
          if (!shouldContinue.continue) {
            console.warn(`[BATCH-RECOVERY] Stopping processing: ${shouldContinue.reason}`);
            return {
              totalProcessed: i,
              successful,
              failed,
              skipped,
              results,
              errors,
              canContinue: false
            };
          }

          result = await processor(item, i);
          results.push(result);
          successful++;
          success = true;

        } catch (error) {
          retryCount++;
          
          const errorId = await this.recordError(
            this.classifyError(error as Error),
            this.determineSeverity(error as Error, retryCount),
            `Processing failed for item ${i}`,
            {
              batchId,
              processName,
              itemIndex: i,
              retryCount,
              item: this.sanitizeForLogging(item)
            },
            error as Error
          );

          if (retryCount <= this.options.maxRetries) {
            console.warn(`[BATCH-RECOVERY] Retry ${retryCount}/${this.options.maxRetries} for item ${i} after error: ${(error as Error).message}`);
            await this.delay(this.options.retryDelayMs * Math.pow(2, retryCount - 1)); // Exponential backoff
          } else {
            console.error(`[BATCH-RECOVERY] Max retries exceeded for item ${i}: ${(error as Error).message}`);
            
            if (this.options.skipCorruptedRecords) {
              console.warn(`[BATCH-RECOVERY] Skipping corrupted item ${i}`);
              skipped++;
            } else {
              failed++;
              errors.push(this.errors.find(e => e.id === errorId)!);
            }
          }
        }
      }
    }

    const failureRate = failed / items.length;
    const canContinue = failureRate < this.options.gracefulDegradationThreshold;

    console.log(`[BATCH-RECOVERY] Batch ${batchId} completed: ${successful} success, ${failed} failed, ${skipped} skipped`);
    console.log(`[BATCH-RECOVERY] Failure rate: ${(failureRate * 100).toFixed(1)}%, Can continue: ${canContinue}`);

    return {
      totalProcessed: items.length,
      successful,
      failed,
      skipped,
      results,
      errors,
      canContinue
    };
  }

  /**
   * Get error statistics and patterns
   */
  getErrorAnalysis(): {
    totalErrors: number;
    errorsByType: Record<ErrorType, number>;
    errorsBySeverity: Record<ErrorSeverity, number>;
    recentErrorRate: number;
    topErrorMessages: Array<{ message: string; count: number }>;
    problemIssues: Array<{ issueKey: string; errorCount: number }>;
  } {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const recentErrors = this.errors.filter(e => e.timestamp.getTime() > oneHourAgo);

    const errorsByType = this.errors.reduce((acc, error) => {
      acc[error.type] = (acc[error.type] || 0) + 1;
      return acc;
    }, {} as Record<ErrorType, number>);

    const errorsBySeverity = this.errors.reduce((acc, error) => {
      acc[error.severity] = (acc[error.severity] || 0) + 1;
      return acc;
    }, {} as Record<ErrorSeverity, number>);

    const messageCounts = this.errors.reduce((acc, error) => {
      const key = error.message.substring(0, 100); // Truncate for grouping
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topErrorMessages = Object.entries(messageCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([message, count]) => ({ message, count }));

    const issueCounts = this.errors
      .filter(e => e.issueKey)
      .reduce((acc, error) => {
        acc[error.issueKey!] = (acc[error.issueKey!] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    const problemIssues = Object.entries(issueCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([issueKey, errorCount]) => ({ issueKey, errorCount }));

    return {
      totalErrors: this.errors.length,
      errorsByType,
      errorsBySeverity,
      recentErrorRate: recentErrors.length,
      topErrorMessages,
      problemIssues
    };
  }

  /**
   * Generate error recovery report
   */
  generateRecoveryReport(): string {
    const analysis = this.getErrorAnalysis();
    const checkpointCount = this.checkpoints.size;
    
    const report = [
      "=== ERROR RECOVERY REPORT ===",
      `Total Errors: ${analysis.totalErrors}`,
      `Recent Errors (1hr): ${analysis.recentErrorRate}`,
      `Checkpoints Created: ${checkpointCount}`,
      "",
      "Error Distribution by Type:",
      ...Object.entries(analysis.errorsByType).map(([type, count]) => `  ${type}: ${count}`),
      "",
      "Error Distribution by Severity:",
      ...Object.entries(analysis.errorsBySeverity).map(([severity, count]) => `  ${severity}: ${count}`),
      "",
      "Top Error Messages:",
      ...analysis.topErrorMessages.map((msg, i) => `  ${i + 1}. ${msg.message} (${msg.count} times)`),
      "",
      "Problematic Issues:",
      ...analysis.problemIssues.map((issue, i) => `  ${i + 1}. ${issue.issueKey}: ${issue.errorCount} errors`),
      ""
    ].join("\n");

    return report;
  }

  // Private helper methods

  private classifyError(error: Error): ErrorType {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || '';

    if (message.includes('database') || message.includes('sqlite') || stack.includes('database')) {
      return ErrorType.DATABASE_ERROR;
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return ErrorType.TIMEOUT_ERROR;
    }
    if (message.includes('memory') || message.includes('heap')) {
      return ErrorType.MEMORY_ERROR;
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return ErrorType.VALIDATION_ERROR;
    }
    if (message.includes('network') || message.includes('connection')) {
      return ErrorType.NETWORK_ERROR;
    }
    if (message.includes('system') || message.includes('enoent') || message.includes('permission')) {
      return ErrorType.SYSTEM_ERROR;
    }
    
    return ErrorType.PROCESSING_ERROR;
  }

  private determineSeverity(error: Error, retryCount: number): ErrorSeverity {
    const message = error.message.toLowerCase();
    
    if (message.includes('critical') || message.includes('fatal') || message.includes('corrupt')) {
      return ErrorSeverity.CRITICAL;
    }
    if (retryCount > 2 || message.includes('timeout') || message.includes('memory')) {
      return ErrorSeverity.HIGH;
    }
    if (retryCount > 1 || message.includes('database') || message.includes('network')) {
      return ErrorSeverity.MEDIUM;
    }
    
    return ErrorSeverity.LOW;
  }

  private sanitizeForLogging(item: any): any {
    if (typeof item !== 'object' || item === null) {
      return item;
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === 'string' && value.length > 200) {
        sanitized[key] = value.substring(0, 200) + '...';
      } else if (typeof value === 'object') {
        sanitized[key] = '[Object]';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private getRecentErrors(timeWindowMs: number): ErrorRecord[] {
    const cutoff = Date.now() - timeWindowMs;
    return this.errors.filter(e => e.timestamp.getTime() > cutoff);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async persistErrors(): Promise<void> {
    try {
      const errorData = {
        timestamp: new Date().toISOString(),
        errors: this.errors.slice(-1000) // Keep last 1000 errors
      };
      await fs.writeFile(this.errorLogPath, JSON.stringify(errorData, null, 2));
    } catch (error) {
      console.error('[ERROR-RECOVERY] Failed to persist errors:', (error as Error).message);
    }
  }

  private async loadErrors(): Promise<void> {
    try {
      const data = await fs.readFile(this.errorLogPath, 'utf-8');
      const errorData = JSON.parse(data);
      this.errors = errorData.errors.map((e: any) => ({
        ...e,
        timestamp: new Date(e.timestamp)
      }));
    } catch (error) {
      // File doesn't exist or is corrupted - start fresh
      this.errors = [];
    }
  }

  private async persistCheckpoints(): Promise<void> {
    try {
      const checkpointData = {
        timestamp: new Date().toISOString(),
        checkpoints: Array.from(this.checkpoints.values())
      };
      await fs.writeFile(this.checkpointPath, JSON.stringify(checkpointData, null, 2));
    } catch (error) {
      console.error('[ERROR-RECOVERY] Failed to persist checkpoints:', (error as Error).message);
    }
  }

  private async loadCheckpoints(): Promise<void> {
    try {
      const data = await fs.readFile(this.checkpointPath, 'utf-8');
      const checkpointData = JSON.parse(data);
      this.checkpoints = new Map(
        checkpointData.checkpoints.map((cp: any) => [
          cp.id,
          { ...cp, timestamp: new Date(cp.timestamp) }
        ])
      );
    } catch (error) {
      // File doesn't exist or is corrupted - start fresh
      this.checkpoints = new Map();
    }
  }
}

/**
 * Wrap any async function with error recovery capabilities
 */
export async function withErrorRecovery<T>(
  operation: () => Promise<T>,
  errorManager: ErrorRecoveryManager,
  context: {
    operationName: string;
    maxRetries?: number;
    timeoutMs?: number;
    fallbackValue?: T;
    skipOnError?: boolean;
  }
): Promise<ProcessingResult<T>> {
  const maxRetries = context.maxRetries || 3;
  let retryCount = 0;
  let lastError: Error | undefined;

  while (retryCount <= maxRetries) {
    try {
      let result: T;
      
      if (context.timeoutMs) {
        result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Operation ${context.operationName} timed out after ${context.timeoutMs}ms`)), context.timeoutMs!)
          )
        ]);
      } else {
        result = await operation();
      }

      if (retryCount > 0) {
        console.log(`[ERROR-RECOVERY] Operation ${context.operationName} succeeded after ${retryCount} retries`);
      }

      return {
        success: true,
        data: result,
        recovered: retryCount > 0,
        retryCount
      };

    } catch (error) {
      lastError = error as Error;
      retryCount++;

      await errorManager.recordError(
        errorManager['classifyError'](lastError),
        errorManager['determineSeverity'](lastError, retryCount),
        `Operation ${context.operationName} failed (attempt ${retryCount})`,
        {
          operationName: context.operationName,
          retryCount,
          timeoutMs: context.timeoutMs
        },
        lastError
      );

      if (retryCount <= maxRetries) {
        const delay = 1000 * Math.pow(2, retryCount - 1); // Exponential backoff
        console.warn(`[ERROR-RECOVERY] Retrying ${context.operationName} in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted
  console.error(`[ERROR-RECOVERY] Operation ${context.operationName} failed after ${maxRetries} retries`);

  if (context.skipOnError) {
    console.warn(`[ERROR-RECOVERY] Skipping failed operation ${context.operationName}`);
    return {
      success: false,
      error: {
        id: `recovery_skip_${Date.now()}`,
        timestamp: new Date(),
        type: ErrorType.PROCESSING_ERROR,
        severity: ErrorSeverity.MEDIUM,
        message: `Operation skipped after ${maxRetries} failed retries`,
        context: { operationName: context.operationName },
        retryCount: maxRetries
      },
      recovered: false,
      retryCount
    };
  }

  if (context.fallbackValue !== undefined) {
    console.warn(`[ERROR-RECOVERY] Using fallback value for ${context.operationName}`);
    return {
      success: false,
      data: context.fallbackValue,
      error: {
        id: `recovery_fallback_${Date.now()}`,
        timestamp: new Date(),
        type: ErrorType.PROCESSING_ERROR,
        severity: ErrorSeverity.MEDIUM,
        message: `Operation used fallback after ${maxRetries} failed retries`,
        context: { operationName: context.operationName },
        retryCount: maxRetries
      },
      recovered: true,
      retryCount
    };
  }

  return {
    success: false,
    error: {
      id: `recovery_failed_${Date.now()}`,
      timestamp: new Date(),
      type: ErrorType.PROCESSING_ERROR,
      severity: ErrorSeverity.HIGH,
      message: lastError?.message || 'Unknown error',
      context: { operationName: context.operationName },
      retryCount: maxRetries
    },
    recovered: false,
    retryCount
  };
}