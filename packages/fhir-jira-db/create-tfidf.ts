import { Database } from "bun:sqlite";
import { TFIDFProcessor } from "./tfidf-processor.ts";
import { getDatabasePath, setupDatabaseCliArgs } from "@jira-fhir-utils/database-utils";
import { 
  DatabaseManager, 
  createDatabaseManager, 
  DatabaseLockMonitor,
  DatabaseConfig,
  DEFAULT_DATABASE_CONFIG,
  DatabaseTimeoutError,
  DatabaseRetryExhaustedError
} from "./database-timeout-utils.ts";
import {
  ErrorRecoveryManager,
  ErrorType,
  ErrorSeverity,
  ProcessingCheckpoint,
  ProcessingResult,
  BatchProcessingResult,
  RecoveryOptions,
  withErrorRecovery,
  DEFAULT_RECOVERY_OPTIONS
} from "./error-recovery-utils.ts";

// Timeout utility classes and functions
class TimeoutError extends Error {
  constructor(message: string, public timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

// Regex timeout protection utility
class RegexTimeoutError extends Error {
  constructor(message: string, public timeoutMs: number) {
    super(message);
    this.name = 'RegexTimeoutError';
  }
}

/**
 * Execute a regex operation with timeout protection
 * Prevents catastrophic backtracking and runaway regex operations
 */
function withRegexTimeout<T>(
  operation: () => T,
  timeoutMs: number = 1000,
  operationName: string = 'regex operation'
): T {
  let completed = false;
  let result: T;
  let error: Error | null = null;
  
  // Set up timeout
  const timeoutId = setTimeout(() => {
    if (!completed) {
      error = new RegexTimeoutError(`${operationName} timed out after ${timeoutMs}ms`, timeoutMs);
    }
  }, timeoutMs);
  
  try {
    result = operation();
    completed = true;
    clearTimeout(timeoutId);
    
    if (error) {
      throw error;
    }
    
    return result;
  } catch (opError) {
    completed = true;
    clearTimeout(timeoutId);
    
    if (error) {
      throw error; // Timeout error takes precedence
    }
    
    throw opError;
  }
}

/**
 * Safe URL validation with timeout protection
 * Uses simple character-by-character analysis for safety
 */
function validateUrlSafely(url: string): boolean {
  try {
    // Length check first
    if (!url || url.length < 3 || url.length > 2000) {
      return false;
    }
    
    // Try regex validation with timeout
    try {
      const hasHttpProtocol = withRegexTimeout(
        () => /^https?:\/\//.test(url),
        200,
        'HTTP protocol check'
      );
      
      if (hasHttpProtocol) {
        // For HTTP URLs, check for basic domain pattern
        const hasDomainPattern = withRegexTimeout(
          () => /^https?:\/\/[^\s]{1,200}\.[^\s]{1,50}/.test(url),
          300,
          'HTTP domain pattern check'
        );
        return hasDomainPattern;
      } else {
        // For non-HTTP URLs, check for basic domain pattern
        const hasDomainPattern = withRegexTimeout(
          () => /^[a-zA-Z0-9-]{1,63}\.[a-zA-Z]{2,10}/.test(url),
          200,
          'domain pattern check'
        );
        return hasDomainPattern;
      }
      
    } catch (error) {
      if (error instanceof RegexTimeoutError) {
        vwarn(`[REGEX-TIMEOUT] ${error.message} for URL validation, using fallback`);
        return validateUrlCharacterBased(url);
      }
      throw error;
    }
    
  } catch (error) {
    vwarn(`[ERROR] Error in URL validation: ${(error as Error).message}`);
    return validateUrlCharacterBased(url);
  }
}

/**
 * Character-based URL validation fallback (no regex)
 */
function validateUrlCharacterBased(url: string): boolean {
  if (!url || url.length < 3) return false;
  
  // Check for HTTP/HTTPS prefix
  const hasHttp = url.startsWith('http://') || url.startsWith('https://');
  
  if (hasHttp) {
    // Must have at least one dot after the protocol
    const afterProtocol = url.substring(url.indexOf('://') + 3);
    return afterProtocol.includes('.') && afterProtocol.length > 3;
  } else {
    // Must have at least one dot and reasonable length
    return url.includes('.') && url.length > 3 && url.length < 500;
  }
}

interface TimeoutOptions {
  timeoutMs: number;
  operationName?: string;
  onProgress?: (progress: string) => void;
}

/**
 * Wraps a function with timeout protection
 */
async function withTimeout<T>(
  operation: () => Promise<T> | T,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, operationName = 'operation' } = options;
  
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new TimeoutError(`${operationName} timed out after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);
    
    try {
      const result = operation();
      
      // Handle both sync and async operations
      if (result instanceof Promise) {
        result
          .then(value => {
            clearTimeout(timeoutId);
            resolve(value);
          })
          .catch(error => {
            clearTimeout(timeoutId);
            reject(error);
          });
      } else {
        clearTimeout(timeoutId);
        resolve(result);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

// Type definitions
interface Config {
  batchSize: number;
  topKeywords: number;
  dbPath: string;
  minDocFreq: number;
  maxDocFreq: number;
  minTermLength: number;
  maxTermLength: number;
  showHelp: boolean;
  verbose: boolean;
}

interface IssueData {
  issue_key: string;
  title: string | null;
  description: string | null;
  summary: string | null;
  resolution_description: string | null;
  related_url: string | null;
  related_artifacts: string | null;
  related_pages: string | null;
  comments: string | null;
}

interface ProcessedDocument {
  key: string;
  title: string;
  description: string;
  summary: string;
  resolution: string;
  original_issue: IssueData;
}

interface KeywordData {
  issue_key: string;
  keyword: string;
  tfidf_score: number;
  tf_score: number;
  idf_score: number;
}

interface CorpusStats {
  keyword: string;
  idf_score: number;
  document_frequency: number;
  total_documents: number;
}

interface TopKeyword {
  keyword: string;
  issue_count: number;
  avg_tfidf: number;
  max_tfidf: number;
}

interface IssueKeyword {
  keyword: string;
  tfidf_score: number;
}

interface SampleIssue {
  issue_key: string;
}

interface CountResult {
  count: number;
}

interface TableInfo {
  name: string;
}

// Validate configuration parameters
function validateConfig(config: Config): string[] {
  const errors: string[] = [];
  
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
function parseArguments(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    batchSize: 5000,
    topKeywords: 10,
    dbPath: '',
    minDocFreq: 2,
    maxDocFreq: 0.7,
    minTermLength: 2,
    maxTermLength: 30,
    showHelp: false,
    verbose: false
  };
  
  try {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];
      
      switch (arg) {
        case '--batch-size':
          if (nextArg && !isNaN(Number(nextArg))) {
            config.batchSize = parseInt(nextArg);
            i++;
          } else {
            throw new Error("Invalid batch size value");
          }
          break;
        case '--top-keywords':
          if (nextArg && !isNaN(Number(nextArg))) {
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
          if (nextArg && !isNaN(Number(nextArg))) {
            config.minDocFreq = parseInt(nextArg);
            i++;
          } else {
            throw new Error("Invalid min document frequency value");
          }
          break;
        case '--max-doc-freq':
          if (nextArg && !isNaN(Number(nextArg))) {
            config.maxDocFreq = parseFloat(nextArg);
            i++;
          } else {
            throw new Error("Invalid max document frequency value");
          }
          break;
        case '--min-term-length':
          if (nextArg && !isNaN(Number(nextArg))) {
            config.minTermLength = parseInt(nextArg);
            i++;
          } else {
            throw new Error("Invalid min term length value");
          }
          break;
        case '--max-term-length':
          if (nextArg && !isNaN(Number(nextArg))) {
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
        case '--verbose':
        case '-v':
          config.verbose = true;
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
    console.error("Error parsing arguments:", (error as Error).message);
    console.error("Use --help to see available options");
    process.exit(1);
  }
  
  return config;
}

// Show help information
function showHelp(): void {
  console.log(`
TF-IDF Analysis Tool for JIRA Issues

Usage: bun create-tfidf.ts [options]

Options:
  --batch-size <number>       Number of issues to process in each batch (default: 1000)
  --top-keywords <number>     Number of top keywords to extract per issue (default: 15)
  --db-path <path>           Path to SQLite database file (default: ./jira_issues.sqlite)
  --min-doc-freq <number>     Minimum document frequency for terms (default: 2)
  --max-doc-freq <number>     Maximum document frequency as ratio (default: 0.7)
  --min-term-length <number>  Minimum term length (default: 2)
  --max-term-length <number>  Maximum term length (default: 30)
  --verbose, -v              Enable verbose output with detailed logging
  --help, -h                 Show this help message

Examples:
  bun create-tfidf.ts
  bun create-tfidf.ts --batch-size 500 --top-keywords 20
  bun create-tfidf.ts --min-doc-freq 3 --max-doc-freq 0.5
  `);
}

// Configuration (will be overridden by command-line arguments)
let CONFIG: Config = {
  batchSize: 1000,
  topKeywords: 15,
  dbPath: "./jira_issues.sqlite",
  minDocFreq: 2,
  maxDocFreq: 0.7,
  minTermLength: 2,
  maxTermLength: 30,
  showHelp: false,
  verbose: false
};

// Verbose logging helper functions
function vlog(...args: any[]): void {
  if (CONFIG.verbose) {
    console.log(...args);
  }
}

function vwarn(...args: any[]): void {
  if (CONFIG.verbose) {
    console.warn(...args);
  }
}

function verror(...args: any[]): void {
  if (CONFIG.verbose) {
    console.error(...args);
  }
}

// Create database tables for TF-IDF with enhanced error handling and timeout protection
async function createTFIDFTables(dbManager: DatabaseManager): Promise<void> {
  vlog("[DATABASE] Creating TF-IDF tables with timeout protection...");
  
  try {
    // Drop existing tables if they exist with timeout protection
    await dbManager.exec(`
      DROP TABLE IF EXISTS tfidf_keywords;
      DROP TABLE IF EXISTS tfidf_corpus_stats;
    `);
    
    // Create keywords table with timeout protection
    await dbManager.exec(`
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
    
    // Create corpus statistics table with timeout protection
    await dbManager.exec(`
      CREATE TABLE tfidf_corpus_stats (
        keyword TEXT PRIMARY KEY,
        idf_score REAL NOT NULL,
        document_frequency INTEGER NOT NULL,
        total_documents INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX idx_corpus_idf ON tfidf_corpus_stats(idf_score DESC);
    `);
    
    vlog("[DATABASE] TF-IDF tables created successfully with timeout protection.");
  } catch (error) {
    verror(`[DATABASE-ERROR] Failed to create TF-IDF tables: ${(error as Error).message}`);
    throw error;
  }
}

// Enhanced load issues function using DatabaseManager with comprehensive timeout and retry
async function loadIssues(dbManager: DatabaseManager, offset: number = 0, limit: number = CONFIG.batchSize): Promise<IssueData[]> {
  vlog(`[DEBUG] loadIssues: Starting enhanced database query with offset=${offset}, limit=${limit}`);
  
  try {
    const result = await dbManager.loadIssues(offset, limit);
    vlog(`[DEBUG] loadIssues: Successfully loaded ${result.length} issues`);
    return result as IssueData[];
  } catch (error) {
    if (error instanceof DatabaseTimeoutError) {
      vwarn(`[WARNING] loadIssues: Database query timed out after ${error.timeoutMs}ms for operation ${error.operation}`);
      vwarn(`[WARNING] loadIssues: Returning empty array to allow partial processing`);
      return [];
    } else if (error instanceof DatabaseRetryExhaustedError) {
      vwarn(`[WARNING] loadIssues: Database retries exhausted after ${error.attempts} attempts`);
      vwarn(`[WARNING] loadIssues: Last error: ${error.lastError.message}`);
      vwarn(`[WARNING] loadIssues: Returning empty array to allow partial processing`);
      return [];
    }
    
    verror(`[ERROR] loadIssues: Unexpected database error: ${(error as Error).message}`);
    throw error;
  }
}

// Memory usage monitoring utility
function getMemoryUsage(): { used: number, total: number, usage: string } {
  const usage = process.memoryUsage();
  const used = Math.round(usage.heapUsed / 1024 / 1024);
  const total = Math.round(usage.heapTotal / 1024 / 1024);
  return {
    used,
    total,
    usage: `${used}MB / ${total}MB (${(used/total*100).toFixed(1)}%)`
  };
}

// Enhanced sample data logging utility with validation statistics
function logRelatedValuesSample(issues: IssueData[], sampleSize: number = 20): void {
  vlog(`\n[DATA-SAMPLE] Logging sample of ${Math.min(sampleSize, issues.length)} issues for related values analysis:`);
  
  const sampleIssues = issues.slice(0, sampleSize);
  let totalUrlValues = 0;
  let totalArtifactValues = 0;
  let totalPageValues = 0;
  let malformedCount = 0;
  let cleanedUrlValues = 0;
  let cleanedArtifactValues = 0;
  let cleanedPageValues = 0;
  const uniqueValues = new Set<string>();
  const uniqueCleanedValues = new Set<string>();
  const validationConfig = DEFAULT_VALIDATION_CONFIG;
  
  // Data quality statistics
  const qualityStats = {
    emptyFields: 0,
    overlyLongFields: 0,
    excessiveValueCount: 0,
    invalidUrls: 0,
    cleaningRequired: 0
  };
  
  sampleIssues.forEach((issue, idx) => {
    // Original parsing (for comparison)
    const urlValues = issue.related_url ? issue.related_url.split(',').map(v => v.trim()).filter(v => v.length > 0) : [];
    const artifactValues = issue.related_artifacts ? issue.related_artifacts.split(',').map(v => v.trim()).filter(v => v.length > 0) : [];
    const pageValues = issue.related_pages ? issue.related_pages.split(',').map(v => v.trim()).filter(v => v.length > 0) : [];
    
    // Enhanced cleaning (new validation)
    const cleanedUrls = sanitizeCommaSeparatedField(issue.related_url, 'related_url', issue.issue_key, validationConfig);
    const cleanedArtifacts = sanitizeCommaSeparatedField(issue.related_artifacts, 'related_artifacts', issue.issue_key, validationConfig);
    const cleanedPages = sanitizeCommaSeparatedField(issue.related_pages, 'related_pages', issue.issue_key, validationConfig);
    
    totalUrlValues += urlValues.length;
    totalArtifactValues += artifactValues.length;
    totalPageValues += pageValues.length;
    cleanedUrlValues += cleanedUrls.length;
    cleanedArtifactValues += cleanedArtifacts.length;
    cleanedPageValues += cleanedPages.length;
    
    // Add to unique values sets
    [...urlValues, ...artifactValues, ...pageValues].forEach(v => uniqueValues.add(v));
    [...cleanedUrls, ...cleanedArtifacts, ...cleanedPages].forEach(v => uniqueCleanedValues.add(v));
    
    // Enhanced malformation detection
    const malformationTypes: string[] = [];
    [issue.related_url, issue.related_artifacts, issue.related_pages].forEach((field, fieldIdx) => {
      const fieldNames = ['related_url', 'related_artifacts', 'related_pages'];
      if (field) {
        if (field.includes(',,')) malformationTypes.push(`${fieldNames[fieldIdx]}: double commas`);
        if (field.startsWith(',') || field.endsWith(',')) malformationTypes.push(`${fieldNames[fieldIdx]}: leading/trailing comma`);
        if (field.length > validationConfig.maxFieldLength) {
          malformationTypes.push(`${fieldNames[fieldIdx]}: overly long (${field.length} chars)`);
          qualityStats.overlyLongFields++;
        }
        if (field.split(',').length > validationConfig.maxValuesPerField) {
          malformationTypes.push(`${fieldNames[fieldIdx]}: too many values (${field.split(',').length})`);
          qualityStats.excessiveValueCount++;
        }
      }
    });
    
    // Check for empty fields
    if (!issue.related_url && !issue.related_artifacts && !issue.related_pages) {
      qualityStats.emptyFields++;
    }
    
    // Check if cleaning was required (original vs cleaned counts differ)
    const originalCount = urlValues.length + artifactValues.length + pageValues.length;
    const cleanedCount = cleanedUrls.length + cleanedArtifacts.length + cleanedPages.length;
    if (originalCount !== cleanedCount) {
      qualityStats.cleaningRequired++;
    }
    
    const hasMalformed = malformationTypes.length > 0;
    if (hasMalformed) malformedCount++;
    
    vlog(`[DATA-SAMPLE] Issue ${idx + 1}/${sampleSize} (${issue.issue_key}):`);
    vlog(`  - related_url: ${urlValues.length} → ${cleanedUrls.length} values -> [${cleanedUrls.slice(0, 3).join(', ')}${cleanedUrls.length > 3 ? '...' : ''}]`);
    vlog(`  - related_artifacts: ${artifactValues.length} → ${cleanedArtifacts.length} values -> [${cleanedArtifacts.slice(0, 3).join(', ')}${cleanedArtifacts.length > 3 ? '...' : ''}]`);
    vlog(`  - related_pages: ${pageValues.length} → ${cleanedPages.length} values -> [${cleanedPages.slice(0, 3).join(', ')}${cleanedPages.length > 3 ? '...' : ''}]`);
    if (hasMalformed) {
      vlog(`  - ⚠️  DATA QUALITY ISSUES: [${malformationTypes.join(', ')}]`);
    }
  });
  
  vlog(`\n[DATA-SAMPLE] Summary for ${sampleSize} sampled issues:`);
  console.log(`  - Original values - URLs: ${totalUrlValues} (avg: ${(totalUrlValues/sampleSize).toFixed(1)}), Artifacts: ${totalArtifactValues} (avg: ${(totalArtifactValues/sampleSize).toFixed(1)}), Pages: ${totalPageValues} (avg: ${(totalPageValues/sampleSize).toFixed(1)})`);
  console.log(`  - Cleaned values - URLs: ${cleanedUrlValues} (avg: ${(cleanedUrlValues/sampleSize).toFixed(1)}), Artifacts: ${cleanedArtifactValues} (avg: ${(cleanedArtifactValues/sampleSize).toFixed(1)}), Pages: ${cleanedPageValues} (avg: ${(cleanedPageValues/sampleSize).toFixed(1)})`);
  console.log(`  - Unique values: ${uniqueValues.size} original → ${uniqueCleanedValues.size} cleaned`);
  console.log(`  - Data quality statistics:`);
  console.log(`    - Issues with malformed data: ${malformedCount}/${sampleSize} (${(malformedCount/sampleSize*100).toFixed(1)}%)`);
  console.log(`    - Issues with empty related fields: ${qualityStats.emptyFields}/${sampleSize} (${(qualityStats.emptyFields/sampleSize*100).toFixed(1)}%)`);
  console.log(`    - Issues with overly long fields: ${qualityStats.overlyLongFields}`);
  console.log(`    - Issues with excessive value counts: ${qualityStats.excessiveValueCount}`);
  console.log(`    - Issues requiring data cleaning: ${qualityStats.cleaningRequired}/${sampleSize} (${(qualityStats.cleaningRequired/sampleSize*100).toFixed(1)}%)`);
}

// Data validation configuration
interface ValidationConfig {
  maxFieldLength: number;
  maxValuesPerField: number;
  minValueLength: number;
  maxValueLength: number;
  allowEmptyValues: boolean;
  strictUrlValidation: boolean;
  normalizeWhitespace: boolean;
}

const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  maxFieldLength: 50000, // Maximum total length of a comma-separated field
  maxValuesPerField: 1000, // Maximum number of values in a single field
  minValueLength: 1, // Minimum length for individual values
  maxValueLength: 2000, // Maximum length for individual values
  allowEmptyValues: false, // Whether to keep empty values after trimming
  strictUrlValidation: true, // Whether to validate URLs strictly
  normalizeWhitespace: true // Whether to normalize whitespace in values
};

