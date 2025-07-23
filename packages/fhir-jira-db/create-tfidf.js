import { Database } from "bun:sqlite";
import { TFIDFProcessor } from "./tfidf-processor.js";
import { getDatabasePath, setupDatabaseCliArgs } from "@jira-fhir-utils/database-utils";

// Validate configuration parameters
function validateConfig(config) {
  const errors = [];
  
  if (config.batchSize < 1 || config.batchSize > 10000) {
    errors.push("Batch size must be between 1 and 10000");
  }
  
  if (config.topKeywords < 1 || config.topKeywords > 100) {
    errors.push("Top keywords must be between 1 and 100");
  }
  
  if (config.minDocFreq < 1 || config.minDocFreq > 1000) {
    errors.push("Min document frequency must be between 1 and 1000");
  }
  
  if (config.maxDocFreq <= 0 || config.maxDocFreq > 1) {
    errors.push("Max document frequency must be between 0 and 1");
  }
  
  if (config.minTermLength < 1 || config.minTermLength > 50) {
    errors.push("Min term length must be between 1 and 50");
  }
  
  if (config.maxTermLength < config.minTermLength || config.maxTermLength > 100) {
    errors.push("Max term length must be between min term length and 100");
  }
  
  if (config.maxDocFreq < config.minDocFreq / 10000) {
    errors.push("Max document frequency ratio is too low compared to min document frequency");
  }
  
  return errors;
}

// Parse command-line arguments
function parseArguments() {
  const args = process.argv.slice(2);
  const config = {
    batchSize: 5000,
    topKeywords: 10,
    dbPath: '',
    minDocFreq: 2,
    maxDocFreq: 0.7,
    minTermLength: 2,
    maxTermLength: 30,
    showHelp: false
  };
  
  try {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];
      
      switch (arg) {
        case '--batch-size':
          if (nextArg && !isNaN(nextArg)) {
            config.batchSize = parseInt(nextArg);
            i++;
          } else {
            throw new Error("Invalid batch size value");
          }
          break;
        case '--top-keywords':
          if (nextArg && !isNaN(nextArg)) {
            config.topKeywords = parseInt(nextArg);
            i++;
          } else {
            throw new Error("Invalid top keywords value");
          }
          break;
        case '--db-path':
          if (nextArg) {
            config.dbPath = nextArg;
            i++;
          } else {
            throw new Error("Database path is required");
          }
          break;
        case '--min-doc-freq':
          if (nextArg && !isNaN(nextArg)) {
            config.minDocFreq = parseInt(nextArg);
            i++;
          } else {
            throw new Error("Invalid min document frequency value");
          }
          break;
        case '--max-doc-freq':
          if (nextArg && !isNaN(nextArg)) {
            config.maxDocFreq = parseFloat(nextArg);
            i++;
          } else {
            throw new Error("Invalid max document frequency value");
          }
          break;
        case '--min-term-length':
          if (nextArg && !isNaN(nextArg)) {
            config.minTermLength = parseInt(nextArg);
            i++;
          } else {
            throw new Error("Invalid min term length value");
          }
          break;
        case '--max-term-length':
          if (nextArg && !isNaN(nextArg)) {
            config.maxTermLength = parseInt(nextArg);
            i++;
          } else {
            throw new Error("Invalid max term length value");
          }
          break;
        case '--help':
        case '-h':
          config.showHelp = true;
          break;
        default:
          if (arg.startsWith('--')) {
            throw new Error(`Unknown option: ${arg}`);
          }
          break;
      }
    }
    
    // Validate configuration
    const validationErrors = validateConfig(config);
    if (validationErrors.length > 0) {
      throw new Error(`Configuration validation failed:\n${validationErrors.join('\n')}`);
    }
    
  } catch (error) {
    console.error("Error parsing arguments:", error.message);
    console.error("Use --help to see available options");
    process.exit(1);
  }
  
  return config;
}

