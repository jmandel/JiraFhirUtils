#!/usr/bin/env bun

/**
 * Database Health Check Runner
 * 
 * This script runs comprehensive database integrity and backup/restore tests
 * to ensure the database is healthy and not contributing to processing issues.
 * 
 * Created as part of Task 4.2: Test database integrity
 */

import { getDatabasePath } from "@jira-fhir-utils/database-utils";

async function main(): Promise<void> {
    console.log("🏥 JIRA FHIR Database Health Check");
    console.log("=".repeat(50));
    console.log("Running comprehensive database integrity and backup/restore tests...\n");
    
    try {
        const databasePath = await getDatabasePath();
        console.log(`📍 Database: ${databasePath}\n`);
        
        if (!(await Bun.file(databasePath).exists())) {
            console.error(`❌ Error: Database file '${databasePath}' not found.`);
            console.error("Please run load-initial.ts first to create the database.");
            process.exit(1);
        }
        
        // Run database integrity tests
        console.log("🔍 Running Database Integrity Tests...");
        console.log("-".repeat(40));
        
        const integrityProcess = Bun.spawn([
            "bun", 
            "packages/fhir-jira-db/test-database-integrity.ts"
        ], {
            stdio: ["inherit", "inherit", "inherit"]
        });
        
        const integrityResult = await integrityProcess.exited;
        
        console.log("\n💾 Running Backup & Restore Tests...");
        console.log("-".repeat(40));
        
        // Run backup and restore tests
        const backupProcess = Bun.spawn([
            "bun", 
            "packages/fhir-jira-db/test-database-backup-restore.ts"
        ], {
            stdio: ["inherit", "inherit", "inherit"]
        });
        
        const backupResult = await backupProcess.exited;
        
        // Summary
        console.log("\n🏥 HEALTH CHECK SUMMARY");
        console.log("=".repeat(50));
        
        if (integrityResult === 0 && backupResult === 0) {
            console.log("✅ All tests PASSED - Database is healthy!");
            console.log("🎉 The database is not contributing to processing issues.");
            console.log("\nRecommendations:");
            console.log("- Consider running ANALYZE to update query statistics");
            console.log("- Database is ready for TF-IDF processing operations");
        } else {
            console.log("⚠️  Some tests FAILED - Database may have issues");
            console.log("📋 Check the detailed test results above for specific problems");
            console.log("\nRecommendations:");
            console.log("- Review failed tests and address issues before processing");
            console.log("- Consider restoring from backup if corruption is detected");
        }
        
        console.log("\n📚 Available Commands:");
        console.log("- bun packages/fhir-jira-db/test-database-integrity.ts");
        console.log("- bun packages/fhir-jira-db/test-database-backup-restore.ts");
        
        process.exit(Math.max(integrityResult, backupResult));
        
    } catch (error) {
        console.error("❌ Fatal error during health check:", error);
        process.exit(1);
    }
}

main().catch(console.error);