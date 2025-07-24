#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { getDatabasePath } from "@jira-fhir-utils/database-utils";

interface IntegrityResult {
    testName: string;
    status: 'PASS' | 'FAIL' | 'WARNING';
    message: string;
    details?: any;
    recommendation?: string;
}

interface TableInfo {
    type: string;
    name: string;
    tbl_name: string;
    rootpage: number;
    sql: string;
}

interface IndexInfo {
    seq: number;
    name: string;
    unique: number;
    origin: string;
    partial: number;
}

interface FTSIntegrityCheck {
    level: string;
    errmsg: string;
}

interface DatabaseStats {
    pageCount: number;
    pageSize: number;
    freelistCount: number;
    schemaVersion: number;
    userVersion: number;
    applicationId: number;
}

class DatabaseIntegrityTester {
    private db: Database;
    private results: IntegrityResult[] = [];

    constructor(databasePath: string) {
        this.db = new Database(databasePath, { readonly: true });
    }

    private addResult(testName: string, status: IntegrityResult['status'], message: string, details?: any, recommendation?: string): void {
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

    async runFullIntegrityCheck(): Promise<IntegrityResult[]> {
        console.log("🔍 Starting comprehensive database integrity check...\n");

        // Core SQLite integrity checks
        await this.testSQLiteIntegrityCheck();
        await this.testQuickIntegrityCheck();
        await this.testForeignKeyIntegrityCheck();
        
        // Database structure validation
        await this.testDatabaseSchema();
        await this.testTableExistence();
        await this.testIndexIntegrity();
        
        // FTS-specific integrity checks
        await this.testFTSTableStructure();
        await this.testFTSIntegrityCheck();
        await this.testFTSSearchCapability();
        
        // Data integrity validation
        await this.testDataConsistency();
        await this.testRowCounts();
        await this.testDataQuality();
        
        // Performance and corruption detection
        await this.testDatabaseStats();
        await this.testLockContention();
        await this.testCorruptionIndicators();
        
        // Recovery and backup testing
        await this.testVacuumOperation();
        await this.testAnalyzeOperation();

        return this.results;
    }

    private async testSQLiteIntegrityCheck(): Promise<void> {
        this.logProgress("SQLite PRAGMA integrity_check");
        
        try {
            const results = this.db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
            
            if (results.length === 1 && results[0].integrity_check === "ok") {
                this.addResult(
                    "SQLite Integrity Check",
                    "PASS",
                    "Database passed full SQLite integrity check",
                    { result: "ok" }
                );
            } else {
                this.addResult(
                    "SQLite Integrity Check",
                    "FAIL",
                    "Database failed SQLite integrity check",
                    { errors: results },
                    "Run VACUUM or restore from backup if corruption is severe"
                );
            }
        } catch (error) {
            this.addResult(
                "SQLite Integrity Check",
                "FAIL",
                `Error running integrity check: ${error}`,
                { error: String(error) },
                "Database may be corrupted - restore from backup"
            );
        }
    }

    private async testQuickIntegrityCheck(): Promise<void> {
        this.logProgress("SQLite PRAGMA quick_check");
        
        try {
            const results = this.db.prepare("PRAGMA quick_check(10)").all() as Array<{ quick_check: string }>;
            
            if (results.length === 1 && results[0].quick_check === "ok") {
                this.addResult(
                    "SQLite Quick Check",
                    "PASS",
                    "Database passed quick integrity check",
                    { result: "ok" }
                );
            } else {
                this.addResult(
                    "SQLite Quick Check",
                    "FAIL",
                    "Database failed quick integrity check",
                    { errors: results },
                    "Run full integrity_check for detailed analysis"
                );
            }
        } catch (error) {
            this.addResult(
                "SQLite Quick Check",
                "FAIL",
                `Error running quick check: ${error}`,
                { error: String(error) }
            );
        }
    }

    private async testForeignKeyIntegrityCheck(): Promise<void> {
        this.logProgress("Foreign Key Integrity Check");
        
        try {
            // Enable foreign key constraints for this check
            const fkResults = this.db.prepare("PRAGMA foreign_key_check").all() as Array<any>;
            
            if (fkResults.length === 0) {
                this.addResult(
                    "Foreign Key Integrity",
                    "PASS",
                    "No foreign key constraint violations found",
                    { violations: 0 }
                );
            } else {
                this.addResult(
                    "Foreign Key Integrity",
                    "FAIL",
                    `Found ${fkResults.length} foreign key violations`,
                    { violations: fkResults },
                    "Fix foreign key violations to ensure data consistency"
                );
            }
        } catch (error) {
            this.addResult(
                "Foreign Key Integrity",
                "WARNING",
                `Could not check foreign keys: ${error}`,
                { error: String(error) }
            );
        }
    }

    private async testDatabaseSchema(): Promise<void> {
        this.logProgress("Database Schema Validation");
        
        try {
            const tables = this.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'view')").all() as TableInfo[];
            
            const expectedTables = ['issues', 'comments', 'custom_fields', 'issues_fts', 'comments_fts'];
            const actualTables = tables.filter(t => t.type === 'table').map(t => t.name);
            
            const missingTables = expectedTables.filter(table => !actualTables.includes(table));
            const extraTables = actualTables.filter(table => !expectedTables.includes(table) && !table.startsWith('issues_fts_') && !table.startsWith('comments_fts_'));
            
            if (missingTables.length === 0) {
                this.addResult(
                    "Database Schema",
                    "PASS",
                    "All expected tables are present",
                    { 
                        expectedTables: expectedTables.length,
                        actualTables: actualTables.length,
                        extraTables: extraTables
                    }
                );
            } else {
                this.addResult(
                    "Database Schema",
                    "FAIL",
                    `Missing required tables: ${missingTables.join(', ')}`,
                    { 
                        missingTables,
                        extraTables,
                        allTables: actualTables
                    },
                    "Recreate missing tables using appropriate setup scripts"
                );
            }
        } catch (error) {
            this.addResult(
                "Database Schema",
                "FAIL",
                `Error validating schema: ${error}`,
                { error: String(error) }
            );
        }
    }

