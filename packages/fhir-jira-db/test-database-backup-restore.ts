#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { getDatabasePath } from "@jira-fhir-utils/database-utils";

interface BackupResult {
    testName: string;
    status: 'PASS' | 'FAIL' | 'WARNING';
    message: string;
    details?: any;
    recommendation?: string;
}

class DatabaseBackupRestoreTester {
    private originalDbPath: string;
    private backupDbPath: string;
    private testDbPath: string;
    private results: BackupResult[] = [];

    constructor(originalDbPath: string) {
        this.originalDbPath = originalDbPath;
        this.backupDbPath = originalDbPath + '.backup.test';
        this.testDbPath = originalDbPath + '.restore.test';
    }

    private addResult(testName: string, status: BackupResult['status'], message: string, details?: any, recommendation?: string): void {
        this.results.push({
            testName,
            status,
            message,
            details,
            recommendation
        });
    }

    private logProgress(testName: string): void {
        console.log(`[TESTING] ${testName}...`);
    }

    async runBackupRestoreTests(): Promise<BackupResult[]> {
        console.log("💾 Starting database backup and restore testing...\n");

        // Test database backup functionality
        await this.testDatabaseBackup();
        
        // Test backup integrity
        await this.testBackupIntegrity();
        
        // Test database restore functionality
        await this.testDatabaseRestore();
        
        // Test restored database integrity
        await this.testRestoredDatabaseIntegrity();
        
        // Test data consistency between original and restored
        await this.testDataConsistency();
        
        // Cleanup test files
        await this.cleanupTestFiles();

        return this.results;
    }

    private async testDatabaseBackup(): Promise<void> {
        this.logProgress("Database Backup Creation");
        
        try {
            // Open original database in readonly mode
            const originalDb = new Database(this.originalDbPath, { readonly: true });
            
            // Create backup using SQLite VACUUM INTO
            const startTime = Date.now();
            originalDb.exec(`VACUUM INTO '${this.backupDbPath}'`);
            const backupTime = Date.now() - startTime;
            
            originalDb.close();
            
            // Check if backup file was created
            const backupExists = await Bun.file(this.backupDbPath).exists();
            if (backupExists) {
                const backupFile = Bun.file(this.backupDbPath);
                const originalFile = Bun.file(this.originalDbPath);
                const backupSize = backupFile.size;
                const originalSize = originalFile.size;
                const compressionRatio = Math.round((1 - backupSize / originalSize) * 100);
                
                this.addResult(
                    "Database Backup Creation",
                    "PASS",
                    `Backup created successfully in ${backupTime}ms`,
                    { 
                        backupTime,
                        originalSize,
                        backupSize,
                        compressionRatio: compressionRatio >= 0 ? compressionRatio : 0
                    }
                );
            } else {
                this.addResult(
                    "Database Backup Creation",
                    "FAIL",
                    "Backup file was not created",
                    { backupPath: this.backupDbPath },
                    "Check file permissions and disk space"
                );
            }
        } catch (error) {
            this.addResult(
                "Database Backup Creation",
                "FAIL",
                `Backup creation failed: ${error}`,
                { error: String(error) },
                "Check database connectivity and file permissions"
            );
        }
    }

    private async testBackupIntegrity(): Promise<void> {
        this.logProgress("Backup File Integrity Check");
        
        try {
            const backupExists = await Bun.file(this.backupDbPath).exists();
            if (!backupExists) {
                this.addResult(
                    "Backup File Integrity",
                    "FAIL",
                    "Backup file does not exist - cannot test integrity",
                    { backupPath: this.backupDbPath }
                );
                return;
            }
            
            // Open backup database and run integrity check
            const backupDb = new Database(this.backupDbPath, { readonly: true });
            
            const integrityResults = backupDb.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
            
            if (integrityResults.length === 1 && integrityResults[0].integrity_check === "ok") {
                // Additional checks - verify key tables exist and have data
                const issuesCount = backupDb.prepare("SELECT COUNT(*) as count FROM issues").get() as { count: number };
                const commentsCount = backupDb.prepare("SELECT COUNT(*) as count FROM comments").get() as { count: number };
                const ftsCount = backupDb.prepare("SELECT COUNT(*) as count FROM issues_fts").get() as { count: number };
                
                this.addResult(
                    "Backup File Integrity",
                    "PASS",
                    "Backup database passed integrity check with complete data",
                    { 
                        integrityCheck: "ok",
                        issuesCount: issuesCount.count,
                        commentsCount: commentsCount.count,
                        ftsCount: ftsCount.count
                    }
                );
            } else {
                this.addResult(
                    "Backup File Integrity",
                    "FAIL",
                    "Backup database failed integrity check",
                    { errors: integrityResults },
                    "Recreate backup from original database"
                );
            }
            
            backupDb.close();
        } catch (error) {
            this.addResult(
                "Backup File Integrity",
                "FAIL",
                `Error checking backup integrity: ${error}`,
                { error: String(error) },
                "Backup file may be corrupted - recreate backup"
            );
        }
    }

