#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { existsSync } from "fs";

const DB_FILE = "jira_issues.sqlite";

function setupFTS5Tables(db) {
    console.log("Dropping and creating FTS5 tables...");
    
    db.run(`DROP table IF EXISTS issues_fts`);

    db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts USING fts5(
            issue_key,
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
            reporter
        )
    `);

    db.run(`DROP table IF EXISTS comments_fts`);

    db.run(`
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
        db.run(`
            INSERT INTO issues_fts (
                issue_key,
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
                reporter
            )
            SELECT 
                i.key,
                i.title,
                i.description,
                i.summary,
                i.resolution,
                COALESCE(cf.field_value, '') as resolution_description,
                i.project_key,
                i.type,
                i.priority,
                i.status,
                i.assignee,
                i.reporter
            FROM issues i
            LEFT JOIN custom_fields cf ON cf.issue_key = i.key 
                AND cf.field_name = 'Resolution Description'
        `);
        
        db.exec("COMMIT");
        
        const count = db.query("SELECT COUNT(*) as count FROM issues_fts").get().count;
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
        db.run(`
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
        
        const count = db.query("SELECT COUNT(*) as count FROM comments_fts").get().count;
        const elapsed = Date.now() - startTime;
        console.log(`✓ Populated comments_fts with ${count} entries in ${elapsed}ms`);
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

async function main() {
    if (!existsSync(DB_FILE)) {
        console.error(`Error: Database file '${DB_FILE}' not found.`);
        console.error("Please run load-initial.js first to create the database.");
        process.exit(1);
    }
    
    const db = new Database(DB_FILE);
    
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