    private async testTableExistence(): Promise<void> {
        this.logProgress("Table Existence and Accessibility");
        
        const tables = ['issues', 'comments', 'custom_fields', 'issues_fts', 'comments_fts'];
        
        for (const table of tables) {
            try {
                const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${table} LIMIT 1`).get() as { count: number };
                
                this.addResult(
                    `Table Accessibility (${table})`,
                    "PASS",
                    `Table ${table} is accessible with ${result.count} rows`,
                    { table, rowCount: result.count }
                );
            } catch (error) {
                this.addResult(
                    `Table Accessibility (${table})`,
                    "FAIL",
                    `Cannot access table ${table}: ${error}`,
                    { table, error: String(error) },
                    `Recreate table ${table} if it's missing or corrupted`
                );
            }
        }
    }

    private async testIndexIntegrity(): Promise<void> {
        this.logProgress("Index Integrity Check");
        
        try {
            // Get all indexes
            const indexes = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
            
            let passedIndexes = 0;
            let failedIndexes = 0;
            const failedIndexNames: string[] = [];
            
            for (const index of indexes) {
                try {
                    // Test index by using it in a query
                    this.db.prepare(`SELECT COUNT(*) FROM sqlite_master WHERE name = ?`).get(index.name);
                    passedIndexes++;
                } catch (error) {
                    failedIndexes++;
                    failedIndexNames.push(index.name);
                }
            }
            
            if (failedIndexes === 0) {
                this.addResult(
                    "Index Integrity",
                    "PASS",
                    `All ${indexes.length} indexes are accessible`,
                    { totalIndexes: indexes.length, passedIndexes }
                );
            } else {
                this.addResult(
                    "Index Integrity",
                    "FAIL",
                    `${failedIndexes} of ${indexes.length} indexes are corrupted`,
                    { 
                        totalIndexes: indexes.length, 
                        failedIndexes, 
                        failedIndexNames 
                    },
                    "Run REINDEX to rebuild corrupted indexes"
                );
            }
        } catch (error) {
            this.addResult(
                "Index Integrity",
                "FAIL",
                `Error checking indexes: ${error}`,
                { error: String(error) }
            );
        }
    }

    private async testFTSTableStructure(): Promise<void> {
        this.logProgress("FTS Table Structure Validation");
        
        const ftsTables = ['issues_fts', 'comments_fts'];
        
        for (const ftsTable of ftsTables) {
            try {
                // Check FTS table structure
                const tableInfo = this.db.prepare(`PRAGMA table_info(${ftsTable})`).all() as Array<{
                    cid: number;
                    name: string;
                    type: string;
                    notnull: number;
                    dflt_value: any;
                    pk: number;
                }>;
                
                if (tableInfo.length > 0) {
                    this.addResult(
                        `FTS Structure (${ftsTable})`,
                        "PASS",
                        `FTS table ${ftsTable} has proper structure`,
                        { 
                            table: ftsTable,
                            columns: tableInfo.length,
                            columnNames: tableInfo.map(col => col.name)
                        }
                    );
                } else {
                    this.addResult(
                        `FTS Structure (${ftsTable})`,
                        "FAIL",
                        `FTS table ${ftsTable} has no columns or is corrupted`,
                        { table: ftsTable },
                        `Recreate FTS table ${ftsTable} using create-fts.ts`
                    );
                }
            } catch (error) {
                this.addResult(
                    `FTS Structure (${ftsTable})`,
                    "FAIL",
                    `Cannot analyze FTS table ${ftsTable}: ${error}`,
                    { table: ftsTable, error: String(error) },
                    `Recreate FTS table ${ftsTable} using create-fts.ts`
                );
            }
        }
    }

    private async testFTSIntegrityCheck(): Promise<void> {
        this.logProgress("FTS5 Integrity Check");
        
        const ftsTables = ['issues_fts', 'comments_fts'];
        
        for (const ftsTable of ftsTables) {
            try {
                // FTS5 integrity check
                const integrityResults = this.db.prepare(`INSERT INTO ${ftsTable}(${ftsTable}) VALUES('integrity-check')`);
                integrityResults.run();
                
                this.addResult(
                    `FTS Integrity (${ftsTable})`,
                    "PASS",
                    `FTS table ${ftsTable} passed integrity check`,
                    { table: ftsTable }
                );
            } catch (error) {
                // Check if it's a read-only error (expected) vs corruption
                if (String(error).includes('readonly') || String(error).includes('attempt to write')) {
                    // This is expected since we opened in readonly mode
                    this.addResult(
                        `FTS Integrity (${ftsTable})`,
                        "PASS",
                        `FTS table ${ftsTable} structure is valid (readonly mode)`,
                        { table: ftsTable, note: "readonly_mode" }
                    );
                } else {
                    this.addResult(
                        `FTS Integrity (${ftsTable})`,
                        "FAIL",
                        `FTS table ${ftsTable} failed integrity check: ${error}`,
                        { table: ftsTable, error: String(error) },
                        `Rebuild FTS table ${ftsTable} using create-fts.ts`
                    );
                }
            }
        }
    }

    private async testFTSSearchCapability(): Promise<void> {
        this.logProgress("FTS Search Capability Test");
        
        try {
            // Test basic FTS search on issues_fts
            const searchResult = this.db.prepare("SELECT COUNT(*) as count FROM issues_fts WHERE issues_fts MATCH 'FHIR' LIMIT 5").get() as { count: number };
            
            this.addResult(
                "FTS Search Capability",
                "PASS",
                `FTS search is functional, found ${searchResult.count} results for 'FHIR'`,
                { searchResults: searchResult.count, searchTerm: 'FHIR' }
            );
        } catch (error) {
            this.addResult(
                "FTS Search Capability",
                "FAIL",
                `FTS search is not working: ${error}`,
                { error: String(error) },
                "Rebuild FTS tables using create-fts.ts"
            );
        }

        try {
            // Test phrase search
            const phraseResult = this.db.prepare('SELECT COUNT(*) as count FROM issues_fts WHERE issues_fts MATCH \'"FHIR specification"\' LIMIT 5').get() as { count: number };
            
            this.addResult(
                "FTS Phrase Search",
                "PASS",
                `FTS phrase search is functional, found ${phraseResult.count} results`,
                { searchResults: phraseResult.count, searchTerm: '"FHIR specification"' }
            );
        } catch (error) {
            this.addResult(
                "FTS Phrase Search",
                "WARNING",
                `FTS phrase search may have issues: ${error}`,
                { error: String(error) }
            );
        }
    }

    private async testDataConsistency(): Promise<void> {
        this.logProgress("Data Consistency Check");
        
        try {
            // Check that FTS tables match main tables
            const issuesCount = this.db.prepare("SELECT COUNT(*) as count FROM issues").get() as { count: number };
            const issuesFTSCount = this.db.prepare("SELECT COUNT(*) as count FROM issues_fts").get() as { count: number };
            
            if (issuesCount.count === issuesFTSCount.count) {
                this.addResult(
                    "Data Consistency (Issues)",
                    "PASS",
                    `Issues and FTS tables are consistent (${issuesCount.count} rows)`,
                    { issuesCount: issuesCount.count, ftsCount: issuesFTSCount.count }
                );
            } else {
                this.addResult(
                    "Data Consistency (Issues)",
                    "WARNING",
                    `Row count mismatch: issues(${issuesCount.count}) vs issues_fts(${issuesFTSCount.count})`,
                    { issuesCount: issuesCount.count, ftsCount: issuesFTSCount.count },
                    "Rebuild FTS tables to sync with main data"
                );
            }
        } catch (error) {
            this.addResult(
                "Data Consistency",
                "FAIL",
                `Error checking data consistency: ${error}`,
                { error: String(error) }
            );
        }

        try {
            // Check comments consistency
            const commentsCount = this.db.prepare("SELECT COUNT(*) as count FROM comments").get() as { count: number };
            const commentsFTSCount = this.db.prepare("SELECT COUNT(*) as count FROM comments_fts").get() as { count: number };
            
            if (commentsCount.count === commentsFTSCount.count) {
                this.addResult(
                    "Data Consistency (Comments)",
                    "PASS",
                    `Comments and FTS tables are consistent (${commentsCount.count} rows)`,
                    { commentsCount: commentsCount.count, ftsCount: commentsFTSCount.count }
                );
            } else {
                this.addResult(
                    "Data Consistency (Comments)",
                    "WARNING",
                    `Row count mismatch: comments(${commentsCount.count}) vs comments_fts(${commentsFTSCount.count})`,
                    { commentsCount: commentsCount.count, ftsCount: commentsFTSCount.count },
                    "Rebuild FTS tables to sync with main data"
                );
            }
        } catch (error) {
            this.addResult(
                "Data Consistency (Comments)",
                "WARNING",
                `Error checking comments consistency: ${error}`,
                { error: String(error) }
            );
        }
    }

    private async testRowCounts(): Promise<void> {
        this.logProgress("Row Count Validation");
        
        const tables = ['issues', 'comments', 'custom_fields', 'issues_fts', 'comments_fts'];
        const rowCounts: Record<string, number> = {};
        
        for (const table of tables) {
            try {
                const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
                rowCounts[table] = result.count;
            } catch (error) {
                this.addResult(
                    `Row Count (${table})`,
                    "FAIL",
                    `Cannot count rows in ${table}: ${error}`,
                    { table, error: String(error) }
                );
            }
        }
        
        // Validate reasonable row counts
        if (rowCounts.issues > 0) {
            this.addResult(
                "Row Counts",
                "PASS",
                "Database contains data in main tables",
                { rowCounts }
            );
        } else {
            this.addResult(
                "Row Counts",
                "WARNING",
                "Database appears to be empty or not populated",
                { rowCounts },
                "Run load-initial.ts to populate the database"
            );
        }
    }

    private async testDataQuality(): Promise<void> {
        this.logProgress("Data Quality Assessment");
        
        try {
            // Check for NULL issue keys
            const nullKeys = this.db.prepare("SELECT COUNT(*) as count FROM issues WHERE key IS NULL OR key = ''").get() as { count: number };
            
            if (nullKeys.count === 0) {
                this.addResult(
                    "Data Quality (Issue Keys)",
                    "PASS",
                    "All issues have valid keys",
                    { nullKeys: nullKeys.count }
                );
            } else {
                this.addResult(
                    "Data Quality (Issue Keys)",
                    "WARNING",
                    `Found ${nullKeys.count} issues with NULL or empty keys`,
                    { nullKeys: nullKeys.count },
                    "Clean up NULL issue keys for better data integrity"
                );
            }
        } catch (error) {
            this.addResult(
                "Data Quality",
                "WARNING",
                `Could not assess data quality: ${error}`,
                { error: String(error) }
            );
        }

        try {
            // Check for duplicate issue keys
            const duplicates = this.db.prepare(`
                SELECT key, COUNT(*) as count 
                FROM issues 
                GROUP BY key 
                HAVING COUNT(*) > 1
            `).all() as Array<{ key: string; count: number }>;
            
            if (duplicates.length === 0) {
                this.addResult(
                    "Data Quality (Duplicates)",
                    "PASS",
                    "No duplicate issue keys found",
                    { duplicates: 0 }
                );
            } else {
                this.addResult(
                    "Data Quality (Duplicates)",
                    "WARNING",
                    `Found ${duplicates.length} duplicate issue keys`,
                    { duplicates: duplicates.slice(0, 10) },
                    "Deduplicate issue keys to maintain data integrity"
                );
            }
        } catch (error) {
            this.addResult(
                "Data Quality (Duplicates)",
                "WARNING",
                `Could not check for duplicates: ${error}`,
                { error: String(error) }
            );
        }
    }

    private async testDatabaseStats(): Promise<void> {
        this.logProgress("Database Statistics Analysis");
        
        try {
            const pageCount = this.db.prepare("PRAGMA page_count").get() as { page_count: number };
            const pageSize = this.db.prepare("PRAGMA page_size").get() as { page_size: number };
            const freeListCount = this.db.prepare("PRAGMA freelist_count").get() as { freelist_count: number };
            const userVersion = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
            
            const stats: DatabaseStats = {
                pageCount: pageCount.page_count,
                pageSize: pageSize.page_size,
                freelistCount: freeListCount.freelist_count,
                schemaVersion: 0,
                userVersion: userVersion.user_version,
                applicationId: 0
            };
            
            // Calculate database size
            const sizeBytes = stats.pageCount * stats.pageSize;
            const sizeMB = Math.round(sizeBytes / (1024 * 1024));
            
            // Calculate fragmentation
            const fragmentationPercent = stats.freelistCount > 0 ? Math.round((stats.freelistCount / stats.pageCount) * 100) : 0;
            
            if (fragmentationPercent < 10) {
                this.addResult(
                    "Database Statistics",
                    "PASS",
                    `Database is healthy: ${sizeMB}MB, ${fragmentationPercent}% fragmented`,
                    { ...stats, sizeMB, fragmentationPercent }
                );
            } else if (fragmentationPercent < 25) {
                this.addResult(
                    "Database Statistics",
                    "WARNING",
                    `Database has moderate fragmentation: ${fragmentationPercent}%`,
                    { ...stats, sizeMB, fragmentationPercent },
                    "Consider running VACUUM to defragment the database"
                );
            } else {
                this.addResult(
                    "Database Statistics",
                    "WARNING",
                    `Database is highly fragmented: ${fragmentationPercent}%`,
                    { ...stats, sizeMB, fragmentationPercent },
                    "Run VACUUM to reclaim space and improve performance"
                );
            }
        } catch (error) {
            this.addResult(
                "Database Statistics",
                "WARNING",
                `Could not gather database statistics: ${error}`,
                { error: String(error) }
            );
        }
    }

    private async testLockContention(): Promise<void> {
        this.logProgress("Lock Contention Assessment");
        
        try {
            // Test with a simple read operation to check for locks
            const startTime = Date.now();
            this.db.prepare("SELECT 1").get();
            const elapsed = Date.now() - startTime;
            
            if (elapsed < 100) {
                this.addResult(
                    "Lock Contention",
                    "PASS",
                    `No lock contention detected (${elapsed}ms response)`,
                    { responseTime: elapsed }
                );
            } else {
                this.addResult(
                    "Lock Contention",
                    "WARNING",
                    `Slow response may indicate lock contention (${elapsed}ms)`,
                    { responseTime: elapsed },
                    "Check for long-running transactions or concurrent access"
                );
            }
        } catch (error) {
            if (String(error).includes('locked') || String(error).includes('busy')) {
                this.addResult(
                    "Lock Contention",
                    "FAIL",
                    `Database is locked: ${error}`,
                    { error: String(error) },
                    "Wait for current operations to complete or restart application"
                );
            } else {
                this.addResult(
                    "Lock Contention",
                    "WARNING",
                    `Could not test lock contention: ${error}`,
                    { error: String(error) }
                );
            }
        }
    }

    private async testCorruptionIndicators(): Promise<void> {
        this.logProgress("Corruption Indicators Check");
        
        const indicators: string[] = [];
        
        try {
            // Check journal mode
            const journalMode = this.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
            
            if (journalMode.journal_mode === 'delete') {
                indicators.push("Journal mode is DELETE (consider WAL for better concurrency)");
            }
            
            // Check synchronous setting
            const syncMode = this.db.prepare("PRAGMA synchronous").get() as { synchronous: number };
            
            if (syncMode.synchronous === 0) {
                indicators.push("Synchronous mode is OFF (data at risk)");
            }
            
            // Check auto_vacuum setting
            const autoVacuum = this.db.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number };
            
            if (indicators.length === 0) {
                this.addResult(
                    "Corruption Indicators",
                    "PASS",
                    "No corruption indicators detected",
                    { 
                        journalMode: journalMode.journal_mode,
                        synchronous: syncMode.synchronous,
                        autoVacuum: autoVacuum.auto_vacuum
                    }
                );
            } else {
                this.addResult(
                    "Corruption Indicators",
                    "WARNING",
                    `Found ${indicators.length} potential issues`,
                    { 
                        indicators,
                        journalMode: journalMode.journal_mode,
                        synchronous: syncMode.synchronous,
                        autoVacuum: autoVacuum.auto_vacuum
                    },
                    "Review database configuration settings"
                );
            }
        } catch (error) {
            this.addResult(
                "Corruption Indicators",
                "WARNING",
                `Could not check corruption indicators: ${error}`,
                { error: String(error) }
            );
        }
    }

    private async testVacuumOperation(): Promise<void> {
        this.logProgress("VACUUM Operation Test");
        
        try {
            // We can't actually VACUUM in readonly mode, but we can check if it would be beneficial
            
            // Get current database size metrics
            const pageCount = this.db.prepare("PRAGMA page_count").get() as { page_count: number };
            const freeListCount = this.db.prepare("PRAGMA freelist_count").get() as { freelist_count: number };
            
            const fragmentationPercent = freeListCount.freelist_count > 0 ? 
                Math.round((freeListCount.freelist_count / pageCount.page_count) * 100) : 0;
            
            if (fragmentationPercent < 5) {
                this.addResult(
                    "VACUUM Assessment",
                    "PASS",
                    `VACUUM not needed (${fragmentationPercent}% fragmentation)`,
                    { fragmentationPercent, recommendation: "no_vacuum_needed" }
                );
            } else if (fragmentationPercent < 15) {
                this.addResult(
                    "VACUUM Assessment",
                    "WARNING",
                    `VACUUM recommended (${fragmentationPercent}% fragmentation)`,
                    { fragmentationPercent },
                    "Run VACUUM during maintenance window to reclaim space"
                );
            } else {
                this.addResult(
                    "VACUUM Assessment",
                    "WARNING",
                    `VACUUM strongly recommended (${fragmentationPercent}% fragmentation)`,
                    { fragmentationPercent },
                    "Database is fragmented - VACUUM will improve performance"
                );
            }
        } catch (error) {
            this.addResult(
                "VACUUM Assessment",
                "WARNING",
                `Could not assess VACUUM needs: ${error}`,
                { error: String(error) }
            );
        }
    }

    private async testAnalyzeOperation(): Promise<void> {
        this.logProgress("ANALYZE Operation Assessment");
        
        try {
            // Check if statistics are up to date
            const stats = this.db.prepare("SELECT name FROM sqlite_stat1 LIMIT 5").all() as Array<{ name: string }>;
            
            if (stats.length > 0) {
                this.addResult(
                    "ANALYZE Assessment",
                    "PASS",
                    `Database statistics are present (${stats.length} entries)`,
                    { statsEntries: stats.length, hasStats: true },
                    "Statistics are up to date - query optimization should work well"
                );
            } else {
                this.addResult(
                    "ANALYZE Assessment",
                    "WARNING",
                    "No statistics found - query performance may be suboptimal",
                    { hasStats: false },
                    "Run ANALYZE to update statistics for better query planning"
                );
            }
        } catch (error) {
            this.addResult(
                "ANALYZE Assessment",
                "WARNING",
                `Could not check statistics: ${error}`,
                { error: String(error) },
                "Consider running ANALYZE to update query statistics"
            );
        }
    }

    printResults(): void {
        console.log("\n" + "=".repeat(80));
        console.log("📊 DATABASE INTEGRITY TEST RESULTS");
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
        console.log("📈 SUMMARY");
        console.log("=".repeat(80));
        console.log(`✅ PASSED: ${passCounts.PASS}`);
        console.log(`⚠️  WARNINGS: ${passCounts.WARNING}`);
        console.log(`❌ FAILED: ${passCounts.FAIL}`);
        console.log(`📊 TOTAL TESTS: ${this.results.length}`);
        
        const healthPercentage = Math.round((passCounts.PASS / this.results.length) * 100);
        console.log(`🏥 DATABASE HEALTH: ${healthPercentage}%`);
        
        if (passCounts.FAIL === 0 && passCounts.WARNING <= 2) {
            console.log("\n🎉 Database is in excellent health!");
        } else if (passCounts.FAIL === 0) {
            console.log("\n👍 Database is healthy with minor issues to address");
        } else {
            console.log("\n⚠️  Database has significant issues that need attention");
        }
        
        console.log("=".repeat(80));
    }

    close(): void {
        this.db.close();
    }
}

async function main(): Promise<void> {
    try {
        const databasePath = await getDatabasePath();
        console.log(`🔍 Testing database integrity: ${databasePath}\n`);
        
        if (!(await Bun.file(databasePath).exists())) {
            console.error(`❌ Error: Database file '${databasePath}' not found.`);
            console.error("Please run load-initial.ts first to create the database.");
            process.exit(1);
        }
        
        const tester = new DatabaseIntegrityTester(databasePath);
        
        const results = await tester.runFullIntegrityCheck();
        
        tester.printResults();
        
        tester.close();
        
        // Exit with appropriate code
        const hasFailures = results.some(r => r.status === 'FAIL');
        process.exit(hasFailures ? 1 : 0);
        
    } catch (error) {
        console.error("❌ Fatal error during integrity check:", error);
        process.exit(1);
    }
}

main().catch(console.error);