// Show help information
function showHelp() {
  console.log(`
TF-IDF Analysis Tool for JIRA Issues

Usage: node create-tfidf.js [options]

Options:
  --batch-size <number>       Number of issues to process in each batch (default: 1000)
  --top-keywords <number>     Number of top keywords to extract per issue (default: 15)
  --db-path <path>           Path to SQLite database file (default: ./jira_issues.sqlite)
  --min-doc-freq <number>     Minimum document frequency for terms (default: 2)
  --max-doc-freq <number>     Maximum document frequency as ratio (default: 0.7)
  --min-term-length <number>  Minimum term length (default: 2)
  --max-term-length <number>  Maximum term length (default: 30)
  --help, -h                 Show this help message

Examples:
  node create-tfidf.js
  node create-tfidf.js --batch-size 500 --top-keywords 20
  node create-tfidf.js --min-doc-freq 3 --max-doc-freq 0.5
  `);
}

// Configuration (will be overridden by command-line arguments)
let CONFIG = {
  batchSize: 1000,
  topKeywords: 15,
  dbPath: "./jira_issues.sqlite",
  minDocFreq: 2,
  maxDocFreq: 0.7,
  minTermLength: 2,
  maxTermLength: 30
};

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
      i.related_url,
      i.related_artifacts,
      i.related_pages,
      GROUP_CONCAT(c.body) as comments
    FROM issues_fts i
    LEFT JOIN comments c ON i.issue_key = c.issue_key
    GROUP BY i.issue_key
    ORDER BY i.issue_key
    LIMIT ? OFFSET ?
  `;
  
  return db.prepare(query).all(limit, offset);
}

// Extract related values from comma-separated fields
function extractRelatedValues(issue) {
  const values = new Set();
  
  // Helper to parse and clean comma-separated values
  const parseField = (field) => {
    if (!field || typeof field !== 'string') return [];
    return field
      .split(',')
      .map(v => v.trim())
      .filter(v => v.length > 0);
  };
  
  // Extract values from each field
  parseField(issue.related_url).forEach(v => values.add(v));
  parseField(issue.related_artifacts).forEach(v => values.add(v));
  parseField(issue.related_pages).forEach(v => values.add(v));
  
  return Array.from(values);
}

// Group issues by shared related values
function groupIssuesByRelatedValues(issues) {
  // Build a map of value -> issues that have that value
  const valueToIssues = new Map();
  const issueToValues = new Map();
  
  // First pass: build the mappings
  issues.forEach(issue => {
    const values = extractRelatedValues(issue);
    issueToValues.set(issue.issue_key, values);
    
    values.forEach(value => {
      if (!valueToIssues.has(value)) {
        valueToIssues.set(value, new Set());
      }
      valueToIssues.get(value).add(issue.issue_key);
    });
  });
  
  // Second pass: build groups using iterative connected components to avoid stack overflow
  const visited = new Set();
  const groups = [];
  
  // Iterative DFS using a stack instead of recursion
  const findConnectedComponent = (startIssueKey) => {
    const currentGroup = new Set();
    const stack = [startIssueKey];
    
    while (stack.length > 0) {
      const issueKey = stack.pop();
      
      if (visited.has(issueKey)) continue;
      
      visited.add(issueKey);
      currentGroup.add(issueKey);
      
      // Get all values for this issue
      const values = issueToValues.get(issueKey) || [];
      
      // For each value, add all connected issues to the stack
      values.forEach(value => {
        const connectedIssues = valueToIssues.get(value) || new Set();
        connectedIssues.forEach(connectedIssue => {
          if (!visited.has(connectedIssue)) {
            stack.push(connectedIssue);
          }
        });
      });
    }
    
    return currentGroup;
  };
  
  // Find all connected components
  issues.forEach(issue => {
    if (!visited.has(issue.issue_key)) {
      const currentGroup = findConnectedComponent(issue.issue_key);
      if (currentGroup.size > 0) {
        groups.push(Array.from(currentGroup));
      }
    }
  });
  
  // Create a map for quick lookup
  const issueKeyToIssue = new Map();
  issues.forEach(issue => {
    issueKeyToIssue.set(issue.issue_key, issue);
  });
  
  // Convert groups of keys back to groups of issues
  return groups.map(group => group.map(key => issueKeyToIssue.get(key)));
}

// Validate database and required tables
function validateDatabase(db) {
  try {
    // Check if issues table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='issues_fts'
    `).get();
    
    if (!tableExists) {
      throw new Error("Issues table not found in database");
    }
    
    // Check if issues table has expected columns
    const columns = db.prepare("PRAGMA table_info(issues_fts)").all();
    const requiredColumns = ['issue_key', 'title', 'description', 'summary', 'resolution_description', 'related_url', 'related_artifacts', 'related_pages'];
    const existingColumns = columns.map(col => col.name);
    
    for (const col of requiredColumns) {
      if (!existingColumns.includes(col)) {
        throw new Error(`Required column '${col}' not found in issues table`);
      }
    }
    
    console.log("Database validation successful");
  } catch (error) {
    throw new Error(`Database validation failed: ${error.message}`);
  }
}

