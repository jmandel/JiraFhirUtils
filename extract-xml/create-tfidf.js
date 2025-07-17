import Database from "better-sqlite3";
import { TFIDFProcessor } from "./tfidf-processor.js";

// Configuration
const BATCH_SIZE = 1000;
const TOP_KEYWORDS_PER_ISSUE = 15;
const DB_PATH = "./jira_issues.sqlite";

// Create database tables for TF-IDF
function createTFIDFTables(db) {
  console.log("Creating TF-IDF tables...");
  
  // Drop existing tables if they exist
  db.exec(`
    DROP TABLE IF EXISTS tfidf_keywords;
    DROP TABLE IF EXISTS tfidf_corpus_stats;
  `);
  
  // Create keywords table
  db.exec(`
    CREATE TABLE tfidf_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key TEXT NOT NULL,
      keyword TEXT NOT NULL,
      tfidf_score REAL NOT NULL,
      tf_score REAL NOT NULL,
      idf_score REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (issue_key) REFERENCES issues(key)
    );
    
    CREATE INDEX idx_tfidf_issue_key ON tfidf_keywords(issue_key);
    CREATE INDEX idx_tfidf_keyword ON tfidf_keywords(keyword);
    CREATE INDEX idx_tfidf_score ON tfidf_keywords(tfidf_score DESC);
  `);
  
  // Create corpus statistics table
  db.exec(`
    CREATE TABLE tfidf_corpus_stats (
      keyword TEXT PRIMARY KEY,
      idf_score REAL NOT NULL,
      document_frequency INTEGER NOT NULL,
      total_documents INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX idx_corpus_idf ON tfidf_corpus_stats(idf_score DESC);
  `);
  
  console.log("TF-IDF tables created successfully.");
}

// Load issues from database
function loadIssues(db, offset = 0, limit = BATCH_SIZE) {
  const query = `
    SELECT 
      i.issue_key,
      i.title,
      i.description,
      i.summary,
      i.resolution_description,
      GROUP_CONCAT(c.body) as comments
    FROM issues_fts i
    LEFT JOIN comments c ON i.issue_key = c.issue_key
    GROUP BY i.issue_key
    ORDER BY i.issue_key
    LIMIT ? OFFSET ?
  `;
  
  return db.prepare(query).all(limit, offset);
}

// Count total issues
function countIssues(db) {
  const result = db.prepare("SELECT COUNT(*) as count FROM issues").get();
  return result.count;
}

// Process TF-IDF for all issues
async function processTFIDF(db, batchSize = BATCH_SIZE, topKeywords = TOP_KEYWORDS_PER_ISSUE) {
  const processor = new TFIDFProcessor();
  const totalIssues = countIssues(db);
  
  console.log(`Total issues to process: ${totalIssues}`);
  console.log(`Processing in batches of ${batchSize}...`);
  
  // Load all issues and build corpus
  let processedCount = 0;
  const allIssues = [];
  
  while (processedCount < totalIssues) {
    const batch = loadIssues(db, processedCount, batchSize);
    
    if (batch.length === 0) break;
    
    // Process each issue in the batch
    batch.forEach(issue => {
      // Combine all text fields with explicit null handling
      const text = [
        issue.title || '',
        issue.description || '',
        issue.summary || '',
        issue.resolution_description || '',
        issue.comments || ''
      ].filter(str => str.trim().length > 0).join(' ');
      
      // Only add issues with actual text content
      if (text.trim().length > 0) {
        allIssues.push({
          key: issue.issue_key,
          text: text
        });
      }
    });
    
    processedCount += batch.length;
    console.log(`Loaded ${processedCount}/${totalIssues} issues...`);
  }
  
  // Build the corpus
  console.log("\nBuilding TF-IDF corpus...");
  processor.buildCorpus(allIssues.map(issue => ({
    key: issue.issue_key,
    title: issue.text // Using combined text
  })));
  
  console.log("Corpus built successfully.");
  
  // Extract keywords for all documents
  console.log(`\nExtracting top ${topKeywords} keywords per issue...`);
  const keywordsData = processor.exportKeywordsForDB(topKeywords);
  const corpusStats = processor.exportCorpusStatsForDB();
  
  // Store results in database
  console.log("\nStoring TF-IDF results in database...");
  
  // Use a transaction for better performance
  const insertKeyword = db.prepare(`
    INSERT INTO tfidf_keywords (issue_key, keyword, tfidf_score, tf_score, idf_score)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const insertCorpusStat = db.prepare(`
    INSERT INTO tfidf_corpus_stats (keyword, idf_score, document_frequency, total_documents)
    VALUES (?, ?, ?, ?)
  `);
  
  db.transaction(() => {
    // Insert keywords
    for (const keyword of keywordsData) {
      insertKeyword.run(
        keyword.issue_key,
        keyword.keyword,
        keyword.tfidf_score,
        keyword.tf_score,
        keyword.idf_score
      );
    }
    
    // Insert corpus statistics
    for (const stat of corpusStats) {
      insertCorpusStat.run(
        stat.keyword,
        stat.idf_score,
        stat.document_frequency,
        stat.total_documents
      );
    }
  })();
  
  console.log(`\nTF-IDF processing complete!`);
  console.log(`- Total keywords extracted: ${keywordsData.length}`);
  console.log(`- Unique terms in corpus: ${corpusStats.length}`);
  
  // Show sample results
  showSampleResults(db);
}

// Show sample results
function showSampleResults(db) {
  console.log("\n=== Sample Results ===");
  
  // Top keywords across all issues
  const topGlobalKeywords = db.prepare(`
    SELECT 
      keyword,
      COUNT(*) as issue_count,
      AVG(tfidf_score) as avg_tfidf,
      MAX(tfidf_score) as max_tfidf
    FROM tfidf_keywords
    GROUP BY keyword
    ORDER BY issue_count DESC
    LIMIT 20
  `).all();
  
  console.log("\nTop 20 most common keywords:");
  topGlobalKeywords.forEach((kw, idx) => {
    console.log(`${idx + 1}. "${kw.keyword}" - appears in ${kw.issue_count} issues (avg TF-IDF: ${kw.avg_tfidf.toFixed(4)})`);
  });
  
  // Sample issue keywords
  const sampleIssue = db.prepare(`
    SELECT issue_key FROM tfidf_keywords 
    GROUP BY issue_key 
    LIMIT 1
  `).get();
  
  if (sampleIssue) {
    const issueKeywords = db.prepare(`
      SELECT keyword, tfidf_score 
      FROM tfidf_keywords 
      WHERE issue_key = ?
      ORDER BY tfidf_score DESC
      LIMIT 10
    `).all(sampleIssue.issue_key);
    
    console.log(`\nTop keywords for issue ${sampleIssue.issue_key}:`);
    issueKeywords.forEach((kw, idx) => {
      console.log(`${idx + 1}. "${kw.keyword}" (TF-IDF: ${kw.tfidf_score.toFixed(4)})`);
    });
  }
}

// Main execution
async function main() {
  console.log("Starting TF-IDF analysis for JIRA issues...\n");
  
  const db = new Database(DB_PATH);
  
  try {
    // Create tables
    createTFIDFTables(db);
    
    // Process TF-IDF
    // await processTFIDF(db, batchSize, topKeywords);
    await processTFIDF(db);
    
  } catch (error) {
    console.error("Error during TF-IDF processing:", error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Run the script
main();