    private async testDatabaseRestore(): Promise<void> {
        this.logProgress("Database Restore Process");
        
        try {
            const backupExists = await Bun.file(this.backupDbPath).exists();
            if (!backupExists) {
                this.addResult(
                    "Database Restore Process",
                    "FAIL",
                    "Cannot test restore - backup file does not exist",
                    { backupPath: this.backupDbPath }
                );
                return;
            }
            
            // Copy backup to test restore location
            const startTime = Date.now();
            const backupData = await Bun.file(this.backupDbPath).arrayBuffer();
            await Bun.write(this.testDbPath, backupData);
            const restoreTime = Date.now() - startTime;
            
            // Verify restored file exists and is accessible
            const restoredExists = await Bun.file(this.testDbPath).exists();
            if (restoredExists) {
                // Test opening the restored database
                const restoredDb = new Database(this.testDbPath, { readonly: true });
                
                // Simple connectivity test
                const testQuery = restoredDb.prepare("SELECT 1 as test").get() as { test: number };
                
                if (testQuery.test === 1) {
                    this.addResult(
                        "Database Restore Process",
                        "PASS",
                        `Database restore completed successfully in ${restoreTime}ms`,
                        { 
                            restoreTime,
                            restoredPath: this.testDbPath,
                            connectivity: "ok"
                        }
                    );
                } else {
                    this.addResult(
                        "Database Restore Process",
                        "FAIL",
                        "Restored database is not responsive",
                        { testQuery: testQuery },
                        "Check restored database file for corruption"
                    );
                }
                
                restoredDb.close();
            } else {
                this.addResult(
                    "Database Restore Process",
                    "FAIL",
                    "Restore file was not created",
                    { testDbPath: this.testDbPath },
                    "Check disk space and file permissions"
                );
            }
        } catch (error) {
            this.addResult(
                "Database Restore Process",
                "FAIL",
                `Database restore failed: ${error}`,
                { error: String(error) },
                "Check source backup file and target directory permissions"
            );
        }
    }

    private async testRestoredDatabaseIntegrity(): Promise<void> {
        this.logProgress("Restored Database Integrity Check");
        
        try {
            const restoredExists = await Bun.file(this.testDbPath).exists();
            if (!restoredExists) {
                this.addResult(
                    "Restored Database Integrity",
                    "FAIL",
                    "Cannot test integrity - restored database does not exist",
                    { testDbPath: this.testDbPath }
                );
                return;
            }
            
            const restoredDb = new Database(this.testDbPath, { readonly: true });
            
            // Run comprehensive integrity checks
            const integrityResults = restoredDb.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
            const quickCheckResults = restoredDb.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>;
            
            // Test key functionality
            const canQueryIssues = !!restoredDb.prepare("SELECT COUNT(*) as count FROM issues LIMIT 1").get();
            const canQueryComments = !!restoredDb.prepare("SELECT COUNT(*) as count FROM comments LIMIT 1").get();
            const canQueryFTS = !!restoredDb.prepare("SELECT COUNT(*) as count FROM issues_fts WHERE issues_fts MATCH 'test' LIMIT 1").get();
            
            const allChecksPass = 
                integrityResults.length === 1 && integrityResults[0].integrity_check === "ok" &&
                quickCheckResults.length === 1 && quickCheckResults[0].quick_check === "ok" &&
                canQueryIssues && canQueryComments && canQueryFTS;
            
            if (allChecksPass) {
                this.addResult(
                    "Restored Database Integrity",
                    "PASS",
                    "Restored database passed all integrity checks",
                    { 
                        integrityCheck: "ok",
                        quickCheck: "ok",
                        functionalityTests: {
                            issues: canQueryIssues,
                            comments: canQueryComments,
                            fts: canQueryFTS
                        }
                    }
                );
            } else {
                this.addResult(
                    "Restored Database Integrity",
                    "FAIL",
                    "Restored database failed integrity checks",
                    { 
                        integrityResults,
                        quickCheckResults,
                        functionalityTests: {
                            issues: canQueryIssues,
                            comments: canQueryComments,
                            fts: canQueryFTS
                        }
                    },
                    "Restore from a different backup or recreate database"
                );
            }
            
            restoredDb.close();
        } catch (error) {
            this.addResult(
                "Restored Database Integrity",
                "FAIL",
                `Error checking restored database integrity: ${error}`,
                { error: String(error) },
                "Restored database may be corrupted"
            );
        }
    }