// Count total issues
function countIssues(db) {
  try {
    const result = db.prepare("SELECT COUNT(*) as count FROM issues_fts").get();
    return result.count;
  } catch (error) {
    throw new Error(`Error counting issues: ${error.message}`);
  }
}

// Generator function to stream document batches grouped by related values
function* streamDocumentBatches(db, batchSize = CONFIG.batchSize) {
  const totalIssues = countIssues(db);
  let processedCount = 0;
  let validDocuments = 0;
  const startTime = Date.now();
  
  console.log(`Total issues to process: ${totalIssues}`);
  console.log(`Processing with grouping by related values (target batch size: ${batchSize})...`);
  
  // Load all issues at once for grouping (could be optimized for very large datasets)
  // For very large datasets, we could load in chunks and merge groups
  const allIssues = [];
  let offset = 0;
  const loadChunkSize = 10000; // Load in chunks to avoid memory issues
  
  while (offset < totalIssues) {
    const chunk = loadIssues(db, offset, loadChunkSize);
    if (chunk.length === 0) break;
    allIssues.push(...chunk);
    offset += chunk.length;
    console.log(`Loading issues: ${offset}/${totalIssues} (${(offset/totalIssues*100).toFixed(1)}%)`);
  }
  
  console.log(`Grouping ${allIssues.length} issues by related values...`);
  
  // Group issues by their related values
  const groups = groupIssuesByRelatedValues(allIssues);
  
  // Sort groups by size (largest first) to prioritize processing related documents together
  groups.sort((a, b) => b.length - a.length);
  
  console.log(`Created ${groups.length} groups (sizes: ${groups.slice(0, 5).map(g => g.length).join(', ')}${groups.length > 5 ? '...' : ''})`);
  
  // Process groups
  let currentBatch = [];
  let groupsProcessed = 0;
  
  for (const group of groups) {
    // If adding this group would exceed batch size and we have items, yield current batch
    if (currentBatch.length > 0 && currentBatch.length + group.length > batchSize) {
      // Process and yield the current batch
      const processedBatch = [];
      currentBatch.forEach(issue => {
        const text = [
          issue.title || '',
          issue.description || '',
          issue.summary || '',
          issue.resolution_description || '',
          issue.comments || ''
        ].filter(str => str.trim().length > 0).join(' ');
        
        if (text.trim().length > 0) {
          processedBatch.push({
            key: issue.issue_key,
            title: text,
            description: '',
            summary: '',
            resolution: '',
            original_issue: issue
          });
          validDocuments++;
        }
      });
      
      processedCount += currentBatch.length;
      const progress = (processedCount / totalIssues * 100).toFixed(1);
      console.log(`Processed ${processedCount}/${totalIssues} issues (${progress}%) - Batch size: ${processedBatch.length} - Groups: ${groupsProcessed}`);
      
      if (processedBatch.length > 0) {
        yield processedBatch;
      }
      
      currentBatch = [];
    }
    
    // Handle large groups that exceed batch size
    if (group.length > batchSize) {
      // Split large group into smaller batches
      for (let i = 0; i < group.length; i += batchSize) {
        const subGroup = group.slice(i, Math.min(i + batchSize, group.length));
        const processedBatch = [];
        
        subGroup.forEach(issue => {
          const text = [
            issue.title || '',
            issue.description || '',
            issue.summary || '',
            issue.resolution_description || '',
            issue.comments || ''
          ].filter(str => str.trim().length > 0).join(' ');
          
          if (text.trim().length > 0) {
            processedBatch.push({
              key: issue.issue_key,
              title: text,
              description: '',
              summary: '',
              resolution: '',
              original_issue: issue
            });
            validDocuments++;
          }
        });
        
        processedCount += subGroup.length;
        const progress = (processedCount / totalIssues * 100).toFixed(1);
        console.log(`Processed ${processedCount}/${totalIssues} issues (${progress}%) - Large group batch: ${processedBatch.length}`);
        
        if (processedBatch.length > 0) {
          yield processedBatch;
        }
      }
    } else {
      // Add small group to current batch
      currentBatch.push(...group);
    }
    
    groupsProcessed++;
  }
  
  // Process any remaining items in the last batch
  if (currentBatch.length > 0) {
    const processedBatch = [];
    currentBatch.forEach(issue => {
      const text = [
        issue.title || '',
        issue.description || '',
        issue.summary || '',
        issue.resolution_description || '',
        issue.comments || ''
      ].filter(str => str.trim().length > 0).join(' ');
      
      if (text.trim().length > 0) {
        processedBatch.push({
          key: issue.issue_key,
          title: text,
          description: '',
          summary: '',
          resolution: '',
          original_issue: issue
        });
        validDocuments++;
      }
    });
    
    processedCount += currentBatch.length;
    console.log(`Processed final batch: ${processedCount}/${totalIssues} issues - Batch size: ${processedBatch.length}`);
    
    if (processedBatch.length > 0) {
      yield processedBatch;
    }
  }
  
  const totalTime = Date.now() - startTime;
  console.log(`Document loading complete: ${validDocuments} valid documents from ${totalIssues} issues in ${(totalTime/1000).toFixed(1)}s`);
  console.log(`Processed ${groupsProcessed} groups total`);
}

