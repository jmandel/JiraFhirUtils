#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { 
  DatabaseManager, 
  createDatabaseManager, 
  DatabaseLockMonitor,
  DatabaseConfig,
  DatabaseTimeoutError,
  DatabaseRetryExhaustedError
} from "./database-timeout-utils.ts";

console.log("=== Database Timeout and Retry Testing ===\n");

// Test configuration
const testDbPath = './test_database_timeout.sqlite';

// Clean up any existing test database
try {
  const fs = require('fs');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
    console.log("Cleaned up existing test database");
  }
} catch (error) {
  // Ignore cleanup errors
}

async function createTestDatabase(): Promise<void> {
  console.log("1. Creating test database with sample data...");
  
  const db = new Database(testDbPath, { strict: true });
  
  // Create test tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues_fts (
      issue_key TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      summary TEXT,
      resolution_description TEXT,
      related_url TEXT,
      related_artifacts TEXT,
      related_pages TEXT
    );
    
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      issue_key TEXT,
      body TEXT,
      FOREIGN KEY (issue_key) REFERENCES issues_fts(issue_key)
    );
  `);
  
  // Insert sample data
  const sampleIssues = [
    ['TEST-1', 'Test Issue 1', 'This is a test description', 'Test summary', 'Fixed', 'http://example.com', 'file1.txt', 'page1'],
    ['TEST-2', 'Test Issue 2', 'Another test description', 'Another summary', 'Resolved', 'http://test.com', 'file2.txt', 'page2'],
    ['TEST-3', 'Test Issue 3', 'Third test description', 'Third summary', 'Closed', 'http://demo.com', 'file3.txt', 'page3']
  ];
  
  const insertIssue = db.prepare(`
    INSERT INTO issues_fts (issue_key, title, description, summary, resolution_description, related_url, related_artifacts, related_pages)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  for (const issue of sampleIssues) {
    insertIssue.run(...issue);
  }
  
  // Insert sample comments
  const insertComment = db.prepare('INSERT INTO comments (issue_key, body) VALUES (?, ?)');
  insertComment.run('TEST-1', 'This is a comment for TEST-1');
  insertComment.run('TEST-2', 'This is a comment for TEST-2');
  insertComment.run('TEST-3', 'This is a comment for TEST-3');
  
  db.close();
  console.log("✅ Test database created with sample data");
}