    private async testDataConsistency(): Promise<void> {
        this.logProgress("Data Consistency Verification");
        
        try {
            const originalExists = await Bun.file(this.originalDbPath).exists();
            const restoredExists = await Bun.file(this.testDbPath).exists();
            
            if (!originalExists || !restoredExists) {
                this.addResult(
                    "Data Consistency Verification",
                    "FAIL",
                    "Cannot compare databases - one or both files missing",
                    { originalExists, restoredExists }
                );
                return;
            }
            
            const originalDb = new Database(this.originalDbPath, { readonly: true });
            const restoredDb = new Database(this.testDbPath, { readonly: true });
            
            // Compare row counts
            const originalIssues = originalDb.prepare("SELECT COUNT(*) as count FROM issues").get() as { count: number };
            const restoredIssues = restoredDb.prepare("SELECT COUNT(*) as count FROM issues").get() as { count: number };
            
            const originalComments = originalDb.prepare("SELECT COUNT(*) as count FROM comments").get() as { count: number };
            const restoredComments = restoredDb.prepare("SELECT COUNT(*) as count FROM comments").get() as { count: number };
            
            const originalCustomFields = originalDb.prepare("SELECT COUNT(*) as count FROM custom_fields").get() as { count: number };
            const restoredCustomFields = restoredDb.prepare("SELECT COUNT(*) as count FROM custom_fields").get() as { count: number };
            
            // Compare sample data integrity
            const originalSampleIssue = originalDb.prepare("SELECT key, title FROM issues ORDER BY key LIMIT 1").get() as { key: string; title: string };
            const restoredSampleIssue = restoredDb.prepare("SELECT key, title FROM issues ORDER BY key LIMIT 1").get() as { key: string; title: string };
            
            const rowCountsMatch = 
                originalIssues.count === restoredIssues.count &&
                originalComments.count === restoredComments.count &&
                originalCustomFields.count === restoredCustomFields.count;
                
            const sampleDataMatches = 
                originalSampleIssue.key === restoredSampleIssue.key &&
                originalSampleIssue.title === restoredSampleIssue.title;
            
            if (rowCountsMatch && sampleDataMatches) {
                this.addResult(
                    "Data Consistency Verification",
                    "PASS",
                    "Original and restored databases have consistent data",
                    { 
                        rowCounts: {
                            issues: { original: originalIssues.count, restored: restoredIssues.count },
                            comments: { original: originalComments.count, restored: restoredComments.count },
                            customFields: { original: originalCustomFields.count, restored: restoredCustomFields.count }
                        },
                        sampleData: {
                            original: originalSampleIssue,
                            restored: restoredSampleIssue
                        }
                    }
                );
            } else {
                this.addResult(
                    "Data Consistency Verification",
                    "FAIL",
                    "Data inconsistency detected between original and restored databases",
                    { 
                        rowCountsMatch,
                        sampleDataMatches,
                        rowCounts: {
                            issues: { original: originalIssues.count, restored: restoredIssues.count },
                            comments: { original: originalComments.count, restored: restoredComments.count },
                            customFields: { original: originalCustomFields.count, restored: restoredCustomFields.count }
                        }
                    },
                    "Recreate backup to ensure data integrity"
                );
            }
            
            originalDb.close();
            restoredDb.close();
        } catch (error) {
            this.addResult(
                "Data Consistency Verification",
                "FAIL",
                `Error verifying data consistency: ${error}`,
                { error: String(error) },
                "Check database file accessibility and integrity"
            );
        }
    }