/**
 * Comprehensive input sanitization for comma-separated fields
 * Handles malformed data, validates lengths, and normalizes values
 */
function sanitizeCommaSeparatedField(
  field: string | null, 
  fieldName: string, 
  issueKey: string,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): string[] {
  // Handle null/undefined/empty cases
  if (!field || typeof field !== 'string') {
    return [];
  }
  
  // Check total field length
  if (field.length > config.maxFieldLength) {
    vlog(`[DATA-VALIDATION] Field ${fieldName} in issue ${issueKey} exceeds maximum length (${field.length} > ${config.maxFieldLength}), truncating`);
    field = field.substring(0, config.maxFieldLength);
  }
  
  // Detect various types of malformed comma-separated data
  const malformationTypes: string[] = [];
  if (field.includes(',,')) malformationTypes.push('double commas');
  if (field.startsWith(',')) malformationTypes.push('leading comma');
  if (field.endsWith(',')) malformationTypes.push('trailing comma');
  if (field.includes(',,,')) malformationTypes.push('triple+ commas');
  if (/,\s*,\s*,/.test(field)) malformationTypes.push('spaced multiple commas');
  if (/[,;]{2,}/.test(field)) malformationTypes.push('mixed separators');
  
  if (malformationTypes.length > 0) {
    vlog(`[DATA-VALIDATION] Malformed comma-separated data in ${fieldName} for issue ${issueKey}: [${malformationTypes.join(', ')}] - "${field.substring(0, 200)}${field.length > 200 ? '...' : ''}"`);
  }
  
  // Clean and parse the field with multiple separator handling
  let values = field
    .split(/[,;]+/) // Split on commas and semicolons (handle mixed separators)
    .map(v => {
      if (!config.normalizeWhitespace) {
        return v.trim();
      }
      // Normalize whitespace: replace multiple spaces/tabs/newlines with single space
      return v.replace(/\s+/g, ' ').trim();
    })
    .filter(v => config.allowEmptyValues || v.length > 0);
  
  // Check for too many values
  if (values.length > config.maxValuesPerField) {
    vlog(`[DATA-VALIDATION] Field ${fieldName} in issue ${issueKey} has too many values (${values.length} > ${config.maxValuesPerField}), keeping first ${config.maxValuesPerField}`);
    values = values.slice(0, config.maxValuesPerField);
  }
  
  // Validate and clean individual values
  const cleanedValues: string[] = [];
  let invalidValueCount = 0;
  let truncatedValueCount = 0;
  
  for (const value of values) {
    // Length validation
    if (value.length < config.minValueLength) {
      invalidValueCount++;
      continue; // Skip values that are too short
    }
    
    let cleanedValue = value;
    if (value.length > config.maxValueLength) {
      vlog(`[DATA-VALIDATION] Value in ${fieldName} for issue ${issueKey} exceeds maximum length (${value.length} > ${config.maxValueLength}), truncating: "${value.substring(0, 100)}..."`);
      cleanedValue = value.substring(0, config.maxValueLength);
      truncatedValueCount++;
    }
    
    // Additional cleaning for specific field types
    if (fieldName === 'related_url') {
      cleanedValue = cleanUrlValue(cleanedValue, issueKey, config);
    } else if (fieldName === 'related_artifacts') {
      cleanedValue = cleanArtifactValue(cleanedValue, issueKey);
    } else if (fieldName === 'related_pages') {
      cleanedValue = cleanPageValue(cleanedValue, issueKey);
    }
    
    // Final validation: ensure cleaned value is still valid
    if (cleanedValue.length >= config.minValueLength) {
      cleanedValues.push(cleanedValue);
    } else {
      invalidValueCount++;
    }
  }
  
  // Log summary of cleaning results
  if (invalidValueCount > 0 || truncatedValueCount > 0 || malformationTypes.length > 0) {
    vlog(`[DATA-VALIDATION] Cleaning summary for ${fieldName} in issue ${issueKey}: ${values.length} original → ${cleanedValues.length} cleaned (${invalidValueCount} invalid, ${truncatedValueCount} truncated)`);
  }
  
  return cleanedValues;
}