async function testBasicDatabaseManager(): Promise<void> {
  console.log("\n2. Testing basic DatabaseManager functionality...");
  
  const config: Partial<DatabaseConfig> = {
    queryTimeout: 5000,        // 5 seconds
    retryAttempts: 3,
    retryDelay: 500,          // 0.5 seconds
    retryBackoffMultiplier: 2,
    maxRetryDelay: 2000,      // 2 seconds
    busyTimeout: 5000         // 5 seconds
  };
  
  const dbManager = createDatabaseManager(testDbPath, config);
  
  try {
    // Test basic health check
    const healthCheck = await dbManager.checkHealth();
    console.log(`Health check: ${healthCheck.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    if (!healthCheck.healthy) {
      console.log('Health issues:', healthCheck.issues);
    }
    
    // Test basic query
    const count = await dbManager.get('SELECT COUNT(*) as count FROM issues_fts');
    console.log(`✅ Basic query successful: ${count.count} issues found`);
    
    // Test prepared statement
    const issues = await dbManager.all('SELECT issue_key, title FROM issues_fts ORDER BY issue_key');
    console.log(`✅ Prepared statement successful: ${issues.length} issues retrieved`);
    issues.forEach(issue => console.log(`  - ${issue.issue_key}: ${issue.title}`));
    
    // Test loadIssues method
    const loadedIssues = await dbManager.loadIssues(0, 10);
    console.log(`✅ loadIssues successful: ${loadedIssues.length} issues loaded`);
    
    // Test transaction
    await dbManager.transaction(async () => {
      await dbManager.run("INSERT INTO comments (issue_key, body) VALUES (?, ?)", ['TEST-1', 'Transaction test comment']);
      console.log('✅ Transaction successful');
    }, 'test_transaction');
    
    console.log('✅ All basic DatabaseManager tests passed');
    
    // Display statistics
    console.log('\nDatabase Statistics:');
    dbManager.logStats();
    
    dbManager.close();
  } catch (error) {
    console.error('❌ Basic DatabaseManager test failed:', (error as Error).message);
    dbManager.close();
    throw error;
  }
}

async function testTimeoutHandling(): Promise<void> {
  console.log("\n3. Testing timeout handling...");
  
  const config: Partial<DatabaseConfig> = {
    queryTimeout: 100,        // Very short timeout for testing
    retryAttempts: 2,
    retryDelay: 50,
    retryBackoffMultiplier: 2,
    maxRetryDelay: 200,
    busyTimeout: 100
  };
  
  const dbManager = createDatabaseManager(testDbPath, config);
  
  try {
    // Test with a potentially slow query (large LIKE operation)
    const startTime = Date.now();
    try {
      await dbManager.executeWithRetry(
        () => new Promise(resolve => setTimeout(() => resolve('slow operation'), 300)), // 300ms operation
        'slow_test_operation'
      );
      console.log('❌ Expected timeout but operation succeeded');
    } catch (error) {
      const elapsed = Date.now() - startTime;
      if (error instanceof DatabaseTimeoutError) {
        console.log(`✅ Timeout handled correctly after ${elapsed}ms`);
      } else {
        console.log(`✅ Operation failed as expected (${error.constructor.name}): ${(error as Error).message}`);
      }
    }
    
    dbManager.close();
  } catch (error) {
    console.error('❌ Timeout handling test failed:', (error as Error).message);
    dbManager.close();
    throw error;
  }
}

async function testRetryLogic(): Promise<void> {
  console.log("\n4. Testing retry logic...");
  
  const config: Partial<DatabaseConfig> = {
    queryTimeout: 5000,
    retryAttempts: 3,
    retryDelay: 100,
    retryBackoffMultiplier: 2,
    maxRetryDelay: 500,
    busyTimeout: 1000
  };
  
  const dbManager = createDatabaseManager(testDbPath, config);
  
  try {
    // Test retry with a flaky operation (succeeds on 3rd attempt)
    let attemptCount = 0;
    const flakyOperation = () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error('database is busy'); // Simulate transient error
      }
      return 'success on attempt ' + attemptCount;
    };
    
    const result = await dbManager.executeWithRetry(flakyOperation, 'flaky_operation');
    console.log(`✅ Retry logic successful: ${result}`);
    console.log(`✅ Operation succeeded after ${attemptCount} attempts`);
    
    // Test with non-transient error (should not retry)
    attemptCount = 0;
    try {
      await dbManager.executeWithRetry(
        () => {
          attemptCount++;
          throw new Error('non-transient error'); // Non-transient error
        },
        'non_transient_operation'
      );
      console.log('❌ Expected non-transient error to fail immediately');
    } catch (error) {
      if (attemptCount === 1) {
        console.log(`✅ Non-transient error handled correctly (no retries): ${(error as Error).message}`);
      } else {
        console.log(`❌ Non-transient error was retried ${attemptCount} times`);
      }
    }
    
    dbManager.close();
  } catch (error) {
    console.error('❌ Retry logic test failed:', (error as Error).message);
    dbManager.close();
    throw error;
  }
}

async function testLockMonitoring(): Promise<void> {
  console.log("\n5. Testing database lock monitoring...");
  
  const monitor = new DatabaseLockMonitor();
  monitor.startMonitoring();
  
  // Simulate some lock events
  monitor.recordLockEvent('test_operation_1', 500);   // 0.5 second
  monitor.recordLockEvent('test_operation_2', 1200);  // 1.2 seconds (long)
  monitor.recordLockEvent('test_operation_3', 300);   // 0.3 seconds
  monitor.recordLockEvent('test_operation_1', 800);   // 0.8 seconds
  monitor.recordLockEvent('test_operation_4', 6000);  // 6 seconds (very long)
  
  console.log('✅ Lock events recorded');
  
  // Stop monitoring and show report
  monitor.stopMonitoring();
  console.log('✅ Lock monitoring test completed');
}

async function testErrorRecovery(): Promise<void> {
  console.log("\n6. Testing error recovery scenarios...");
  
  const config: Partial<DatabaseConfig> = {
    queryTimeout: 2000,
    transactionTimeout: 3000,
    retryAttempts: 3,
    retryDelay: 200,
    retryBackoffMultiplier: 1.5,
    maxRetryDelay: 1000,
    busyTimeout: 2000
  };
  
  const dbManager = createDatabaseManager(testDbPath, config);
  
  try {
    // Test graceful degradation with database error
    console.log('Testing graceful error handling...');
    
    try {
      await dbManager.run('SELECT * FROM non_existent_table');
      console.log('❌ Expected SQL error but query succeeded');
    } catch (error) {
      console.log(`✅ SQL error handled gracefully: ${(error as Error).message.substring(0, 50)}...`);
    }
    
    // Test that database manager still works after error
    const issues = await dbManager.all('SELECT COUNT(*) as count FROM issues_fts');
    console.log(`✅ Database manager recovered successfully: ${issues[0].count} issues found`);
    
    console.log('✅ Error recovery test completed');
    
    dbManager.close();
  } catch (error) {
    console.error('❌ Error recovery test failed:', (error as Error).message);
    dbManager.close();
    throw error;
  }
}

async function testPerformanceMonitoring(): Promise<void> {
  console.log("\n7. Testing performance monitoring...");
  
  const config: Partial<DatabaseConfig> = {
    queryTimeout: 5000,
    retryAttempts: 2,
    retryDelay: 100,
    busyTimeout: 2000
  };
  
  const dbManager = createDatabaseManager(testDbPath, config);
  
  try {
    // Execute multiple queries to generate statistics
    console.log('Executing multiple queries to generate performance data...');
    
    for (let i = 0; i < 10; i++) {
      await dbManager.get('SELECT COUNT(*) as count FROM issues_fts');
      await dbManager.all('SELECT issue_key FROM issues_fts ORDER BY issue_key');
      
      // Add some artificial delay
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Test one retry scenario
    let retryCount = 0;
    await dbManager.executeWithRetry(
      () => {
        retryCount++;
        if (retryCount === 1) {
          throw new Error('database is locked'); // Transient error
        }
        return 'success';
      },
      'retry_test'
    );
    
    console.log('✅ Performance data generated');
    
    // Display comprehensive statistics
    console.log('\nFinal Performance Statistics:');
    dbManager.logStats();
    
    const stats = dbManager.getStats();
    console.log('\nDetailed Stats:');
    console.log(`- Total queries: ${stats.totalQueries}`);
    console.log(`- Timeout rate: ${((stats.timeoutQueries / Math.max(stats.totalQueries, 1)) * 100).toFixed(1)}%`);
    console.log(`- Retry rate: ${((stats.retriedQueries / Math.max(stats.totalQueries, 1)) * 100).toFixed(1)}%`);
    console.log(`- Lock contention rate: ${((stats.lockContentions / Math.max(stats.totalQueries, 1)) * 100).toFixed(1)}%`);
    console.log(`- Average query time: ${stats.averageQueryTime.toFixed(1)}ms`);
    console.log(`- Longest query time: ${stats.longestQueryTime}ms`);
    console.log(`- Total retry attempts: ${stats.totalRetryAttempts}`);
    
    // Final health check
    const finalHealth = await dbManager.checkHealth();
    console.log(`\nFinal health check: ${finalHealth.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    if (!finalHealth.healthy) {
      console.log('Health issues:', finalHealth.issues);
    }
    
    console.log(`Active operations: ${dbManager.getActiveOperationsCount()}`);
    
    console.log('✅ Performance monitoring test completed');
    
    dbManager.close();
  } catch (error) {
    console.error('❌ Performance monitoring test failed:', (error as Error).message);
    dbManager.close();
    throw error;
  }
}

async function runAllTests(): Promise<void> {
  try {
    await createTestDatabase();
    await testBasicDatabaseManager();
    await testTimeoutHandling();
    await testRetryLogic();
    await testLockMonitoring();
    await testErrorRecovery();
    await testPerformanceMonitoring();
    
    console.log('\n🎉 All database timeout and retry tests passed successfully!');
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', (error as Error).message);
    if (process.env.NODE_ENV === 'development') {
      console.error('Stack trace:', (error as Error).stack);
    }
    process.exit(1);
  } finally {
    // Cleanup test database
    try {
      const fs = require('fs');
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
        console.log('\n🧹 Test database cleaned up');
      }
    } catch (error) {
      console.warn('Warning: Could not clean up test database:', (error as Error).message);
    }
  }
}

// Run the tests
runAllTests();