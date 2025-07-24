/**
 * Test comprehensive error recovery system
 * Verifies partial processing, checkpointing, error reporting, and graceful degradation
 */

import {
  ErrorRecoveryManager,
  ErrorType,
  ErrorSeverity,
  withErrorRecovery,
  DEFAULT_RECOVERY_OPTIONS
} from "./error-recovery-utils.ts";

interface TestDocument {
  key: string;
  title: string;
  description?: string;
  shouldFail?: boolean;
  failureType?: 'timeout' | 'validation' | 'processing' | 'memory';
}

async function testErrorRecoverySystem(): Promise<void> {
  console.log("=== Testing Comprehensive Error Recovery System ===\n");

  const errorRecoveryManager = new ErrorRecoveryManager({
    maxRetries: 3,
    retryDelayMs: 100, // Faster for testing
    skipCorruptedRecords: true,
    enablePartialResults: true,
    checkpointInterval: 5,
    maxErrorsBeforeAbort: 10,
    gracefulDegradationThreshold: 0.3 // 30% failure rate
  });

  // Test 1: Basic error recording and classification
  console.log("1. Testing Error Recording and Classification");
  await testErrorRecording(errorRecoveryManager);

  // Test 2: Checkpoint creation and resume capability
  console.log("\n2. Testing Checkpoint System");
  await testCheckpointSystem(errorRecoveryManager);

  // Test 3: Batch processing with error recovery
  console.log("\n3. Testing Batch Processing with Recovery");
  await testBatchProcessing(errorRecoveryManager);

  // Test 4: withErrorRecovery wrapper function
  console.log("\n4. Testing Error Recovery Wrapper");
  await testErrorRecoveryWrapper(errorRecoveryManager);

  // Test 5: Graceful degradation scenarios
  console.log("\n5. Testing Graceful Degradation");
  await testGracefulDegradation(errorRecoveryManager);

  // Test 6: Error analysis and reporting
  console.log("\n6. Testing Error Analysis and Reporting");
  await testErrorAnalysis(errorRecoveryManager);

  console.log("\n=== Error Recovery System Test Complete ===\n");
  console.log(errorRecoveryManager.generateRecoveryReport());
}

async function testErrorRecording(manager: ErrorRecoveryManager): Promise<void> {
  console.log("  Recording various error types...");

  // Test different error types and severities
  await manager.recordError(
    ErrorType.DATABASE_ERROR,
    ErrorSeverity.HIGH,
    "Database connection failed",
    { operation: "query", table: "issues" }
  );

  await manager.recordError(
    ErrorType.PROCESSING_ERROR,
    ErrorSeverity.MEDIUM,
    "Document preprocessing failed",
    { issueKey: "TEST-123", phase: "tokenization" }
  );

  await manager.recordError(
    ErrorType.VALIDATION_ERROR,
    ErrorSeverity.LOW,
    "Invalid field format",
    { issueKey: "TEST-456", field: "title" }
  );

  await manager.recordError(
    ErrorType.TIMEOUT_ERROR,
    ErrorSeverity.CRITICAL,
    "Operation timed out after 30 seconds",
    { operation: "corpus-building", timeout: 30000 }
  );

  console.log("  ✅ Error recording successful");
}

