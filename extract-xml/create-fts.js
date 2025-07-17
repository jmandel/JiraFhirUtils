#!/usr/bin/env node

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { getDatabasePath, setupDatabaseCliArgs } from "./database-utils.js";

function setupFTS5Tables(db) {
    console.log("Dropping and creating FTS5 tables...");
    
    db.exec(`DROP table IF EXISTS issues_fts`);

    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts USING fts5(
            issue_key,
            issue_int,
            title,
            description,
            summary,
            resolution,
            resolution_description,
            project_key,
            type,
            priority,
            status,
            assignee,
            reporter,
            work_group,
            change_category,
            change_impact,
            related_url,
            related_artifacts,
            related_pages
        )
    `);

    db.exec(`DROP table IF EXISTS comments_fts`);

    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS comments_fts USING fts5(
            comment_id,
            issue_key,
            author,
            body,
            content=comments,
            content_rowid=id
        )
    `);
    
    console.log("FTS5 tables created successfully");
}

function populateIssuesFTS(db) {
    console.log("Populating issues_fts table...");
    
    const startTime = Date.now();
    
    db.exec("BEGIN TRANSACTION");
    
    try {
        db.exec(`
            INSERT INTO issues_fts (
                issue_key,
                issue_int,
                title,
                description,
                summary,
                resolution,
                resolution_description,
                project_key,
                type,
                priority,
                status,
                assignee,
                reporter,
                work_group,
                change_category,
                change_impact,
                related_url,
                related_artifacts,
                related_pages
            )
            SELECT 
                i.key,
                CAST(SUBSTR(i.key, INSTR(i.key, '-') + 1) AS INTEGER),
                i.title,
                i.description,
                i.summary,
                i.resolution,
                COALESCE(rd.field_value, '') as resolution_description,
                i.project_key,
                i.type,
                i.priority,
                i.status,
                i.assignee,
                i.reporter,
                COALESCE(trim(REPLACE(REPLACE(REPLACE(wg.field_value, CHAR(10), ''), CHAR(13), ''), '&amp;', '&')), '') as work_group,
                COALESCE(cc.field_value, '') as change_category,
                COALESCE(ci.field_value, '') as change_impact,
                COALESCE(ru.field_value, '') as related_url,
                COALESCE(trim(REPLACE(REPLACE(REPLACE(ra.field_value, CHAR(10), ''), CHAR(13), ''), '&amp;', '&')), '') as related_artifacts,
                COALESCE(trim(REPLACE(REPLACE(REPLACE(rp.field_value, CHAR(10), ''), CHAR(13), ''), '&amp;', '&')), '') as related_pages
            FROM issues i
            LEFT JOIN custom_fields rd ON rd.issue_key = i.key 
                AND rd.field_name = 'Resolution Description'
            LEFT JOIN custom_fields wg on wg.issue_key = i.key
                AND wg.field_name = 'Work Group'
            LEFT JOIN custom_fields cc ON cc.issue_key = i.key
                AND cc.field_name = 'Change Category'
            LEFT JOIN custom_fields ci ON ci.issue_key = i.key 
                AND ci.field_name = 'Change Impact'
            LEFT JOIN custom_fields ru ON ru.issue_key = i.key
                AND ru.field_name = 'Related URL'
            LEFT JOIN custom_fields ra ON ra.issue_key = i.key
                AND ra.field_name = 'Related Artifact(s)'
            LEFT JOIN custom_fields rp ON rp.issue_key = i.key
                AND rp.field_name = 'Related Page(s)'
        `);
        
        db.exec("COMMIT");
        
        const count = db.prepare("SELECT COUNT(*) as count FROM issues_fts").get().count;
        const elapsed = Date.now() - startTime;
        console.log(`✓ Populated issues_fts with ${count} entries in ${elapsed}ms`);
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

function populateCommentsFTS(db) {
    console.log("Populating comments_fts table...");
    
    const startTime = Date.now();
    
    db.exec("BEGIN TRANSACTION");
    
    try {
        db.exec(`
            INSERT INTO comments_fts (
                comment_id,
                issue_key,
                author,
                body
            )
            SELECT 
                comment_id,
                issue_key,
                author,
                body
            FROM comments
        `);
        
        db.exec("COMMIT");
        
        const count = db.prepare("SELECT COUNT(*) as count FROM comments_fts").get().count;
        const elapsed = Date.now() - startTime;
        console.log(`✓ Populated comments_fts with ${count} entries in ${elapsed}ms`);
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

async function main() {
    console.log("Creating FTS5 tables for JIRA issues...\n");
    
    // Setup CLI arguments
    const options = setupDatabaseCliArgs('create-fts', 'Create FTS5 search tables for JIRA issues');
    
    const databasePath = getDatabasePath();
    console.log(`Using database: ${databasePath}`);
    
    if (!existsSync(databasePath)) {
        console.error(`Error: Database file '${databasePath}' not found.`);
        console.error("Please run load-initial.js first to create the database.");
        process.exit(1);
    }
    
    const db = new Database(databasePath);
    
    try {
        db.exec("PRAGMA journal_mode = WAL;");
        
        setupFTS5Tables(db);
        
        populateIssuesFTS(db);
        
        populateCommentsFTS(db);
        
        console.log("\n✓ FTS5 setup completed successfully!");
        console.log("\nExample queries you can now run:");
        console.log("- Search issues: SELECT * FROM issues_fts WHERE issues_fts MATCH 'search term'");
        console.log("- Search comments: SELECT * FROM comments_fts WHERE comments_fts MATCH 'search term'");
        console.log("- Phrase search: SELECT * FROM issues_fts WHERE issues_fts MATCH '\"exact phrase\"'");
        console.log("- Field-specific: SELECT * FROM issues_fts WHERE title MATCH 'search term'");
        
    } catch (error) {
        console.error("Error setting up FTS5:", error);
        process.exit(1);
    } finally {
        db.close();
    }
}

main().catch(console.error);