// Process TF-IDF for all issues using streaming
async function processTFIDF(db, config = CONFIG) {
  const overallStartTime = Date.now();
  
  // Initialize processor with configuration
  console.log("\nInitializing TF-IDF processor with configuration:");
  console.log(`- Batch size: ${config.batchSize}`);
  console.log(`- Min document frequency: ${config.minDocFreq}`);
  console.log(`- Max document frequency: ${(config.maxDocFreq * 100).toFixed(1)}%`);
  console.log(`- Min term length: ${config.minTermLength}`);
  console.log(`- Max term length: ${config.maxTermLength}`);
  console.log(`- Top keywords per issue: ${config.topKeywords}`);
  
  const processor = new TFIDFProcessor({
    minDocumentFrequency: config.minDocFreq,
    maxDocumentFrequency: config.maxDocFreq,
    minTermLength: config.minTermLength,
    maxTermLength: config.maxTermLength
  });
  
  // Build the corpus using streaming
  console.log("\nBuilding TF-IDF corpus with streaming processing...");
  const corpusStartTime = Date.now();
  const documentBatches = streamDocumentBatches(db, config.batchSize);
  processor.buildCorpusStreaming(documentBatches, config.batchSize);
  const corpusTime = Date.now() - corpusStartTime;
  
  console.log(`Corpus built successfully in ${(corpusTime/1000).toFixed(1)}s`);
  
  // Extract keywords for all documents
  console.log(`\nExtracting top ${config.topKeywords} keywords per issue...`);
  const keywordStartTime = Date.now();
  const keywordsData = processor.exportKeywordsForDB(config.topKeywords);
  const corpusStats = processor.exportCorpusStatsForDB();
  const keywordTime = Date.now() - keywordStartTime;
  
  console.log(`Keywords extracted in ${(keywordTime/1000).toFixed(1)}s`);
  
  // Store results in database
  console.log("\nStoring TF-IDF results in database...");
  const dbStartTime = Date.now();
  
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
    // Insert keywords with progress tracking
    console.log(`Inserting ${keywordsData.length} keyword records...`);
    for (let i = 0; i < keywordsData.length; i++) {
      const keyword = keywordsData[i];
      insertKeyword.run(
        keyword.issue_key,
        keyword.keyword,
        keyword.tfidf_score,
        keyword.tf_score,
        keyword.idf_score
      );
      
      // Progress update every 10000 records
      if (i > 0 && i % 10000 === 0) {
        console.log(`Inserted ${i}/${keywordsData.length} keyword records (${(i/keywordsData.length*100).toFixed(1)}%)`);
      }
    }
    
    // Insert corpus statistics
    console.log(`Inserting ${corpusStats.length} corpus statistics...`);
    for (const stat of corpusStats) {
      insertCorpusStat.run(
        stat.keyword,
        stat.idf_score,
        stat.document_frequency,
        stat.total_documents
      );
    }
  })();
  
  const dbTime = Date.now() - dbStartTime;
  const totalTime = Date.now() - overallStartTime;
  
  console.log(`\nTF-IDF processing complete!`);
  console.log(`- Total keywords extracted: ${keywordsData.length}`);
  console.log(`- Unique terms in corpus: ${corpusStats.length}`);
  console.log(`- Database insertion time: ${(dbTime/1000).toFixed(1)}s`);
  console.log(`- Total processing time: ${(totalTime/1000).toFixed(1)}s`);
  
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
  console.log("Starting TF-IDF keyword extraction...");
  
  let db;
  
  try {
    // Parse command-line arguments
    const config = parseArguments();
    
    // Show help if requested
    if (config.showHelp) {
      showHelp();
      return;
    }
    
    // Update global config
    CONFIG = config;
    
    if (config.dbPath == '') {
      try {
        config.dbPath = getDatabasePath();
      } catch (error) {
        config.dbPath = path.join(process.cwd(), 'jira_issues.sqlite').replace(/\\/g, '/');
      }
    }

    console.log("Starting TF-IDF analysis for JIRA issues...\n");
    console.log(`Using database: ${config.dbPath}`);
    
    // Validate database file exists
    try {
      const fs = await import('fs');
      await fs.promises.access(config.dbPath);
    } catch (error) {
      throw new Error(`Database file not found: ${config.dbPath}`);
    }
    
    // Connect to database
    db = new Database(config.dbPath);
    
    // Validate database structure
    validateDatabase(db);
    
    // Check if there are any issues to process
    const totalIssues = countIssues(db);
    if (totalIssues === 0) {
      console.log("No issues found in database. Nothing to process.");
      return;
    }
    
    console.log(`Found ${totalIssues} issues to process`);
    
    // Create tables
    createTFIDFTables(db);
    
    // Process TF-IDF
    await processTFIDF(db, config);
    
    console.log("\nTF-IDF analysis completed successfully!");
    
  } catch (error) {
    console.error("Error during TF-IDF processing:", error.message);
    if (process.env.NODE_ENV === 'development') {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  } finally {
    if (db) {
      try {
        db.close();
      } catch (error) {
        console.error("Error closing database:", error.message);
      }
    }
  }
}

// Run the script
main();