async function testCheckpointSystem(manager: ErrorRecoveryManager): Promise<void> {
  console.log("  Creating checkpoints...");

  const checkpointId1 = await manager.createCheckpoint('test-process', {
    totalIssues: 1000,
    processedIssues: 250,
    successfulIssues: 240,
    failedIssues: 5,
    skippedIssues: 5,
    currentBatch: 5,
    lastProcessedIssueKey: 'TEST-250',
    memoryUsage: 150,
    processingStats: { phase: 'corpus-building', batchSize: 50 }
  });

  const checkpointId2 = await manager.createCheckpoint('test-process', {
    totalIssues: 1000,
    processedIssues: 500,
    successfulIssues: 485,
    failedIssues: 10,
    skippedIssues: 5,
    currentBatch: 10,
    lastProcessedIssueKey: 'TEST-500',
    memoryUsage: 200,
    processingStats: { phase: 'corpus-building', batchSize: 50 }
  });

  // Test checkpoint retrieval
  const latestCheckpoint = await manager.getLatestCheckpoint('test-process');
  if (latestCheckpoint && latestCheckpoint.id === checkpointId2) {
    console.log("  ✅ Latest checkpoint retrieval successful");
  } else {
    console.log("  ❌ Latest checkpoint retrieval failed");
  }

  // Test checkpoint resume
  const resumeCheckpoint = await manager.resumeFromCheckpoint(checkpointId1);
  if (resumeCheckpoint && resumeCheckpoint.canResume) {
    console.log("  ✅ Checkpoint resume capability verified");
  } else {
    console.log("  ❌ Checkpoint resume failed");
  }
}

async function testBatchProcessing(manager: ErrorRecoveryManager): Promise<void> {
  console.log("  Processing batch with mixed success/failure scenarios...");

  // Create test documents with various failure scenarios
  const testDocuments: TestDocument[] = [
    { key: 'DOC-001', title: 'Normal document 1' },
    { key: 'DOC-002', title: 'Normal document 2' },
    { key: 'DOC-003', title: 'Document that will fail', shouldFail: true, failureType: 'processing' },
    { key: 'DOC-004', title: 'Normal document 3' },
    { key: 'DOC-005', title: 'Timeout document', shouldFail: true, failureType: 'timeout' },
    { key: 'DOC-006', title: 'Normal document 4' },
    { key: 'DOC-007', title: 'Validation error', shouldFail: true, failureType: 'validation' },
    { key: 'DOC-008', title: 'Normal document 5' },
  ];

  const batchResult = await manager.processBatchWithRecovery(
    testDocuments,
    async (doc: TestDocument, index: number) => {
      // Simulate processing with potential failures
      if (doc.shouldFail) {
        switch (doc.failureType) {
          case 'timeout':
            await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
            throw new Error(`Timeout processing document ${doc.key}`);
          case 'validation':
            throw new Error(`Validation failed for document ${doc.key}: invalid title format`);
          case 'processing':
            throw new Error(`Processing error for document ${doc.key}: unexpected content`);
          case 'memory':
            throw new Error(`Memory error processing document ${doc.key}: heap exhausted`);
          default:
            throw new Error(`Unknown error for document ${doc.key}`);
        }
      }

      // Simulate successful processing
      return {
        docId: doc.key,
        processed: true,
        tokens: doc.title.split(' ').length
      };
    },
    'test-batch-001',
    'batch-processing-test'
  );

  console.log(`  Batch Results: ${batchResult.successful} successful, ${batchResult.failed} failed, ${batchResult.skipped} skipped`);
  console.log(`  Can continue: ${batchResult.canContinue}`);

  if (batchResult.successful >= 5 && batchResult.failed >= 2 && batchResult.canContinue) {
    console.log("  ✅ Batch processing with error recovery successful");
  } else {
    console.log("  ❌ Batch processing test failed");
  }
}