    private async cleanupTestFiles(): Promise<void> {
        this.logProgress("Cleanup Test Files");
        
        try {
            let filesRemoved = 0;
            
            // Remove backup file using Bun.$
            if (await Bun.file(this.backupDbPath).exists()) {
                try {
                    await Bun.$`rm -f ${this.backupDbPath}`;
                    filesRemoved++;
                } catch (rmError) {
                    console.warn(`Could not remove backup file: ${rmError}`);
                }
            }
            
            // Remove restored test file using Bun.$
            if (await Bun.file(this.testDbPath).exists()) {
                try {
                    await Bun.$`rm -f ${this.testDbPath}`;
                    filesRemoved++;
                } catch (rmError) {
                    console.warn(`Could not remove test file: ${rmError}`);
                }
            }
            
            this.addResult(
                "Cleanup Test Files",
                "PASS",
                `Successfully cleaned up ${filesRemoved} test files`,
                { filesRemoved }
            );
        } catch (error) {
            this.addResult(
                "Cleanup Test Files",
                "WARNING",
                `Could not clean up all test files: ${error}`,
                { error: String(error) },
                "Manually remove backup and restore test files if needed"
            );
        }
    }

    printResults(): void {
        console.log("\n" + "=".repeat(80));
        console.log("💾 DATABASE BACKUP & RESTORE TEST RESULTS");
        console.log("=".repeat(80));

        const passCounts = { PASS: 0, WARNING: 0, FAIL: 0 };
        
        for (const result of this.results) {
            passCounts[result.status]++;
            
            const statusIcon = {
                'PASS': '✅',
                'WARNING': '⚠️',
                'FAIL': '❌'
            }[result.status];
            
            console.log(`\n${statusIcon} ${result.testName}`);
            console.log(`   ${result.message}`);
            
            if (result.recommendation) {
                console.log(`   💡 Recommendation: ${result.recommendation}`);
            }
            
            if (result.details && typeof result.details === 'object') {
                console.log(`   📋 Details: ${JSON.stringify(result.details, null, 2).replace(/\n/g, '\n   ')}`);
            }
        }

        console.log("\n" + "=".repeat(80));
        console.log("📈 BACKUP/RESTORE TEST SUMMARY");
        console.log("=".repeat(80));
        console.log(`✅ PASSED: ${passCounts.PASS}`);
        console.log(`⚠️  WARNINGS: ${passCounts.WARNING}`);
        console.log(`❌ FAILED: ${passCounts.FAIL}`);
        console.log(`📊 TOTAL TESTS: ${this.results.length}`);
        
        const healthPercentage = Math.round((passCounts.PASS / this.results.length) * 100);
        console.log(`💾 BACKUP/RESTORE HEALTH: ${healthPercentage}%`);
        
        if (passCounts.FAIL === 0 && passCounts.WARNING === 0) {
            console.log("\n🎉 All backup and restore operations working perfectly!");
        } else if (passCounts.FAIL === 0) {
            console.log("\n👍 Backup and restore capabilities are functional with minor issues");
        } else {
            console.log("\n⚠️  Backup and restore operations have significant issues");
        }
        
        console.log("=".repeat(80));
    }
}

async function main(): Promise<void> {
    try {
        const databasePath = await getDatabasePath();
        console.log(`💾 Testing database backup and restore: ${databasePath}\n`);
        
        if (!(await Bun.file(databasePath).exists())) {
            console.error(`❌ Error: Database file '${databasePath}' not found.`);
            console.error("Please run load-initial.ts first to create the database.");
            process.exit(1);
        }
        
        const tester = new DatabaseBackupRestoreTester(databasePath);
        
        const results = await tester.runBackupRestoreTests();
        
        tester.printResults();
        
        // Exit with appropriate code
        const hasFailures = results.some(r => r.status === 'FAIL');
        process.exit(hasFailures ? 1 : 0);
        
    } catch (error) {
        console.error("❌ Fatal error during backup/restore testing:", error);
        process.exit(1);
    }
}

main().catch(console.error);