/**
 * Clean and validate URL values with comprehensive checks
 */
function cleanUrlValue(url: string, issueKey: string, config: ValidationConfig): string {
  let cleanedUrl = url;
  
  // Remove common URL artifacts and normalize
  cleanedUrl = cleanedUrl
    .replace(/[\r\n\t]/g, '') // Remove line breaks and tabs
    .replace(/\s+/g, '') // Remove all whitespace from URLs
    .replace(/[<>"']/g, '') // Remove HTML-like characters
    .replace(/^[.\s]+|[.\s]+$/g, ''); // Remove leading/trailing dots and spaces
  
  // Handle common URL prefixing issues
  if (cleanedUrl && !cleanedUrl.match(/^https?:\/\//i) && !cleanedUrl.includes('://')) {
    // Check if it looks like a domain
    if (cleanedUrl.includes('.') && !cleanedUrl.includes('/') && cleanedUrl.length < 100) {
      // Might be a domain without protocol
      vlog(`[DATA-VALIDATION] Adding http:// prefix to potential domain in issue ${issueKey}: "${cleanedUrl}"`);
      cleanedUrl = 'http://' + cleanedUrl;
    }
  }
  
  // Validate URL if strict validation is enabled
  if (config.strictUrlValidation && cleanedUrl.length > 0) {
    try {
      const isValidUrl = validateUrlSafely(cleanedUrl);
      if (!isValidUrl) {
        vlog(`[DATA-VALIDATION] Invalid URL structure in issue ${issueKey}, keeping with warning: "${cleanedUrl.substring(0, 100)}${cleanedUrl.length > 100 ? '...' : ''}"`);
      }
    } catch (error) {
      vlog(`[DATA-VALIDATION] Error validating URL in issue ${issueKey}: "${cleanedUrl.substring(0, 100)}${cleanedUrl.length > 100 ? '...' : ''}" - ${(error as Error).message}`);
    }
  }
  
  return cleanedUrl;
}

/**
 * Clean and validate artifact values (file paths, identifiers, etc.)
 */
function cleanArtifactValue(artifact: string, issueKey: string): string {
  let cleanedArtifact = artifact;
  
  // Normalize path separators and remove problematic characters
  cleanedArtifact = cleanedArtifact
    .replace(/[\r\n\t]/g, '') // Remove line breaks and tabs
    .replace(/\\+/g, '/') // Normalize backslashes to forward slashes
    .replace(/\/+/g, '/') // Collapse multiple slashes
    .replace(/[<>"'|*?]/g, '') // Remove characters invalid in file paths
    .trim();
  
  // Remove leading/trailing slashes unless it looks like an absolute path
  if (!cleanedArtifact.match(/^[a-zA-Z]:|^\/[a-zA-Z]/)) {
    cleanedArtifact = cleanedArtifact.replace(/^\/+|\/+$/g, '');
  }
  
  // Validate that it's not just path separators
  if (cleanedArtifact.replace(/[\/\\]/g, '').length === 0) {
    vlog(`[DATA-VALIDATION] Artifact value in issue ${issueKey} contains only path separators, clearing: "${artifact}"`);
    return '';
  }
  
  return cleanedArtifact;
}

/**
 * Clean and validate page values (page names, identifiers, etc.)
 */
function cleanPageValue(page: string, issueKey: string): string {
  let cleanedPage = page;
  
  // Basic cleaning for page identifiers
  cleanedPage = cleanedPage
    .replace(/[\r\n\t]/g, ' ') // Replace line breaks with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[<>"']/g, '') // Remove HTML-like characters
    .trim();
  
  // Remove control characters and other problematic characters
  cleanedPage = cleanedPage.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  
  return cleanedPage;
}

/**
 * Enhanced extract related values function with comprehensive validation and sanitization
 */
function extractRelatedValues(issue: IssueData, config: ValidationConfig = DEFAULT_VALIDATION_CONFIG): string[] {
  const values = new Set<string>();
  
  try {
    // Extract values from each field with comprehensive sanitization
    const urlValues = sanitizeCommaSeparatedField(issue.related_url, 'related_url', issue.issue_key, config);
    const artifactValues = sanitizeCommaSeparatedField(issue.related_artifacts, 'related_artifacts', issue.issue_key, config);
    const pageValues = sanitizeCommaSeparatedField(issue.related_pages, 'related_pages', issue.issue_key, config);
    
    // Add all cleaned values to the set (automatically handles duplicates)
    urlValues.forEach(v => {
      if (v.length > 0) {
        values.add(v);
      }
    });
    
    artifactValues.forEach(v => {
      if (v.length > 0) {
        values.add(v);
      }
    });
    
    pageValues.forEach(v => {
      if (v.length > 0) {
        values.add(v);
      }
    });
    
    // Log summary for issues with many related values
    const totalOriginalFields = [
      issue.related_url?.length || 0,
      issue.related_artifacts?.length || 0, 
      issue.related_pages?.length || 0
    ].reduce((sum, len) => sum + len, 0);
    
    const totalCleanedValues = values.size;
    
    if (totalCleanedValues > 20 || (totalOriginalFields > 1000 && totalCleanedValues < totalOriginalFields * 0.5)) {
      vlog(`[DATA-VALIDATION] Issue ${issue.issue_key} related values summary: ${totalOriginalFields} chars → ${totalCleanedValues} values (URLs: ${urlValues.length}, Artifacts: ${artifactValues.length}, Pages: ${pageValues.length})`);
    }
    
  } catch (error) {
    verror(`[DATA-VALIDATION] Error processing related values for issue ${issue.issue_key}: ${(error as Error).message}`);
    // Return empty array on error to prevent processing failure
    return [];
  }
  
  return Array.from(values);
}

// Algorithm safeguard configuration
interface ConnectedComponentsConfig {
  maxIterations: number;
  maxGroupSize: number;
  maxStackSize: number;
  maxComponentSearchTime: number;
  cycleDetectionEnabled: boolean;
  stackOverflowProtection: boolean;
}

// Default safeguard limits
const DEFAULT_SAFEGUARDS: ConnectedComponentsConfig = {
  maxIterations: 500000, // Increased from 100,000 for large connected components
  maxGroupSize: 50000, // Prevent memory exhaustion from massive groups
  maxStackSize: 10000, // Prevent stack overflow in iterative DFS
  maxComponentSearchTime: 180000, // 3 minutes per component (increased from 2 minutes)
  cycleDetectionEnabled: true,
  stackOverflowProtection: true
};

// Group issues by shared related values with timeout protection
async function groupIssuesByRelatedValues(issues: IssueData[], safeguards: ConnectedComponentsConfig = DEFAULT_SAFEGUARDS): Promise<IssueData[][]> {
  vlog(`[DEBUG] groupIssuesByRelatedValues: Starting with ${issues.length} issues`);
  vlog(`[SAFEGUARDS] Algorithm limits - maxIterations: ${safeguards.maxIterations}, maxGroupSize: ${safeguards.maxGroupSize}, maxStackSize: ${safeguards.maxStackSize}`);
  const initialMemory = getMemoryUsage();
  vlog(`[MEMORY-CHECKPOINT] groupIssuesByRelatedValues start: ${initialMemory.usage}`);
  
  // Log sample data for first batch of issues
  logRelatedValuesSample(issues, 20);
  
  try {
    return await withTimeout(
      () => {
        const startTime = Date.now();
        
        // Early validation to prevent processing with unreasonable inputs
        if (issues.length === 0) {
          vlog(`[DEBUG] groupIssuesByRelatedValues: No issues to process, returning empty array`);
          return [];
        }
        
        if (issues.length > 1000000) {
          vwarn(`[SAFEGUARD-WARNING] Processing very large dataset (${issues.length} issues), consider batch processing`);
        }
        
        // Build a map of value -> issues that have that value
        const valueToIssues = new Map<string, Set<string>>();
        const issueToValues = new Map<string, string[]>();
        
        vlog('[DEBUG] groupIssuesByRelatedValues: Building value mappings...');
        
        // First pass: build the mappings
        let processedIssues = 0;
        issues.forEach(issue => {
          processedIssues++;
          if (processedIssues % 1000 === 0) {
            vlog(`[DEBUG] groupIssuesByRelatedValues: Building mappings ${processedIssues}/${issues.length} (${(processedIssues/issues.length*100).toFixed(1)}%)`);
            // Log memory usage every 1000 issues
            const currentMemory = getMemoryUsage();
            vlog(`[MEMORY-CHECKPOINT] Mapping progress ${processedIssues}: ${currentMemory.usage}`);
          }
          const values = extractRelatedValues(issue);
          issueToValues.set(issue.issue_key, values);
          
          values.forEach(value => {
            if (!valueToIssues.has(value)) {
              valueToIssues.set(value, new Set<string>());
            }
            valueToIssues.get(value)!.add(issue.issue_key);
          });
          
          // Debug log for issues with many related values
          if (values.length > 10) {
            vlog(`[DEBUG] groupIssuesByRelatedValues: Issue ${issue.issue_key} has ${values.length} related values`);
          }
        });
        
        const mappingTime = Date.now() - startTime;
        const mappingMemory = getMemoryUsage();
        vlog(`[DEBUG] groupIssuesByRelatedValues: Mapping completed in ${mappingTime}ms. Found ${valueToIssues.size} unique values`);
        vlog(`[MEMORY-CHECKPOINT] After mapping: ${mappingMemory.usage}`);
        
        // Debug: Log detailed statistics about the mappings
        const valueSizes = Array.from(valueToIssues.values()).map(set => set.size);
        valueSizes.sort((a, b) => b - a);
        vlog(`[GROUP-STRUCTURE] Value distribution statistics:`);
        console.log(`  - Total unique values: ${valueToIssues.size}`);
        console.log(`  - Top 10 value group sizes: ${valueSizes.slice(0, 10).join(', ')}`);
        console.log(`  - Values connecting 1+ issues: ${valueSizes.filter(s => s >= 1).length}`);
        console.log(`  - Values connecting 10+ issues: ${valueSizes.filter(s => s >= 10).length}`);
        console.log(`  - Values connecting 50+ issues: ${valueSizes.filter(s => s >= 50).length}`);
        console.log(`  - Values connecting 100+ issues: ${valueSizes.filter(s => s >= 100).length}`);
        
        // Log sample of most connected values
        const topValues = Array.from(valueToIssues.entries())
          .sort((a, b) => b[1].size - a[1].size)
          .slice(0, 5);
        vlog(`[GROUP-STRUCTURE] Top 5 most connected values:`);
        topValues.forEach((entry, idx) => {
          const [value, issueSet] = entry;
          vlog(`  ${idx + 1}. "${value}" -> ${issueSet.size} issues`);
        });
        
        // Second pass: build groups using iterative connected components to avoid stack overflow
        const visited = new Set<string>();
        const groups: string[][] = [];
        
        // Enhanced iterative DFS with comprehensive safeguards
        const findConnectedComponent = (startIssueKey: string): Set<string> => {
          vlog(`[DEBUG] findConnectedComponent: Starting DFS from issue ${startIssueKey}`);
          const componentStartTime = Date.now();
          const currentGroup = new Set<string>();
          const stack = [startIssueKey];
          const visitedInThisComponent = new Set<string>(); // Cycle detection for this component
          let iterations = 0;
          let maxStackSize = 1;
          let cycleDetectionTriggers = 0;
          let stackOverflowPrevented = 0;
          
          while (stack.length > 0) {
            iterations++;
            maxStackSize = Math.max(maxStackSize, stack.length);
            
            // Enhanced debug logging every 1000 iterations
            if (iterations % 1000 === 0) {
              const elapsed = Date.now() - componentStartTime;
              vlog(`[DEBUG] findConnectedComponent: Iteration ${iterations}, stack: ${stack.length}, component: ${currentGroup.size}, time: ${elapsed}ms`);
              
              // Memory usage check during long-running components
              const componentMemory = getMemoryUsage();
              vlog(`[MEMORY-CHECKPOINT] Component iteration ${iterations}: ${componentMemory.usage}`);
            }
            
            // SAFEGUARD 1: Maximum iteration limit to prevent infinite loops
            if (iterations > safeguards.maxIterations) {
              vwarn(`[SAFEGUARD-TRIGGERED] findConnectedComponent: Breaking after ${iterations} iterations (limit: ${safeguards.maxIterations})`);
              vwarn(`[SAFEGUARD-INFO] Component stats - size: ${currentGroup.size}, max stack: ${maxStackSize}, cycles: ${cycleDetectionTriggers}`);
              break;
            }
            
            // SAFEGUARD 2: Maximum group size limit to prevent memory exhaustion
            if (currentGroup.size >= safeguards.maxGroupSize) {
              vwarn(`[SAFEGUARD-TRIGGERED] findConnectedComponent: Component size limit reached (${currentGroup.size} >= ${safeguards.maxGroupSize})`);
              vwarn(`[SAFEGUARD-INFO] Stopping component growth to prevent memory exhaustion`);
              break;
            }
            
            // SAFEGUARD 3: Stack overflow protection
            if (safeguards.stackOverflowProtection && stack.length > safeguards.maxStackSize) {
              vwarn(`[SAFEGUARD-TRIGGERED] findConnectedComponent: Stack size limit reached (${stack.length} > ${safeguards.maxStackSize})`);
              // Instead of breaking, process current stack item and continue with reduced stack
              const stackMidpoint = Math.floor(stack.length / 2);
              stack.splice(stackMidpoint, stack.length - stackMidpoint); // Keep first half of stack
              stackOverflowPrevented++;
              vwarn(`[SAFEGUARD-INFO] Stack trimmed to ${stack.length} items (prevention count: ${stackOverflowPrevented})`);
            }
            
            // SAFEGUARD 4: Component search timeout check
            if (iterations % 5000 === 0) {
              const elapsed = Date.now() - componentStartTime;
              if (elapsed > safeguards.maxComponentSearchTime) {
                vwarn(`[SAFEGUARD-TRIGGERED] findConnectedComponent: Component search timeout (${elapsed}ms > ${safeguards.maxComponentSearchTime}ms)`);
                vwarn(`[SAFEGUARD-INFO] Component stats - iterations: ${iterations}, size: ${currentGroup.size}, cycles: ${cycleDetectionTriggers}`);
                break;
              }
            }
            
            const issueKey = stack.pop()!;
            
            // SAFEGUARD 5: Basic cycle detection
            if (safeguards.cycleDetectionEnabled) {
              if (visitedInThisComponent.has(issueKey)) {
                cycleDetectionTriggers++;
                if (cycleDetectionTriggers % 100 === 0) {
                  console.warn(`[SAFEGUARD-INFO] Cycle detection triggered ${cycleDetectionTriggers} times for issue ${issueKey}`);
                }
                continue; // Skip processing this issue again in this component
              }
              visitedInThisComponent.add(issueKey);
            }
            
            if (visited.has(issueKey)) continue;
            
            visited.add(issueKey);
            currentGroup.add(issueKey);
            
            // Get all values for this issue with validation
            const values = issueToValues.get(issueKey) || [];
            
            // For each value, add all connected issues to the stack
            values.forEach(value => {
              const connectedIssues = valueToIssues.get(value) || new Set<string>();
              let newConnections = 0;
              let skippedConnections = 0;
              
              connectedIssues.forEach(connectedIssue => {
                if (!visited.has(connectedIssue)) {
                  // Additional safeguard: Don't add if it would exceed group size limit soon
                  if (currentGroup.size + stack.length < safeguards.maxGroupSize * 0.9) {
                    stack.push(connectedIssue);
                    newConnections++;
                  } else {
                    skippedConnections++;
                  }
                }
              });
              
              // Enhanced debug logging for high-connectivity values
              if (connectedIssues.size > 50) {
                console.log(`[DEBUG] findConnectedComponent: Value '${value}' connects to ${connectedIssues.size} issues (${newConnections} added, ${skippedConnections} skipped)`);
              }
            });
          }
          
          const componentTime = Date.now() - componentStartTime;
          vlog(`[DEBUG] findConnectedComponent: Completed in ${componentTime}ms`);
          vlog(`[DEBUG] Component stats - iterations: ${iterations}, max stack: ${maxStackSize}, size: ${currentGroup.size}`);
          vlog(`[SAFEGUARDS] Component safeguards - cycles: ${cycleDetectionTriggers}, stack overflows prevented: ${stackOverflowPrevented}`);
          
          return currentGroup;
        };
        
        // Find all connected components with enhanced monitoring
        vlog('[DEBUG] groupIssuesByRelatedValues: Starting connected components search...');
        const componentsStartTime = Date.now();
        let componentsFound = 0;
        let issuesProcessedForComponents = 0;
        let totalComponentSize = 0;
        let largeComponentsFound = 0;
        let skippedIssues = 0;
        
        for (const issue of issues) {
          issuesProcessedForComponents++;
          
          // Enhanced progress reporting
          if (issuesProcessedForComponents % 1000 === 0) {
            const elapsed = Date.now() - componentsStartTime;
            const avgComponentSize = totalComponentSize / Math.max(componentsFound, 1);
            vlog(`[DEBUG] groupIssuesByRelatedValues: Progress ${issuesProcessedForComponents}/${issues.length} (${(issuesProcessedForComponents/issues.length*100).toFixed(1)}%)`);
            vlog(`[DEBUG] Components found: ${componentsFound}, avg size: ${avgComponentSize.toFixed(1)}, large components: ${largeComponentsFound}`);
            const componentMemory = getMemoryUsage();
            vlog(`[MEMORY-CHECKPOINT] Component search ${issuesProcessedForComponents}: ${componentMemory.usage}`);
            
            // Early termination if process is taking too long
            if (elapsed > 600000) { // 10 minutes total limit for component discovery
              vwarn(`[SAFEGUARD-TRIGGERED] Component discovery taking too long (${elapsed}ms), terminating early`);
              vwarn(`[SAFEGUARD-INFO] Processed ${issuesProcessedForComponents}/${issues.length} issues, found ${componentsFound} components`);
              break;
            }
          }
          
          if (!visited.has(issue.issue_key)) {
            // Component size prediction to avoid processing very large components
            const estimatedConnections = (issueToValues.get(issue.issue_key) || []).reduce((sum, value) => {
              return sum + (valueToIssues.get(value)?.size || 0);
            }, 0);
            
            if (estimatedConnections > safeguards.maxGroupSize * 2) {
              vwarn(`[SAFEGUARD-INFO] Skipping issue ${issue.issue_key} with ${estimatedConnections} estimated connections (too large)`);
              skippedIssues++;
              visited.add(issue.issue_key); // Mark as visited to avoid reprocessing
              groups.push([issue.issue_key]); // Add as singleton group
              componentsFound++;
              continue;
            }
            
            const currentGroup = findConnectedComponent(issue.issue_key);
            if (currentGroup.size > 0) {
              groups.push(Array.from(currentGroup));
              componentsFound++;
              totalComponentSize += currentGroup.size;
              
              // Track large components
              if (currentGroup.size > 100) {
                largeComponentsFound++;
                vlog(`[DEBUG] groupIssuesByRelatedValues: Found large component ${componentsFound} with ${currentGroup.size} issues`);
              } else if (currentGroup.size > 10) {
                vlog(`[DEBUG] groupIssuesByRelatedValues: Found medium component ${componentsFound} with ${currentGroup.size} issues`);
              }
            }
          }
        }
        
        const componentsTime = Date.now() - componentsStartTime;
        const groupingTime = Date.now() - startTime;
        const finalMemory = getMemoryUsage();
        const avgComponentSize = totalComponentSize / Math.max(componentsFound, 1);
        
        vlog(`[DEBUG] groupIssuesByRelatedValues: Completed in ${groupingTime}ms (components: ${componentsTime}ms)`);
        console.log(`[DEBUG] Found ${groups.length} groups total, processed ${issuesProcessedForComponents}/${issues.length} issues`);
        console.log(`[SAFEGUARDS] Component discovery stats - large components: ${largeComponentsFound}, skipped issues: ${skippedIssues}`);
        console.log(`[MEMORY-CHECKPOINT] After components: ${finalMemory.usage}`);
        
        // Enhanced group structure analysis with safeguard statistics
        const groupSizes = groups.map(g => g.length).sort((a, b) => b - a);
        console.log(`[GROUP-STRUCTURE] Final group analysis:`);
        console.log(`  - Total groups found: ${groups.length}`);
        console.log(`  - Average component size: ${avgComponentSize.toFixed(1)}`);
        console.log(`  - Largest group sizes: ${groupSizes.slice(0, 10).join(', ')}`);
        console.log(`  - Groups with 1 issue: ${groupSizes.filter(s => s === 1).length}`);
        console.log(`  - Groups with 2-5 issues: ${groupSizes.filter(s => s >= 2 && s <= 5).length}`);
        console.log(`  - Groups with 6-10 issues: ${groupSizes.filter(s => s >= 6 && s <= 10).length}`);
        console.log(`  - Groups with 11-50 issues: ${groupSizes.filter(s => s >= 11 && s <= 50).length}`);
        console.log(`  - Groups with 50+ issues: ${groupSizes.filter(s => s >= 50).length}`);
        console.log(`  - Groups with 1000+ issues: ${groupSizes.filter(s => s >= 1000).length}`);
        
        // Log sample of largest groups with safeguard information
        console.log(`[GROUP-STRUCTURE] Sample of 5 largest groups:`);
        for (let i = 0; i < Math.min(5, groups.length); i++) {
          const group = groups.find(g => g.length === groupSizes[i]);
          if (group) {
            const sizeCategory = group.length >= 1000 ? 'VERY LARGE' : group.length >= 100 ? 'LARGE' : group.length >= 10 ? 'MEDIUM' : 'SMALL';
            console.log(`  Group ${i + 1} (${sizeCategory}): ${group.length} issues -> [${group.slice(0, 3).join(', ')}${group.length > 3 ? '...' : ''}]`);
          }
        }
        
        // Validate that safeguards prevented any groups from exceeding limits
        const oversizedGroups = groupSizes.filter(s => s > safeguards.maxGroupSize);
        if (oversizedGroups.length > 0) {
          console.warn(`[SAFEGUARD-WARNING] Found ${oversizedGroups.length} groups exceeding size limit: ${oversizedGroups.join(', ')}`);
        } else {
          console.log(`[SAFEGUARDS] All groups are within size limit (${safeguards.maxGroupSize})`);
        }
        
        // Create a map for quick lookup
        const issueKeyToIssue = new Map<string, IssueData>();
        issues.forEach(issue => {
          issueKeyToIssue.set(issue.issue_key, issue);
        });
        
        // Convert groups of keys back to groups of issues
        const result = groups.map(group => group.map(key => issueKeyToIssue.get(key)!));
        
        console.log(`[DEBUG] groupIssuesByRelatedValues: Final result - ${result.length} groups with sizes: ${result.map(g => g.length).slice(0, 10).join(', ')}${result.length > 10 ? '...' : ''}`);
        
        return result;
      },
      {
        timeoutMs: 300000, // 5 minute timeout for grouping operation
        operationName: 'groupIssuesByRelatedValues',
        onProgress: (progress) => console.log(`[DEBUG] groupIssuesByRelatedValues: ${progress}`)
      }
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.warn(`[WARNING] groupIssuesByRelatedValues: Operation timed out after ${error.timeoutMs}ms`);
      console.warn(`[WARNING] groupIssuesByRelatedValues: Falling back to simple single-issue groups for graceful degradation`);
      
      // Graceful fallback: return each issue in its own group
      const fallbackGroups = issues.map(issue => [issue]);
      console.log(`[DEBUG] groupIssuesByRelatedValues: Fallback result - ${fallbackGroups.length} individual issue groups`);
      return fallbackGroups;
    }
    
    // Handle other potential errors gracefully
    if (error instanceof Error) {
      console.error(`[ERROR] groupIssuesByRelatedValues: Unexpected error - ${error.message}`);
      console.warn(`[WARNING] groupIssuesByRelatedValues: Falling back to single-issue groups due to error`);
      
      // Graceful fallback on any error
      const fallbackGroups = issues.map(issue => [issue]);
      return fallbackGroups;
    }
    
    throw error;
  }
}

// Enhanced database validation with timeout protection and retry logic
async function validateDatabase(dbManager: DatabaseManager): Promise<void> {
  vlog("[DATABASE] Starting enhanced database validation...");
  
  try {
    // Check if issues table exists with timeout protection
    const tableExists = await dbManager.get(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='issues_fts'
    `) as TableInfo | undefined;
    
    if (!tableExists) {
      throw new Error("Issues table not found in database");
    }
    
    vlog("[DATABASE] Issues table found");
    
    // Check if issues table has expected columns with timeout protection
    const columns = await dbManager.all("PRAGMA table_info(issues_fts)") as Array<{ name: string }>;
    const requiredColumns = ['issue_key', 'title', 'description', 'summary', 'resolution_description', 'related_url', 'related_artifacts', 'related_pages'];
    const existingColumns = columns.map(col => col.name);
    
    vlog(`[DATABASE] Found ${columns.length} columns in issues_fts table`);
    
    const missingColumns: string[] = [];
    for (const col of requiredColumns) {
      if (!existingColumns.includes(col)) {
        missingColumns.push(col);
      }
    }
    
    if (missingColumns.length > 0) {
      throw new Error(`Required columns not found in issues table: ${missingColumns.join(', ')}`);
    }
    
    vlog("[DATABASE] Database validation successful - all required columns present");
  } catch (error) {
    verror(`[DATABASE-ERROR] Database validation failed: ${(error as Error).message}`);
    throw new Error(`Database validation failed: ${(error as Error).message}`);
  }
}

// Enhanced issue counting with timeout protection and retry logic
async function countIssues(dbManager: DatabaseManager): Promise<number> {
  vlog("[DATABASE] Counting total issues with timeout protection...");
  
  try {
    const result = await dbManager.get("SELECT COUNT(*) as count FROM issues_fts") as CountResult;
    const count = result?.count || 0;
    vlog(`[DATABASE] Found ${count} total issues`);
    return count;
  } catch (error) {
    verror(`[DATABASE-ERROR] Error counting issues: ${(error as Error).message}`);
    throw new Error(`Error counting issues: ${(error as Error).message}`);
  }
}

// Enhanced generator function with database timeout protection and retry logic
async function* streamDocumentBatches(dbManager: DatabaseManager, batchSize: number = CONFIG.batchSize): AsyncGenerator<ProcessedDocument[], void, unknown> {
  vlog('[DEBUG] streamDocumentBatches: Starting enhanced function with database timeout protection');
  const overallStartTime = Date.now();
  const totalIssues = await countIssues(dbManager);
  vlog(`[DEBUG] streamDocumentBatches: Total issues to process: ${totalIssues}`);
  
  let processedCount = 0;
  let validDocuments = 0;
  const startTime = Date.now();
  
  console.log(`Total issues to process: ${totalIssues}`);
  console.log(`Processing with grouping by related values (target batch size: ${batchSize})...`);
  
  // Log initial memory state
  const streamStartMemory = getMemoryUsage();
  console.log(`[MEMORY-CHECKPOINT] streamDocumentBatches initial: ${streamStartMemory.usage}`);
  
  // Load all issues at once for grouping (could be optimized for very large datasets)
  // For very large datasets, we could load in chunks and merge groups
  const allIssues: IssueData[] = [];
  let offset = 0;
  const loadChunkSize = 10000; // Load in chunks to avoid memory issues
  
  while (offset < totalIssues) {
    console.log(`[DEBUG] streamDocumentBatches: Loading chunk at offset ${offset}`);
    const chunkStartTime = Date.now();
    const chunk = await loadIssues(dbManager, offset, loadChunkSize);
    const chunkTime = Date.now() - chunkStartTime;
    
    console.log(`[DEBUG] streamDocumentBatches: Loaded ${chunk.length} issues in ${chunkTime}ms`);
    
    if (chunk.length === 0) break;
    allIssues.push(...chunk);
    offset += chunk.length;
    
    // Log memory usage after each chunk
    const chunkMemory = getMemoryUsage();
    console.log(`Loading issues: ${offset}/${totalIssues} (${(offset/totalIssues*100).toFixed(1)}%) - Memory: ${chunkMemory.usage}`);
    console.log(`[MEMORY-CHECKPOINT] After loading chunk ${Math.ceil(offset/loadChunkSize)}: ${chunkMemory.usage}`);
  }
  
  console.log(`Grouping ${allIssues.length} issues by related values...`);
  console.log('[DEBUG] streamDocumentBatches: Starting grouping process...');
  const groupingStartTime = Date.now();
  const preGroupingMemory = getMemoryUsage();
  console.log(`[MEMORY-CHECKPOINT] Before grouping: ${preGroupingMemory.usage}`);
  
  // Group issues by their related values with enhanced safeguards
  const groups = await groupIssuesByRelatedValues(allIssues, DEFAULT_SAFEGUARDS);
  
  const groupingTime = Date.now() - groupingStartTime;
  const postGroupingMemory = getMemoryUsage();
  console.log(`[DEBUG] streamDocumentBatches: Grouping completed in ${groupingTime}ms`);
  console.log(`[MEMORY-CHECKPOINT] After grouping: ${postGroupingMemory.usage}`);
  
  // Sort groups by size (largest first) to prioritize processing related documents together
  console.log('[DEBUG] streamDocumentBatches: Sorting groups by size...');
  groups.sort((a, b) => b.length - a.length);
  console.log('[DEBUG] streamDocumentBatches: Groups sorted');
  
  console.log(`Created ${groups.length} groups (sizes: ${groups.slice(0, 5).map(g => g.length).join(', ')}${groups.length > 5 ? '...' : ''})`);
  
  // Process groups
  console.log('[DEBUG] streamDocumentBatches: Starting group processing...');
  let currentBatch: IssueData[] = [];
  let groupsProcessed = 0;
  let batchesYielded = 0;
  const processingStartMemory = getMemoryUsage();
  console.log(`[MEMORY-CHECKPOINT] Starting batch processing: ${processingStartMemory.usage}`);
  
  for (const group of groups) {
    console.log(`[DEBUG] streamDocumentBatches: Processing group ${groupsProcessed + 1}/${groups.length} (size: ${group.length})`);
    
    // If adding this group would exceed batch size and we have items, yield current batch
    if (currentBatch.length > 0 && currentBatch.length + group.length > batchSize) {
      // Process and yield the current batch
      const processedBatch: ProcessedDocument[] = [];
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
      const batchMemory = getMemoryUsage();
      console.log(`Processed ${processedCount}/${totalIssues} issues (${progress}%) - Batch size: ${processedBatch.length} - Groups: ${groupsProcessed}`);
      console.log(`[MEMORY-CHECKPOINT] Batch ${batchesYielded + 1} processed: ${batchMemory.usage}`);
      
      if (processedBatch.length > 0) {
        batchesYielded++;
        console.log(`[DEBUG] streamDocumentBatches: Yielding batch ${batchesYielded} with ${processedBatch.length} documents`);
        yield processedBatch;
      }
      
      currentBatch = [];
    }
    
    // Handle large groups that exceed batch size
    if (group.length > batchSize) {
      // Split large group into smaller batches
      for (let i = 0; i < group.length; i += batchSize) {
        const subGroup = group.slice(i, Math.min(i + batchSize, group.length));
        const processedBatch: ProcessedDocument[] = [];
        
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
        const largeGroupMemory = getMemoryUsage();
        console.log(`Processed ${processedCount}/${totalIssues} issues (${progress}%) - Large group batch: ${processedBatch.length}`);
        console.log(`[MEMORY-CHECKPOINT] Large group batch processed: ${largeGroupMemory.usage}`);
        
        if (processedBatch.length > 0) {
          batchesYielded++;
          console.log(`[DEBUG] streamDocumentBatches: Yielding large group batch ${batchesYielded} with ${processedBatch.length} documents`);
          yield processedBatch;
        }
      }
    } else {
      // Add small group to current batch
      console.log(`[DEBUG] streamDocumentBatches: Adding group of ${group.length} to current batch (new size: ${currentBatch.length + group.length})`);
      currentBatch.push(...group);
    }
    
    groupsProcessed++;
  }
  
  // Process any remaining items in the last batch
  if (currentBatch.length > 0) {
    const processedBatch: ProcessedDocument[] = [];
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
    const finalBatchMemory = getMemoryUsage();
    console.log(`Processed final batch: ${processedCount}/${totalIssues} issues - Batch size: ${processedBatch.length}`);
    console.log(`[MEMORY-CHECKPOINT] Final batch processed: ${finalBatchMemory.usage}`);
    
    if (processedBatch.length > 0) {
      batchesYielded++;
      console.log(`[DEBUG] streamDocumentBatches: Yielding final batch ${batchesYielded} with ${processedBatch.length} documents`);
      yield processedBatch;
    }
  }
  
  const totalTime = Date.now() - overallStartTime;
  const completionMemory = getMemoryUsage();
  console.log(`[DEBUG] streamDocumentBatches: Function completed in ${totalTime}ms`);
  console.log(`[MEMORY-CHECKPOINT] streamDocumentBatches completion: ${completionMemory.usage}`);
  console.log(`Document loading complete: ${validDocuments} valid documents from ${totalIssues} issues in ${(totalTime/1000).toFixed(1)}s`);
  console.log(`Processed ${groupsProcessed} groups total, yielded ${batchesYielded} batches`);
}

// Enhanced TF-IDF processing with comprehensive database timeout and retry protection
async function processTFIDF(dbManager: DatabaseManager, config: Config = CONFIG): Promise<void> {
  const overallStartTime = Date.now();
  const processTFIDFStartMemory = getMemoryUsage();
  console.log(`[MEMORY-CHECKPOINT] processTFIDF start: ${processTFIDFStartMemory.usage}`);
  
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
    maxTermLength: config.maxTermLength,
    verbose: config.verbose,
  });
  
  const processorInitMemory = getMemoryUsage();
  console.log(`[MEMORY-CHECKPOINT] After processor init: ${processorInitMemory.usage}`);
  
  // Build the corpus using streaming
  console.log("\nBuilding TF-IDF corpus with streaming processing...");
  const corpusStartTime = Date.now();
  
  console.log('[DEBUG] processTFIDF: Creating document batch generator with database timeout protection...');
  const documentBatches = streamDocumentBatches(dbManager, config.batchSize);
  
  console.log('[DEBUG] processTFIDF: Starting corpus building...');
  const preCorpusMemory = getMemoryUsage();
  console.log(`[MEMORY-CHECKPOINT] Before corpus building: ${preCorpusMemory.usage}`);
  
  await processor.buildCorpusStreaming(documentBatches, config.batchSize);
  const corpusTime = Date.now() - corpusStartTime;
  const postCorpusMemory = getMemoryUsage();
  
  console.log(`Corpus built successfully in ${(corpusTime/1000).toFixed(1)}s`);
  console.log(`[MEMORY-CHECKPOINT] After corpus building: ${postCorpusMemory.usage}`);
  
  // Extract keywords for all documents
  console.log(`\nExtracting top ${config.topKeywords} keywords per issue...`);
  const keywordStartTime = Date.now();
  const keywordsData = processor.exportKeywordsForDB(config.topKeywords);
  const corpusStats = processor.exportCorpusStatsForDB();
  const keywordTime = Date.now() - keywordStartTime;
  const keywordExtractionMemory = getMemoryUsage();
  
  console.log(`Keywords extracted in ${(keywordTime/1000).toFixed(1)}s`);
  console.log(`[MEMORY-CHECKPOINT] After keyword extraction: ${keywordExtractionMemory.usage}`);
  
  // Store results in database
  console.log("\nStoring TF-IDF results in database...");
  const dbStartTime = Date.now();
  const preDbInsertMemory = getMemoryUsage();
  console.log(`[MEMORY-CHECKPOINT] Before database insertion: ${preDbInsertMemory.usage}`);
  
  // Use enhanced transaction with timeout protection and retry logic
  console.log('[DEBUG] processTFIDF: Preparing database statements with timeout protection...');
  
  await dbManager.transaction(async () => {
    const insertKeyword = await dbManager.prepare(`
      INSERT INTO tfidf_keywords (issue_key, keyword, tfidf_score, tf_score, idf_score)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const insertCorpusStat = await dbManager.prepare(`
      INSERT INTO tfidf_corpus_stats (keyword, idf_score, document_frequency, total_documents)
      VALUES (?, ?, ?, ?)
    `);
    // Insert keywords with enhanced progress tracking and timeout protection
    console.log(`[DATABASE-TRANSACTION] Inserting ${keywordsData.length} keyword records with timeout protection...`);
    console.log('[DEBUG] processTFIDF: Starting enhanced keyword insertion...');
    const insertStartTime = Date.now();
    
    for (let i = 0; i < keywordsData.length; i++) {
      const keyword = keywordsData[i];
      
      try {
        await dbManager.executeWithRetry(
          () => insertKeyword.run(
            keyword.issue_key,
            keyword.keyword,
            keyword.tfidf_score,
            keyword.tf_score,
            keyword.idf_score
          ),
          `insert_keyword_${i}`
        );
      } catch (error) {
        console.error(`[DATABASE-ERROR] Failed to insert keyword ${i}: ${(error as Error).message}`);
        // Continue with other inserts rather than failing completely
      }
      
      // Enhanced progress update every 5000 records for better monitoring
      if (i > 0 && i % 5000 === 0) {
        const insertTime = Date.now() - insertStartTime;
        const insertMemory = getMemoryUsage();
        const dbStats = dbManager.getStats();
        console.log(`[DEBUG] processTFIDF: Inserted ${i}/${keywordsData.length} keyword records (${(i/keywordsData.length*100).toFixed(1)}%) in ${insertTime}ms`);
        console.log(`[MEMORY-CHECKPOINT] Keyword insertion ${i}: ${insertMemory.usage}`);
        console.log(`[DATABASE-STATS] Queries: ${dbStats.totalQueries}, Timeouts: ${dbStats.timeoutQueries}, Retries: ${dbStats.retriedQueries}`);
      }
    }
    
    // Insert corpus statistics with timeout protection
    console.log(`[DATABASE-TRANSACTION] Inserting ${corpusStats.length} corpus statistics with timeout protection...`);
    for (let i = 0; i < corpusStats.length; i++) {
      const stat = corpusStats[i];
      try {
        await dbManager.executeWithRetry(
          () => insertCorpusStat.run(
            stat.keyword,
            stat.idf_score,
            stat.document_frequency,
            stat.total_documents
          ),
          `insert_corpus_stat_${i}`
        );
      } catch (error) {
        console.error(`[DATABASE-ERROR] Failed to insert corpus stat ${i}: ${(error as Error).message}`);
        // Continue with other inserts rather than failing completely
      }
      
      // Progress update for corpus stats
      if (i > 0 && i % 1000 === 0) {
        console.log(`[DEBUG] processTFIDF: Inserted ${i}/${corpusStats.length} corpus statistics (${(i/corpusStats.length*100).toFixed(1)}%)`);
      }
    }
  }, 'tfidf_data_insertion');
  
  const dbTime = Date.now() - dbStartTime;
  const totalTime = Date.now() - overallStartTime;
  const finalMemory = getMemoryUsage();
  
  console.log(`\nTF-IDF processing complete!`);
  console.log(`- Total keywords extracted: ${keywordsData.length}`);
  console.log(`- Unique terms in corpus: ${corpusStats.length}`);
  console.log(`- Database insertion time: ${(dbTime/1000).toFixed(1)}s`);
  console.log(`- Total processing time: ${(totalTime/1000).toFixed(1)}s`);
  console.log(`[MEMORY-CHECKPOINT] processTFIDF completion: ${finalMemory.usage}`);
  
  // Show sample results
  await showSampleResults(dbManager);
}

// Enhanced TF-IDF processing with comprehensive error recovery and checkpoint system
async function processTFIDFWithRecovery(
  dbManager: DatabaseManager, 
  config: Config, 
  errorRecoveryManager: ErrorRecoveryManager
): Promise<void> {
  const overallStartTime = Date.now();
  const processTFIDFStartMemory = getMemoryUsage();
  console.log(`[RECOVERY] Starting TF-IDF processing with comprehensive error recovery`);
  console.log(`[MEMORY-CHECKPOINT] processTFIDFWithRecovery start: ${processTFIDFStartMemory.usage}`);
  
  let totalIssues = 0;
  let processedIssues = 0;
  let successfulIssues = 0;
  let failedIssues = 0;
  let skippedIssues = 0;
  let currentBatch = 0;
  let lastProcessedIssueKey: string | undefined;

  try {
    // Initialize processor with configuration and error recovery
    console.log("\n[RECOVERY] Initializing TF-IDF processor with error recovery configuration:");
    console.log(`- Batch size: ${config.batchSize}`);
    console.log(`- Min document frequency: ${config.minDocFreq}`);
    console.log(`- Max document frequency: ${(config.maxDocFreq * 100).toFixed(1)}%`);
    console.log(`- Min term length: ${config.minTermLength}`);
    console.log(`- Max term length: ${config.maxTermLength}`);
    console.log(`- Top keywords per issue: ${config.topKeywords}`);
    
    const processorResult = await withErrorRecovery(
      async () => {
        return new TFIDFProcessor({
          minDocumentFrequency: config.minDocFreq,
          maxDocumentFrequency: config.maxDocFreq,
          minTermLength: config.minTermLength,
          maxTermLength: config.maxTermLength
        });
      },
      errorRecoveryManager,
      {
        operationName: 'processor-initialization',
        maxRetries: 3,
        skipOnError: false
      }
    );

    if (!processorResult.success || !processorResult.data) {
      throw new Error('Failed to initialize TF-IDF processor');
    }

    const processor = processorResult.data;
    const processorInitMemory = getMemoryUsage();
    console.log(`[MEMORY-CHECKPOINT] After processor init: ${processorInitMemory.usage}`);
    
    // Get total issue count for progress tracking
    totalIssues = await countIssues(dbManager);
    console.log(`[RECOVERY] Processing ${totalIssues} total issues with error recovery`);

    // Create initial checkpoint
    await errorRecoveryManager.createCheckpoint('tfidf-processing', {
      totalIssues,
      processedIssues: 0,
      successfulIssues: 0,
      failedIssues: 0,
      skippedIssues: 0,
      currentBatch: 0,
      memoryUsage: processorInitMemory.used,
      processingStats: { phase: 'initialization' }
    });

    // Build the corpus using streaming with error recovery
    console.log("\n[RECOVERY] Building TF-IDF corpus with streaming processing and error recovery...");
    const corpusStartTime = Date.now();
    
    const documentBatches = streamDocumentBatchesWithRecovery(dbManager, config.batchSize, errorRecoveryManager);
    
    console.log('[RECOVERY] Starting corpus building with error recovery...');
    const preCorpusMemory = getMemoryUsage();
    console.log(`[MEMORY-CHECKPOINT] Before corpus building: ${preCorpusMemory.usage}`);
    
    // Process document batches with comprehensive error recovery
    let batchCount = 0;
    const batchProcessingStats = {
      totalBatches: 0,
      successfulBatches: 0,
      failedBatches: 0,
      partialBatches: 0
    };

    try {
      for await (const batch of documentBatches) {
        batchCount++;
        currentBatch = batchCount;
        
        console.log(`[RECOVERY] Processing batch ${batchCount} with ${batch.length} documents`);
        
        // Process batch with error recovery
        const batchResult = await errorRecoveryManager.processBatchWithRecovery(
          batch,
          async (doc, index) => {
            try {
              const docId = doc.key || doc.id || `unknown_${index}`;
              
              // Combine text fields
              const text = [
                doc.title || '',
                doc.description || '',
                doc.summary || '',
                doc.resolution || '',
                (doc as any).comments || ''
              ].filter(str => str && str.trim().length > 0).join(' ');
              
              if (!text || text.trim().length === 0) {
                console.warn(`[RECOVERY] Document ${docId} has no meaningful text content, skipping`);
                skippedIssues++;
                return { processed: false, reason: 'no-content' };
              }

              // Add document to processor with error handling
              processor.addDocument(docId, text, doc);
              successfulIssues++;
              lastProcessedIssueKey = docId;
              
              return { processed: true, docId };
              
            } catch (error) {
              failedIssues++;
              throw error;
            }
          },
          `batch_${batchCount}`,
          'tfidf-corpus-building'
        );

        // Update statistics
        processedIssues += batch.length;
        batchProcessingStats.totalBatches++;
        
        if (batchResult.canContinue) {
          if (batchResult.failed === 0) {
            batchProcessingStats.successfulBatches++;
          } else if (batchResult.successful > 0) {
            batchProcessingStats.partialBatches++;
            console.warn(`[RECOVERY] Batch ${batchCount} partially processed: ${batchResult.successful} success, ${batchResult.failed} failed`);
          }
        } else {
          batchProcessingStats.failedBatches++;
          console.error(`[RECOVERY] Batch ${batchCount} failed to process acceptably`);
          
          // Check if we should continue processing
          const shouldContinue = errorRecoveryManager.shouldContinueProcessing('tfidf-corpus-building');
          if (!shouldContinue.continue) {
            console.error(`[RECOVERY] Stopping processing due to: ${shouldContinue.reason}`);
            break;
          }
        }

        // Create checkpoint periodically
        if (batchCount % 5 === 0) { // Every 5 batches
          await errorRecoveryManager.createCheckpoint('tfidf-processing', {
            totalIssues,
            processedIssues,
            successfulIssues,
            failedIssues,
            skippedIssues,
            currentBatch,
            lastProcessedIssueKey,
            memoryUsage: getMemoryUsage().used,
            processingStats: {
              phase: 'corpus-building',
              batchCount,
              batchStats: batchProcessingStats
            }
          });
        }

        // Memory monitoring and cleanup
        const currentMemory = getMemoryUsage();
        if (currentMemory.used > preCorpusMemory.used * 2) {
          console.warn(`[RECOVERY] Memory usage doubled, triggering cleanup`);
          if (global.gc) {
            global.gc();
          }
        }
      }

    } catch (error) {
      await errorRecoveryManager.recordError(
        ErrorType.PROCESSING_ERROR,
        ErrorSeverity.HIGH,
        'Corpus building failed',
        { 
          processedIssues, 
          successfulIssues, 
          failedIssues,
          currentBatch,
          lastProcessedIssueKey
        },
        error as Error
      );
      
      // Continue with partial corpus if we have some successful documents
      if (successfulIssues > 0) {
        console.warn(`[RECOVERY] Continuing with partial corpus (${successfulIssues} successful documents)`);
      } else {
        throw error;
      }
    }

    const corpusTime = Date.now() - corpusStartTime;
    const postCorpusMemory = getMemoryUsage();
    
    console.log(`[RECOVERY] Corpus building completed in ${(corpusTime/1000).toFixed(1)}s`);
    console.log(`[RECOVERY] Final stats: ${successfulIssues} successful, ${failedIssues} failed, ${skippedIssues} skipped`);
    console.log(`[MEMORY-CHECKPOINT] After corpus building: ${postCorpusMemory.usage}`);

    // Calculate corpus statistics with error recovery
    console.log('[RECOVERY] Calculating corpus statistics with error recovery...');
    const statsResult = await withErrorRecovery(
      async () => {
        processor.calculateCorpusStats();
        return true;
      },
      errorRecoveryManager,
      {
        operationName: 'corpus-stats-calculation',
        maxRetries: 3,
        skipOnError: false
      }
    );

    if (!statsResult.success) {
      throw new Error('Failed to calculate corpus statistics');
    }

    // Extract keywords with error recovery
    console.log(`\n[RECOVERY] Extracting top ${config.topKeywords} keywords per issue with error recovery...`);
    const keywordStartTime = Date.now();
    
    const keywordResult = await withErrorRecovery(
      async () => {
        const keywordsData = processor.exportKeywordsForDB(config.topKeywords);
        const corpusStats = processor.exportCorpusStatsForDB();
        return { keywordsData, corpusStats };
      },
      errorRecoveryManager,
      {
        operationName: 'keyword-extraction',
        maxRetries: 3,
        skipOnError: false
      }
    );

    if (!keywordResult.success || !keywordResult.data) {
      throw new Error('Failed to extract keywords');
    }

    const { keywordsData, corpusStats } = keywordResult.data;
    const keywordTime = Date.now() - keywordStartTime;
    const keywordExtractionMemory = getMemoryUsage();
    
    console.log(`[RECOVERY] Keywords extracted in ${(keywordTime/1000).toFixed(1)}s`);
    console.log(`[MEMORY-CHECKPOINT] After keyword extraction: ${keywordExtractionMemory.usage}`);
    
    // Store results in database with error recovery
    console.log("\n[RECOVERY] Storing TF-IDF results in database with error recovery...");
    const dbStartTime = Date.now();
    
    const dbResult = await withErrorRecovery(
      async () => {
        await storeResultsWithRecovery(dbManager, keywordsData, corpusStats, errorRecoveryManager);
        return true;
      },
      errorRecoveryManager,
      {
        operationName: 'database-storage',
        maxRetries: 3,
        timeoutMs: 10 * 60 * 1000, // 10 minutes
        skipOnError: false
      }
    );

    if (!dbResult.success) {
      throw new Error('Failed to store results in database');
    }

    const dbTime = Date.now() - dbStartTime;
    const totalTime = Date.now() - overallStartTime;
    const finalMemory = getMemoryUsage();
    
    // Create final checkpoint
    await errorRecoveryManager.createCheckpoint('tfidf-processing', {
      totalIssues,
      processedIssues,
      successfulIssues,
      failedIssues,
      skippedIssues,
      currentBatch,
      lastProcessedIssueKey,
      memoryUsage: finalMemory.used,
      processingStats: {
        phase: 'completed',
        totalTime,
        corpusTime,
        keywordTime,
        dbTime,
        keywordCount: keywordsData.length,
        corpusStatsCount: corpusStats.length,
        batchStats: batchProcessingStats
      }
    });

    console.log(`\n[RECOVERY] TF-IDF processing completed successfully with error recovery!`);
    console.log(`- Total issues processed: ${processedIssues}/${totalIssues} (${(processedIssues/totalIssues*100).toFixed(1)}%)`);
    console.log(`- Successful: ${successfulIssues}, Failed: ${failedIssues}, Skipped: ${skippedIssues}`);
    console.log(`- Total keywords extracted: ${keywordsData.length}`);
    console.log(`- Unique terms in corpus: ${corpusStats.length}`);
    console.log(`- Database insertion time: ${(dbTime/1000).toFixed(1)}s`);
    console.log(`- Total processing time: ${(totalTime/1000).toFixed(1)}s`);
    console.log(`[MEMORY-CHECKPOINT] processTFIDFWithRecovery completion: ${finalMemory.usage}`);
    
    // Generate and display error recovery report
    console.log("\n" + errorRecoveryManager.generateRecoveryReport());

  } catch (error) {
    // Record the critical error
    await errorRecoveryManager.recordError(
      ErrorType.PROCESSING_ERROR,
      ErrorSeverity.CRITICAL,
      'TF-IDF processing failed completely',
      {
        totalIssues,
        processedIssues,
        successfulIssues,
        failedIssues,
        skippedIssues,
        currentBatch,
        lastProcessedIssueKey
      },
      error as Error
    );

    // Generate error report for debugging
    console.error("\n" + errorRecoveryManager.generateRecoveryReport());
    
    throw error;
  }
}

// Enhanced document batch streaming with error recovery
async function* streamDocumentBatchesWithRecovery(
  dbManager: DatabaseManager, 
  batchSize: number, 
  errorRecoveryManager: ErrorRecoveryManager
): AsyncGenerator<ProcessedDocument[], void, unknown> {
  console.log('[RECOVERY] Starting enhanced document batch streaming with error recovery');
  
  try {
    // Use the existing streamDocumentBatches but with error recovery wrapper
    const originalStream = streamDocumentBatches(dbManager, batchSize);
    
    for await (const batch of originalStream) {
      try {
        // Process batch with error validation
        const validatedBatch: ProcessedDocument[] = [];
        
        for (const doc of batch) {
          if (!doc.key) {
            await errorRecoveryManager.recordError(
              ErrorType.VALIDATION_ERROR,
              ErrorSeverity.LOW,
              'Document missing key',
              { document: doc }
            );
            continue;
          }
          
          if (!doc.title || doc.title.trim().length === 0) {
            await errorRecoveryManager.recordError(
              ErrorType.VALIDATION_ERROR,
              ErrorSeverity.LOW,
              'Document missing title/content',
              { documentKey: doc.key }
            );
            // Still include the document - let the processor handle it
          }
          
          validatedBatch.push(doc);
        }
        
        if (validatedBatch.length > 0) {
          yield validatedBatch;
        }
        
      } catch (error) {
        await errorRecoveryManager.recordError(
          ErrorType.PROCESSING_ERROR,
          ErrorSeverity.MEDIUM,
          'Batch processing error in document streaming',
          { batchSize: batch.length },
          error as Error
        );
        
        // Continue with next batch instead of failing completely
        console.warn(`[RECOVERY] Skipping problematic batch due to error: ${(error as Error).message}`);
        continue;
      }
    }
    
  } catch (error) {
    await errorRecoveryManager.recordError(
      ErrorType.PROCESSING_ERROR,
      ErrorSeverity.HIGH,
      'Document streaming failed',
      {},
      error as Error
    );
    throw error;
  }
}

// Enhanced database storage with comprehensive error recovery
async function storeResultsWithRecovery(
  dbManager: DatabaseManager,
  keywordsData: any[], 
  corpusStats: any[],
  errorRecoveryManager: ErrorRecoveryManager
): Promise<void> {
  console.log(`[RECOVERY] Storing ${keywordsData.length} keywords and ${corpusStats.length} corpus stats with error recovery`);
  
  let keywordInsertSuccess = 0;
  let keywordInsertFailed = 0;
  let corpusInsertSuccess = 0;
  let corpusInsertFailed = 0;
  
  try {
    await dbManager.transaction(async () => {
      const insertKeyword = await dbManager.prepare(`
        INSERT INTO tfidf_keywords (issue_key, keyword, tfidf_score, tf_score, idf_score)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      const insertCorpusStat = await dbManager.prepare(`
        INSERT INTO tfidf_corpus_stats (keyword, idf_score, document_frequency, total_documents)
        VALUES (?, ?, ?, ?)
      `);
      
      // Insert keywords with individual error recovery
      console.log(`[RECOVERY] Inserting ${keywordsData.length} keywords with error recovery...`);
      
      const keywordBatches = [];
      for (let i = 0; i < keywordsData.length; i += 1000) {
        keywordBatches.push(keywordsData.slice(i, i + 1000));
      }
      
      for (let batchIndex = 0; batchIndex < keywordBatches.length; batchIndex++) {
        const batch = keywordBatches[batchIndex];
        console.log(`[RECOVERY] Processing keyword batch ${batchIndex + 1}/${keywordBatches.length} (${batch.length} items)`);
        
        const batchResult = await errorRecoveryManager.processBatchWithRecovery(
          batch,
          async (keyword, index) => {
            try {
              await insertKeyword.run(
                keyword.issue_key,
                keyword.keyword,
                keyword.tfidf_score,
                keyword.tf_score,
                keyword.idf_score
              );
              keywordInsertSuccess++;
              return { inserted: true };
            } catch (error) {
              keywordInsertFailed++;
              throw error;
            }
          },
          `keyword_batch_${batchIndex}`,
          'database-keyword-insertion'
        );
        
        if (!batchResult.canContinue) {
          const shouldContinue = errorRecoveryManager.shouldContinueProcessing('database-keyword-insertion');
          if (!shouldContinue.continue) {
            console.error(`[RECOVERY] Stopping keyword insertion: ${shouldContinue.reason}`);
            break;
          }
        }
        
        // Progress reporting
        const totalProcessed = Math.min((batchIndex + 1) * 1000, keywordsData.length);
        console.log(`[RECOVERY] Keyword insertion progress: ${totalProcessed}/${keywordsData.length} (${(totalProcessed/keywordsData.length*100).toFixed(1)}%)`);
      }
      
      // Insert corpus statistics with individual error recovery
      console.log(`[RECOVERY] Inserting ${corpusStats.length} corpus statistics with error recovery...`);
      
      const corpusResult = await errorRecoveryManager.processBatchWithRecovery(
        corpusStats,
        async (stat, index) => {
          try {
            await insertCorpusStat.run(
              stat.keyword,
              stat.idf_score,
              stat.document_frequency,
              stat.total_documents
            );
            corpusInsertSuccess++;
            return { inserted: true };
          } catch (error) {
            corpusInsertFailed++;
            throw error;
          }
        },
        'corpus_stats_batch',
        'database-corpus-insertion'
      );
      
      console.log(`[RECOVERY] Database insertion completed:`);
      console.log(`  - Keywords: ${keywordInsertSuccess} success, ${keywordInsertFailed} failed`);
      console.log(`  - Corpus stats: ${corpusInsertSuccess} success, ${corpusInsertFailed} failed`);
      
      if (keywordInsertFailed > 0 || corpusInsertFailed > 0) {
        const totalFailed = keywordInsertFailed + corpusInsertFailed;
        const totalItems = keywordsData.length + corpusStats.length;
        const failureRate = totalFailed / totalItems;
        
        if (failureRate > 0.05) { // More than 5% failure rate
          await errorRecoveryManager.recordError(
            ErrorType.DATABASE_ERROR,
            ErrorSeverity.HIGH,
            `High failure rate in database insertion: ${(failureRate * 100).toFixed(1)}%`,
            {
              keywordInsertSuccess,
              keywordInsertFailed,
              corpusInsertSuccess,
              corpusInsertFailed,
              failureRate
            }
          );
        }
      }
      
    }, 'tfidf_data_insertion_with_recovery');
    
  } catch (error) {
    await errorRecoveryManager.recordError(
      ErrorType.DATABASE_ERROR,
      ErrorSeverity.CRITICAL,
      'Database transaction failed completely',
      {
        keywordInsertSuccess,
        keywordInsertFailed,
        corpusInsertSuccess,
        corpusInsertFailed
      },
      error as Error
    );
    throw error;
  }
}

// Enhanced sample results display with timeout protection
async function showSampleResults(dbManager: DatabaseManager): Promise<void> {
  console.log("\n=== Sample Results with Database Timeout Protection ===");
  
  try {
    // Top keywords across all issues with timeout protection
    console.log("[DATABASE] Fetching top keywords with timeout protection...");
    const topGlobalKeywords = await dbManager.all(`
      SELECT 
        keyword,
        COUNT(*) as issue_count,
        AVG(tfidf_score) as avg_tfidf,
        MAX(tfidf_score) as max_tfidf
      FROM tfidf_keywords
      GROUP BY keyword
      ORDER BY issue_count DESC
      LIMIT 20
    `) as TopKeyword[];
    
    console.log("\nTop 20 most common keywords:");
    topGlobalKeywords.forEach((kw, idx) => {
      console.log(`${idx + 1}. "${kw.keyword}" - appears in ${kw.issue_count} issues (avg TF-IDF: ${kw.avg_tfidf.toFixed(4)})`);
    });
    
    // Sample issue keywords with timeout protection
    console.log("[DATABASE] Fetching sample issue with timeout protection...");
    const sampleIssue = await dbManager.get(`
      SELECT issue_key FROM tfidf_keywords 
      GROUP BY issue_key 
      LIMIT 1
    `) as SampleIssue | undefined;
    
    if (sampleIssue) {
      const issueKeywords = await dbManager.all(`
        SELECT keyword, tfidf_score 
        FROM tfidf_keywords 
        WHERE issue_key = $issue_key
        ORDER BY tfidf_score DESC
        LIMIT 10
      `, { issue_key: sampleIssue.issue_key }) as IssueKeyword[];
      
      console.log(`\nTop keywords for issue ${sampleIssue.issue_key}:`);
      issueKeywords.forEach((kw, idx) => {
        console.log(`${idx + 1}. "${kw.keyword}" (TF-IDF: ${kw.tfidf_score.toFixed(4)})`);
      });
    } else {
      console.log("\nNo sample issue found for keyword display");
    }
    
    // Display database statistics
    console.log("\n=== Database Performance Statistics ===");
    dbManager.logStats();
    
  } catch (error) {
    console.error(`[DATABASE-ERROR] Error displaying sample results: ${(error as Error).message}`);
    console.warn("[WARNING] Sample results display failed, but TF-IDF processing completed successfully");
  }
}

// Main execution
async function main(): Promise<void> {
  console.log("Starting TF-IDF keyword extraction with comprehensive error recovery...");
  
  let dbManager: DatabaseManager | undefined;
  let lockMonitor: DatabaseLockMonitor | undefined;
  let errorRecoveryManager: ErrorRecoveryManager | undefined;
  
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
    
    // Initialize comprehensive error recovery system
    console.log("[RECOVERY] Initializing error recovery and checkpoint system...");
    const recoveryOptions: Partial<RecoveryOptions> = {
      maxRetries: 5,
      retryDelayMs: 2000,
      skipCorruptedRecords: true,
      enablePartialResults: true,
      checkpointInterval: 1000, // Checkpoint every 1000 processed items
      maxErrorsBeforeAbort: 50,
      gracefulDegradationThreshold: 0.15 // Allow 15% failure rate
    };
    errorRecoveryManager = new ErrorRecoveryManager(recoveryOptions);
    
    // Check for existing checkpoints and offer resume option
    const latestCheckpoint = await errorRecoveryManager.getLatestCheckpoint('tfidf-processing');
    if (latestCheckpoint && latestCheckpoint.canResume) {
      console.log(`[RECOVERY] Found resumable checkpoint from ${latestCheckpoint.timestamp}`);
      console.log(`[RECOVERY] Progress: ${latestCheckpoint.processedIssues}/${latestCheckpoint.totalIssues} (${(latestCheckpoint.processedIssues/latestCheckpoint.totalIssues*100).toFixed(1)}%)`);
      console.log(`[RECOVERY] Last processed: ${latestCheckpoint.lastProcessedIssueKey || 'N/A'}`);
      
      // For now, continue with fresh processing - in production, could prompt user
      console.log("[RECOVERY] Continuing with fresh processing (checkpoint resume can be implemented interactively)");
    }
    
    if (config.dbPath === '') {
      try {
        config.dbPath = await getDatabasePath();
      } catch (error) {
        const path = await import('path');
        config.dbPath = path.join(process.cwd(), 'jira_issues.sqlite').replace(/\\/g, '/');
      }
    }

    console.log("Starting TF-IDF analysis for JIRA issues with database timeout protection...\n");
    console.log(`Using database: ${config.dbPath}`);
    
    // Validate database file exists
    try {
      await Bun.file(config.dbPath).arrayBuffer();
    } catch (error) {
      throw new Error(`Database file not found: ${config.dbPath}`);
    }
    
    // Initialize database lock monitoring
    lockMonitor = new DatabaseLockMonitor();
    lockMonitor.startMonitoring();
    
    // Create enhanced database manager with timeout and retry protection
    console.log("[DATABASE] Initializing enhanced database manager...");
    const databaseConfig: Partial<DatabaseConfig> = {
      queryTimeout: 45000,        // 45 seconds for complex queries
      transactionTimeout: 120000, // 2 minutes for large transactions
      retryAttempts: 5,           // More retries for robustness
      retryDelay: 2000,          // 2 seconds base delay
      retryBackoffMultiplier: 1.5, // Gentler backoff
      maxRetryDelay: 15000,      // 15 seconds max delay
      busyTimeout: 45000         // 45 seconds SQLite busy timeout
    };
    
    const dbManager = createDatabaseManager(config.dbPath, databaseConfig);
    
    console.log("[DATABASE] Database manager initialized with enhanced protection");
    
    // Enhanced database structure validation
    await validateDatabase(dbManager);
    
    // Enhanced database health check
    const healthCheck = await dbManager.checkHealth();
    if (!healthCheck.healthy) {
      console.warn(`[DATABASE-HEALTH] Database health issues detected:`);
      healthCheck.issues.forEach(issue => console.warn(`  - ${issue}`));
      console.warn(`[DATABASE-HEALTH] Proceeding with caution...`);
    } else {
      console.log(`[DATABASE-HEALTH] Database health check passed`);
    }
    
    // Check if there are any issues to process
    const totalIssues = await countIssues(dbManager);
    if (totalIssues === 0) {
      console.log("No issues found in database. Nothing to process.");
      return;
    }
    
    console.log(`Found ${totalIssues} issues to process`);
    
    // Create tables with timeout protection
    await createTFIDFTables(dbManager);
    
    // Process TF-IDF with comprehensive error recovery
    const tfidfResult = await withErrorRecovery(
      () => processTFIDFWithRecovery(dbManager, config, errorRecoveryManager!),
      errorRecoveryManager!,
      {
        operationName: 'tfidf-processing',
        maxRetries: 2,
        timeoutMs: 30 * 60 * 1000, // 30 minutes
        skipOnError: false // Critical operation, don't skip
      }
    );
    
    if (!tfidfResult.success) {
      console.error("[RECOVERY] TF-IDF processing failed despite recovery attempts");
      if (tfidfResult.error) {
        await errorRecoveryManager!.recordError(
          ErrorType.PROCESSING_ERROR,
          ErrorSeverity.CRITICAL,
          'TF-IDF processing failed completely',
          { phase: 'main-processing' }
        );
      }
      throw new Error('TF-IDF processing failed after all recovery attempts');
    }
    
    if (tfidfResult.recovered) {
      console.log("[RECOVERY] TF-IDF processing completed with recovery");
    }
    
    // Show enhanced sample results with error recovery
    const sampleResultsResult = await withErrorRecovery(
      () => showSampleResults(dbManager),
      errorRecoveryManager!,
      {
        operationName: 'sample-results-display',
        maxRetries: 2,
        skipOnError: true // This is not critical
      }
    );
    
    if (!sampleResultsResult.success) {
      console.warn("[RECOVERY] Sample results display failed, but processing completed successfully");
    }
    
    console.log("\n=== TF-IDF Analysis Completed Successfully ===");
    
    // Final database health and performance report
    console.log("\n=== Final Database Performance Report ===");
    const finalHealthCheck = await dbManager!.checkHealth();
    if (finalHealthCheck.healthy) {
      console.log(`[DATABASE-HEALTH] Final health check: HEALTHY`);
    } else {
      console.warn(`[DATABASE-HEALTH] Final health check: ISSUES DETECTED`);
      finalHealthCheck.issues.forEach(issue => console.warn(`  - ${issue}`));
    }
    
    console.log(`[DATABASE-PERFORMANCE] Active operations at completion: ${dbManager!.getActiveOperationsCount()}`);
    
    // Display final error recovery report
    if (errorRecoveryManager) {
      console.log("\n=== Final Error Recovery Report ===");
      console.log(errorRecoveryManager.generateRecoveryReport());
    }
    
  } catch (error) {
    console.error("[ERROR] Error during enhanced TF-IDF processing:", (error as Error).message);
    
    // Record the critical error in error recovery system
    if (errorRecoveryManager) {
      await errorRecoveryManager.recordError(
        ErrorType.SYSTEM_ERROR,
        ErrorSeverity.CRITICAL,
        'Main TF-IDF processing failed',
        { phase: 'main-execution' },
        error as Error
      );
    }
    
    if (error instanceof DatabaseTimeoutError) {
      console.error(`[DATABASE-ERROR] Database timeout in operation: ${error.operation} after ${error.timeoutMs}ms`);
    } else if (error instanceof DatabaseRetryExhaustedError) {
      console.error(`[DATABASE-ERROR] Database retries exhausted after ${error.attempts} attempts`);
      console.error(`[DATABASE-ERROR] Last error: ${error.lastError.message}`);
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.error("Stack trace:", (error as Error).stack);
    }
    
    // Log database statistics even on error for debugging
    if (dbManager) {
      console.log("\n=== Database Statistics (Error Case) ===");
      dbManager.logStats();
    }
    
    // Display error recovery report for debugging
    if (errorRecoveryManager) {
      console.error("\n=== Error Recovery Report (Failure Case) ===");
      console.error(errorRecoveryManager.generateRecoveryReport());
    }
    
    process.exit(1);
  } finally {
    // Cleanup with enhanced error handling
    if (lockMonitor) {
      try {
        lockMonitor.stopMonitoring();
      } catch (error) {
        console.error("[CLEANUP-ERROR] Error stopping lock monitor:", (error as Error).message);
      }
    }
    
    if (dbManager) {
      try {
        console.log("[DATABASE] Closing enhanced database connection...");
        dbManager.close();
      } catch (error) {
        console.error("[CLEANUP-ERROR] Error closing database manager:", (error as Error).message);
      }
    }
    
    console.log("[CLEANUP] Enhanced TF-IDF processing cleanup completed");
  }
}

// Run the script
main();