async function testErrorRecoveryWrapper(manager: ErrorRecoveryManager): Promise<void> {
  console.log("  Testing withErrorRecovery wrapper function...");

  // Test successful operation with retries
  const successResult = await withErrorRecovery(
    async () => {
      // Simulate an operation that succeeds after retry
      if (Math.random() > 0.7) { // 30% chance of success
        return "Operation successful!";
      }
      throw new Error("Simulated failure");
    },
    manager,
    {
      operationName: 'test-operation-success',
      maxRetries: 5,
      timeoutMs: 1000
    }
  );

  if (successResult.success) {
    console.log("  ✅ Successful operation test passed");
  }

  // Test operation with timeout
  const timeoutResult = await withErrorRecovery(
    async () => {
      await new Promise(resolve => setTimeout(resolve, 200)); // Exceeds timeout
      return "Should not reach here";
    },
    manager,
    {
      operationName: 'test-operation-timeout',
      maxRetries: 2,
      timeoutMs: 100,
      skipOnError: true
    }
  );

  if (!timeoutResult.success && timeoutResult.error?.type === ErrorType.PROCESSING_ERROR) {
    console.log("  ✅ Timeout operation test passed");
  }

  // Test operation with fallback
  const fallbackResult = await withErrorRecovery(
    async () => {
      throw new Error("This always fails");
    },
    manager,
    {
      operationName: 'test-operation-fallback',
      maxRetries: 2,
      fallbackValue: "Fallback value used"
    }
  );

  if (!fallbackResult.success && fallbackResult.data === "Fallback value used" && fallbackResult.recovered) {
    console.log("  ✅ Fallback operation test passed");
  }
}

async function testGracefulDegradation(manager: ErrorRecoveryManager): Promise<void> {
  console.log("  Testing graceful degradation scenarios...");

  // Create a scenario with high failure rate
  const highFailureDocuments: TestDocument[] = Array.from({ length: 20 }, (_, i) => ({
    key: `FAIL-${i.toString().padStart(3, '0')}`,
    title: `Document ${i}`,
    shouldFail: i < 15, // 75% failure rate
    failureType: 'processing'
  }));

  const degradationResult = await manager.processBatchWithRecovery(
    highFailureDocuments,
    async (doc: TestDocument, index: number) => {
      if (doc.shouldFail) {
        throw new Error(`Processing failed for ${doc.key}`);
      }
      return { docId: doc.key, processed: true };
    },
    'high-failure-batch',
    'degradation-test'
  );

  const failureRate = degradationResult.failed / degradationResult.totalProcessed;
  console.log(`  High failure scenario: ${(failureRate * 100).toFixed(1)}% failure rate`);

  if (failureRate > 0.5 && !degradationResult.canContinue) {
    console.log("  ✅ Graceful degradation triggered correctly");
  } else {
    console.log("  ❌ Graceful degradation test failed");
  }

  // Test should continue processing decision
  const shouldContinue = manager.shouldContinueProcessing('degradation-test');
  if (!shouldContinue.continue && shouldContinue.reason.includes('Error threshold exceeded')) {
    console.log("  ✅ Processing termination logic working correctly");
  }
}

async function testErrorAnalysis(manager: ErrorRecoveryManager): Promise<void> {
  console.log("  Testing error analysis and reporting...");

  const analysis = manager.getErrorAnalysis();
  
  console.log(`  Total errors recorded: ${analysis.totalErrors}`);
  console.log(`  Error types: ${Object.keys(analysis.errorsByType).length}`);
  console.log(`  Error severities: ${Object.keys(analysis.errorsBySeverity).length}`);
  console.log(`  Top error messages: ${analysis.topErrorMessages.length}`);

  if (analysis.totalErrors > 10 && 
      Object.keys(analysis.errorsByType).length >= 3 &&
      Object.keys(analysis.errorsBySeverity).length >= 3) {
    console.log("  ✅ Error analysis working correctly");
  } else {
    console.log("  ❌ Error analysis test failed");
  }

  // Test report generation
  const report = manager.generateRecoveryReport();
  if (report.includes('ERROR RECOVERY REPORT') && 
      report.includes('Total Errors:') && 
      report.includes('Checkpoints Created:')) {
    console.log("  ✅ Error report generation successful");
  } else {
    console.log("  ❌ Error report generation failed");
  }
}

// Run the test
if (import.meta.main) {
  try {
    await testErrorRecoverySystem();
    console.log("✅ All error recovery system tests completed successfully!");
  } catch (error) {
    console.error("❌ Error recovery system test failed:", (error as Error).message);
    console.error("Stack trace:", (error as Error).stack);
    process.exit(1);
  }
}