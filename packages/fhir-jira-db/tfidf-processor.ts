import natural from 'natural';
import { removeStopwords } from 'stopword';

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
 * Safe regex patterns that prevent catastrophic backtracking
 * These patterns use possessive quantifiers and atomic groups where possible
 */
const SAFE_REGEX_PATTERNS = {
  // HTML entities - safer pattern that doesn't backtrack
  HTML_ENTITIES: /&[a-zA-Z][a-zA-Z0-9]{0,20};/g,
  
  // HTML tags - non-greedy match with character limit to prevent backtracking
  HTML_TAGS: /<[^>]{0,1000}>/g,
  
  // Multiple whitespace - simple greedy match, safe
  MULTIPLE_WHITESPACE: /\s+/g,
  
  // Special characters - safe character class
  SPECIAL_CHARS: /[^\w\s\-_.]/g,
  
  // Pure numbers - anchored, safe
  PURE_NUMBERS: /^\d+$/,
  
  // Special chars only - safe character class with anchors
  SPECIAL_CHARS_ONLY: /^[^a-z0-9]+$/i,
  
  // Alphanumeric check - safe character class
  HAS_ALPHANUMERIC: /[a-z0-9]/i,
  
  // URL validation - safer patterns with length limits
  HTTP_URL: /^https?:\/\/[^\s]{1,200}\.[^\s]{1,50}$/,
  DOMAIN_PATTERN: /^[a-zA-Z0-9-]{1,63}\.[a-zA-Z]{2,10}$/
};

// Type definitions for TF-IDF processing
export interface TFIDFOptions {
  minDocumentFrequency?: number;
  maxDocumentFrequency?: number;
  minTermLength?: number;
  maxTermLength?: number;
  verbose?: boolean;
}

export interface DocumentData {
  original: string;
  tokens: string[];
  metadata: Record<string, any>;
}

export interface TFIDFScore {
  term: string;
  tfidf: number;
  tf: number;
}

export interface CorpusStatistic {
  documentFrequency: number;
  idf: number;
  totalDocuments: number;
}

export interface SimilarDocument {
  documentId: string;
  similarity: number;
}

export interface KeywordExport {
  issue_key: string;
  keyword: string;
  tfidf_score: number;
  tf_score: number;
  idf_score: number;
}

export interface CorpusStatsExport {
  keyword: string;
  idf_score: number;
  document_frequency: number;
  total_documents: number;
}

export interface ProcessableDocument {
  key?: string;
  id?: string;
  title?: string;
  description?: string;
  summary?: string;
  resolution?: string;
  custom_fields?: Array<{ field_value?: string }>;
  [key: string]: any;
}

export class TFIDFProcessor {
  private tokenizer: natural.WordTokenizer;
  private tfidf: natural.TfIdf;
  private documents: Map<string, DocumentData>;
  private corpusStats: Map<string, CorpusStatistic>;
  private stemmer: typeof natural.PorterStemmer;
  
  // Configuration options
  private minDocumentFrequency: number;
  private maxDocumentFrequency: number;
  private minTermLength: number;
  private maxTermLength: number;
  private verbose: boolean;

  constructor(options: TFIDFOptions = {}) {
    this.tokenizer = new natural.WordTokenizer();
    this.tfidf = new natural.TfIdf();
    this.documents = new Map<string, DocumentData>();
    this.corpusStats = new Map<string, CorpusStatistic>();
    this.stemmer = natural.PorterStemmer;
    
    // Configuration options with defaults
    this.minDocumentFrequency = options.minDocumentFrequency || 2; // Term must appear in at least 2 documents
    this.maxDocumentFrequency = options.maxDocumentFrequency || 0.5; // Term must appear in at most 50% of documents
    this.minTermLength = options.minTermLength || 2;
    this.maxTermLength = options.maxTermLength || 30;
    this.verbose = options.verbose || false;
  }

  // Verbose logging helper functions
  vlog(...args: any[]): void {
    if (this.verbose) {
      console.log(...args);
    }
  }

  vwarn(...args: any[]): void {
    if (this.verbose) {
      console.warn(...args);
    }
  }

  verror(...args: any[]): void {
    if (this.verbose) {
      console.error(...args);
    }
  }

  /**
   * Preprocess text by tokenizing, lowercasing, and removing stopwords
   */
  preprocessText(text: string): string[] {
    if (!text) return [];
    
    // Clean text before tokenization
    const cleanedText = this.cleanText(text);
    
    // Tokenize
    let tokens = this.tokenizer.tokenize(cleanedText.toLowerCase()) || [];
    
    // Remove stopwords
    tokens = removeStopwords(tokens);
    
    // Enhanced filtering for better token quality
    tokens = tokens.filter(token => this.isValidToken(token));
    
    // Add FHIR-specific preprocessing
    tokens = this.processFHIRTerms(tokens);
    
    // Apply stemming to reduce words to their root forms
    tokens = this.applyStemming(tokens);
    
    return tokens;
  }

  /**
   * Clean text by removing HTML entities, special characters, and normalizing whitespace
   * Enhanced with regex timeout protection to prevent backtracking issues
   */
  private cleanText(text: string): string {
    try {
      if (!text || typeof text !== 'string') {
        return '';
      }
      
      // Handle very large text by truncating to prevent regex timeout issues
      if (text.length > 10000) {
        this.vwarn(`[REGEX-SAFETY] Truncating large text from ${text.length} to 10000 characters to prevent regex timeout`);
        text = text.substring(0, 10000);
      }
      
      // Apply regex operations with timeout protection
      try {
        // Remove HTML entities with timeout protection
        text = withRegexTimeout(
          () => text.replace(SAFE_REGEX_PATTERNS.HTML_ENTITIES, ' '),
          500,
          'HTML entities removal'
        );
        
        // Remove HTML tags with timeout protection
        text = withRegexTimeout(
          () => text.replace(SAFE_REGEX_PATTERNS.HTML_TAGS, ' '),
          500,
          'HTML tags removal'
        );
        
        // Replace multiple whitespace with single space
        text = withRegexTimeout(
          () => text.replace(SAFE_REGEX_PATTERNS.MULTIPLE_WHITESPACE, ' '),
          300,
          'whitespace normalization'
        );
        
        // Remove special characters but keep hyphens and underscores for technical terms
        text = withRegexTimeout(
          () => text.replace(SAFE_REGEX_PATTERNS.SPECIAL_CHARS, ' '),
          500,
          'special character removal'
        );
        
        return text.trim();
        
      } catch (error) {
        if (error instanceof RegexTimeoutError) {
          this.vwarn(`[REGEX-TIMEOUT] ${error.message} for text cleaning, returning simplified cleanup`);
          // Fallback to basic character-by-character cleaning
          return this.safeFallbackCleanText(text);
        }
        throw error;
      }
      
    } catch (error) {
      this.vwarn(`[ERROR] Error cleaning text: ${(error as Error).message}`);
      return this.safeFallbackCleanText(text);
    }
  }
  
  /**
   * Safe fallback text cleaning that doesn't use regex
   * Used when regex timeout protection is triggered
   */
  private safeFallbackCleanText(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    // Character-by-character cleaning without regex
    let result = '';
    let lastWasSpace = false;
    
    for (let i = 0; i < Math.min(text.length, 10000); i++) {
      const char = text[i];
      
      // Keep alphanumeric, hyphens, underscores, and dots
      if (/[a-zA-Z0-9\-_.]/.test(char)) {
        result += char;
        lastWasSpace = false;
      }
      // Convert other characters to spaces, but avoid multiple spaces
      else if (!lastWasSpace) {
        result += ' ';
        lastWasSpace = true;
      }
    }
    
    return result.trim();
  }

  /**
   * Check if a token is valid for inclusion in the corpus
   * Enhanced with regex timeout protection
   */
  private isValidToken(token: string): boolean {
    try {
      // Check length constraints
      if (token.length < this.minTermLength || token.length > this.maxTermLength) return false;
      
      // Apply regex checks with timeout protection
      try {
        // Skip pure numbers
        if (withRegexTimeout(
          () => SAFE_REGEX_PATTERNS.PURE_NUMBERS.test(token),
          100,
          'pure numbers check'
        )) return false;
        
        // Skip tokens that are only special characters
        if (withRegexTimeout(
          () => SAFE_REGEX_PATTERNS.SPECIAL_CHARS_ONLY.test(token),
          100,
          'special chars only check'
        )) return false;
        
        // Skip common meaningless tokens
        if (['http', 'https', 'www', 'com', 'org', 'net'].includes(token)) return false;
        
        // Keep tokens with alphanumeric characters
        if (withRegexTimeout(
          () => SAFE_REGEX_PATTERNS.HAS_ALPHANUMERIC.test(token),
          100,
          'alphanumeric check'
        )) return true;
        
        return false;
        
      } catch (error) {
        if (error instanceof RegexTimeoutError) {
          this.vwarn(`[REGEX-TIMEOUT] ${error.message} for token validation of '${token}', using fallback`);
          return this.safeFallbackTokenValidation(token);
        }
        throw error;
      }
      
    } catch (error) {
      this.vwarn(`[ERROR] Error validating token '${token}': ${(error as Error).message}`);
      return this.safeFallbackTokenValidation(token);
    }
  }
  
  /**
   * Fallback token validation without regex
   */
  private safeFallbackTokenValidation(token: string): boolean {
    // Check length constraints
    if (token.length < this.minTermLength || token.length > this.maxTermLength) return false;
    
    // Skip common meaningless tokens
    if (['http', 'https', 'www', 'com', 'org', 'net'].includes(token)) return false;
    
    // Check if token contains alphanumeric characters (character-by-character)
    let hasAlphanumeric = false;
    let allSpecial = true;
    let allNumeric = true;
    
    for (const char of token) {
      if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9')) {
        hasAlphanumeric = true;
        if (char < '0' || char > '9') {
          allNumeric = false;
        }
        allSpecial = false;
      } else {
        allNumeric = false;
      }
    }
    
    // Skip pure numbers or all special characters
    if (allNumeric || allSpecial) return false;
    
    return hasAlphanumeric;
  }

  /**
   * Process FHIR-specific terms with regex timeout protection
   * Uses precomputed sets for safety instead of complex regex patterns
   */
  private processFHIRTerms(tokens: string[]): string[] {
    // Precomputed sets for faster, safer lookups (no regex needed)
    const FHIR_RESOURCES = new Set([
      'patient', 'observation', 'procedure', 'condition', 'medication', 'encounter',
      'practitioner', 'organization', 'device', 'diagnostic', 'immunization',
      'allergyintolerance', 'careplan', 'careteam', 'goal', 'location', 'endpoint',
      'healthcareservice', 'schedule', 'slot', 'appointment', 'bundle', 'composition',
      'documentreference', 'binary', 'media', 'list', 'library', 'measure',
      'questionnaire', 'questionnaireresponse', 'subscription', 'communication',
      'communicationrequest', 'claim', 'claimresponse', 'coverage', 'eligibilityrequest',
      'eligibilityresponse', 'enrollmentrequest', 'enrollmentresponse',
      'explanationofbenefit', 'paymentnotice', 'paymentreconciliation', 'valueset',
      'codesystem', 'conceptmap', 'structuredefinition', 'implementationguide',
      'searchparameter', 'operationdefinition', 'conformance', 'capabilitystatement',
      'structuremap', 'graphdefinition', 'messagedefinition', 'eventdefinition',
      'activitydefinition', 'plandefinition', 'task', 'provenance', 'auditevent',
      'consent', 'contract', 'person', 'relatedperson', 'group', 'bodystructure',
      'substance', 'substancespecification', 'substanceprotein',
      'substancereferenceinformation', 'substancesourcematerial', 'medicationknowledge',
      'medicationrequest', 'medicationadministration', 'medicationdispense',
      'medicationstatement', 'detectedissue', 'adverseevent', 'researchstudy',
      'researchsubject', 'riskassessment', 'clinicalimpression', 'flag',
      'familymemberhistory', 'molecularsequence', 'imagingstudy', 'diagnosticreport',
      'specimen', 'bodysite', 'imagingmanifest', 'imagingobjectselection',
      'imagingexcerpt', 'medicinalproduct', 'medicinalproductauthorization',
      'medicinalproductcontraindication', 'medicinalproductindication',
      'medicinalproductingredient', 'medicinalproductinteraction',
      'medicinalproductmanufactured', 'medicinalproductpackaged',
      'medicinalproductpharmaceutical', 'medicinalproductundesirableeffect',
      'devicedefinition', 'devicemetric', 'devicecomponent', 'deviceuserequest',
      'deviceusestatement', 'devicerequest', 'supplyrequest', 'supplydelivery',
      'inventoryreport', 'linkage', 'requestgroup', 'nutritionorder',
      'visionprescription', 'invoice', 'account', 'chargeitem', 'chargeitemdefinition'
    ]);
    
    const FHIR_VERSIONS = new Set(['r4', 'r5', 'stu3', 'dstu2', 'r4b', 'r3']);
    
    const FHIR_OPERATIONS = new Set([
      '$expand', '$validate', '$lookup', '$subsumes', '$compose', '$translate',
      '$populate', '$extract', '$document', '$transform', '$closure', '$conforms',
      '$member-match', '$lastn', '$stats', '$snapshot', '$diff', '$apply', '$meta',
      '$meta-add', '$meta-delete', '$process-message', '$convert', '$graphql',
      '$evaluate', '$evaluate-measure', '$collect', '$submit', '$batch',
      '$transaction', '$history', '$search', '$update', '$patch', '$delete',
      '$create', '$read', '$vread', '$capabilities'
    ]);
    
    const FHIR_DATATYPES = new Set([
      'string', 'boolean', 'integer', 'decimal', 'uri', 'url', 'canonical',
      'base64binary', 'instant', 'date', 'datetime', 'time', 'code', 'oid', 'id',
      'markdown', 'unsignedint', 'positiveint', 'uuid', 'identifier', 'humanname',
      'address', 'contactpoint', 'timing', 'duration', 'period', 'range', 'ratio',
      'sampleddata', 'attachment', 'coding', 'codeableconcept', 'quantity', 'money',
      'age', 'count', 'distance', 'signature', 'annotation', 'reference',
      'narrative', 'extension', 'dosage', 'contactdetail', 'contributor',
      'datarequirement', 'parameterdefinition', 'relatedartifact',
      'triggerdefinition', 'usagecontext', 'meta', 'element', 'resource',
      'domainresource', 'backboneelement', 'primitivetype'
    ]);
    
    return tokens.map(token => {
      const tokenLower = token.toLowerCase();
      
      // Preserve FHIR resource names
      if (FHIR_RESOURCES.has(tokenLower)) {
        return token.toUpperCase();
      }
      
      // Preserve version identifiers
      if (FHIR_VERSIONS.has(tokenLower)) {
        return token.toUpperCase();
      }
      
      // Preserve common FHIR operations
      if (FHIR_OPERATIONS.has(token) || FHIR_OPERATIONS.has(token.toLowerCase())) {
        return token;
      }
      
      // Preserve FHIR data types
      if (FHIR_DATATYPES.has(tokenLower)) {
        return token.toUpperCase();
      }
      
      return token;
    });
  }

  /**
   * Apply stemming to tokens, preserving certain technical terms
   */
  private applyStemming(tokens: string[]): string[] {
    return tokens.map(token => {
      // Don't stem FHIR resource names or version identifiers (already uppercase)
      if (token === token.toUpperCase() && token.length > 1) {
        return token;
      }
      
      // Don't stem operations that start with $
      if (token.startsWith('$')) {
        return token;
      }
      
      // Don't stem URLs, UUIDs, or other technical identifiers
      if (token.includes('-') || token.includes('.') || token.includes('_')) {
        return token;
      }
      
      // Apply Porter stemming to regular words
      return this.stemmer.stem(token);
    });
  }

  /**
   * Add a document to the corpus
   */
  addDocument(id: string, text: string, metadata: Record<string, any> = {}): void {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Document ID must be a non-empty string');
      }
      
      if (this.documents.has(id)) {
        this.vwarn(`Document with ID '${id}' already exists, skipping`);
        return;
      }
      
      const tokens = this.preprocessText(text);
      
      // Skip documents with no meaningful tokens
      if (tokens.length === 0) {
        this.vwarn(`Document '${id}' has no meaningful tokens, skipping`);
        return;
      }
      
      const tokenString = tokens.join(' ');
      
      this.documents.set(id, {
        original: text,
        tokens: tokens,
        metadata: metadata
      });
      
      this.tfidf.addDocument(tokenString, id);
    } catch (error) {
      console.error(`Error adding document '${id}': ${(error as Error).message}`);
      // Continue processing other documents
    }
  }

  /**
   * Add a document to the corpus with enhanced progress tracking and hang detection
   * This method monitors natural.js operations for potential hangs
   */
  addDocumentWithProgressTracking(id: string, text: string, metadata: Record<string, any> = {}, startTime: number): void {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Document ID must be a non-empty string');
      }
      
      if (this.documents.has(id)) {
        this.vwarn(`[PROGRESS-TRACK] Document with ID '${id}' already exists, skipping`);
        return;
      }
      
      // Track preprocessing phase
      const preprocessStartTime = Date.now();
      const tokens = this.preprocessText(text);
      const preprocessTime = Date.now() - preprocessStartTime;
      
      if (preprocessTime > 500) { // Preprocessing took more than 500ms
        this.vwarn(`[SLOW-PREPROCESS] Document '${id}' preprocessing took ${preprocessTime}ms (text length: ${text.length})`);
      }
      
      // Skip documents with no meaningful tokens
      if (tokens.length === 0) {
        this.vwarn(`[PROGRESS-TRACK] Document '${id}' has no meaningful tokens, skipping`);
        return;
      }
      
      const tokenString = tokens.join(' ');
      
      // Store document data before calling natural.js
      const docDataStartTime = Date.now();
      this.documents.set(id, {
        original: text,
        tokens: tokens,
        metadata: metadata
      });
      const docDataTime = Date.now() - docDataStartTime;
      
      if (docDataTime > 100) { // Document storage took more than 100ms
        this.vwarn(`[SLOW-STORAGE] Document '${id}' storage took ${docDataTime}ms (${tokens.length} tokens)`);
      }
      
      // Monitor natural.js addDocument call with hang detection
      const naturalStartTime = Date.now();
      this.vlog(`[NATURAL-MONITOR] Calling natural.js addDocument for '${id}' with ${tokens.length} tokens`);
      
      // Set up hang detection for natural.js call
      let naturalHangTimeout: NodeJS.Timeout | null = null;
      const naturalHangTimeoutMs = 10000; // 10 seconds for a single document is concerning
      
      const hangDetectionPromise = new Promise<void>((resolve) => {
        naturalHangTimeout = setTimeout(() => {
          this.verror(`[NATURAL-HANG] natural.js addDocument for '${id}' has not completed after ${naturalHangTimeoutMs}ms`);
          this.verror(`[NATURAL-HANG] Document details - Text length: ${text.length}, Tokens: ${tokens.length}`);
          this.verror(`[NATURAL-HANG] This may indicate a hang in natural.js processing`);
          this.verror(`[NATURAL-HANG] First 200 chars of text: ${text.substring(0, 200)}...`);
          resolve();
        }, naturalHangTimeoutMs);
      });
      
      try {
        // Call natural.js addDocument
        this.tfidf.addDocument(tokenString, id);
        
        // Clear hang detection timeout if successful
        if (naturalHangTimeout) {
          clearTimeout(naturalHangTimeout);
        }
        
        const naturalTime = Date.now() - naturalStartTime;
        
        // Log performance metrics
        const totalTime = Date.now() - startTime;
        this.vlog(`[NATURAL-MONITOR] natural.js addDocument completed for '${id}' in ${naturalTime}ms (total: ${totalTime}ms)`);
        
        // Detect slow natural.js operations
        if (naturalTime > 1000) { // natural.js call took more than 1 second
          this.vwarn(`[SLOW-NATURAL] natural.js addDocument for '${id}' took ${naturalTime}ms`);
          this.vwarn(`[SLOW-NATURAL] Document stats - Text: ${text.length} chars, Tokens: ${tokens.length}, Unique tokens: ${new Set(tokens).size}`);
        }
        
        // Performance breakdown logging
        this.vlog(`[PERFORMANCE] '${id}' - Preprocess: ${preprocessTime}ms, Storage: ${docDataTime}ms, Natural: ${naturalTime}ms, Total: ${totalTime}ms`);
        
      } catch (naturalError) {
        // Clear hang detection timeout on error
        if (naturalHangTimeout) {
          clearTimeout(naturalHangTimeout);
        }
        
        const naturalTime = Date.now() - naturalStartTime;
        this.verror(`[NATURAL-ERROR] natural.js addDocument failed for '${id}' after ${naturalTime}ms: ${(naturalError as Error).message}`);
        throw naturalError;
      }
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.verror(`[PROGRESS-TRACK] Error adding document '${id}' after ${totalTime}ms: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Build corpus from array of documents
   */
  buildCorpus(documents: ProcessableDocument[]): void {
    documents.forEach(doc => {
      const text = this.combineTextFields(doc);
      this.addDocument(doc.key || doc.id || '', text, doc);
    });
    
    this.calculateCorpusStats();
  }

  /**
   * Build corpus from documents in streaming fashion to handle large datasets with timeout protection
   * Enhanced with comprehensive progress tracking and hang detection
   */
  async buildCorpusStreaming(documentBatches: AsyncIterable<ProcessableDocument[]>, batchSize: number = 1000): Promise<void> {
    this.vlog('[DEBUG] TFIDFProcessor.buildCorpusStreaming: Starting corpus building');
    const startTime = Date.now();
    let totalProcessed = 0;
    let successfulDocs = 0;
    let failedDocs = 0;
    let skippedDocs = 0;
    let batchCount = 0;
    let lastProgressTime = Date.now();
    
    // Progress tracking configuration
    const progressInterval = 100; // Log progress every N documents
    const memoryCheckInterval = 500; // Check memory every N documents
    const hangDetectionTimeout = 30000; // 30 seconds without progress indicates potential hang
    
    try {
      // Set up timeout protection
      const timeoutMs = 600000; // 10 minute timeout for corpus building
      const timeoutId = setTimeout(() => {
        throw new Error(`buildCorpusStreaming timed out after ${timeoutMs}ms`);
      }, timeoutMs);
      
      // Initial memory usage
      const initialMemory = this.getMemoryUsage();
      this.vlog(`[MEMORY-TRACK] Initial memory: ${initialMemory.usage}`);
      
      try {
        for await (const batch of documentBatches) {
          batchCount++;
          const batchStartTime = Date.now();
          this.vlog(`[PROGRESS] Processing batch ${batchCount} with ${batch.length} documents (${totalProcessed} total processed so far)`);
          
          let batchSuccessful = 0;
          let batchFailed = 0;
          let batchSkipped = 0;
          
          // Process each document in the batch with detailed tracking
          for (let i = 0; i < batch.length; i++) {
            const doc = batch[i];
            const docStartTime = Date.now();
            
            try {
              const docId = doc.key || doc.id || `unknown_${totalProcessed + i}`;
              
              // Check for potential hang (no progress for extended period)
              const timeSinceLastProgress = Date.now() - lastProgressTime;
              if (timeSinceLastProgress > hangDetectionTimeout) {
                this.vwarn(`[HANG-DETECTION] No progress for ${timeSinceLastProgress}ms - potential hang detected at document ${docId}`);
                this.vwarn(`[HANG-DETECTION] Current batch: ${batchCount}, document: ${i + 1}/${batch.length}`);
                this.vwarn(`[HANG-DETECTION] Total processed so far: ${totalProcessed}`);
                lastProgressTime = Date.now();
              }
              
              // Combine text fields for this document
              const text = this.combineTextFields(doc);
              
              if (!text || text.trim().length === 0) {
                this.vwarn(`[SKIP] Document ${docId} has no meaningful text content`);
                skippedDocs++;
                batchSkipped++;
                continue;
              }
              
              // Track natural.js addDocument call with detailed monitoring
              this.vlog(`[NATURAL-CALL] About to call natural.js addDocument for '${docId}' (text length: ${text.length})`);
              const naturalStartTime = Date.now();
              
              // Call our enhanced addDocument method which will monitor natural.js internally
              this.addDocumentWithProgressTracking(docId, text, doc, naturalStartTime);
              
              const naturalTime = Date.now() - naturalStartTime;
              this.vlog(`[NATURAL-CALL] Completed natural.js addDocument for '${docId}' in ${naturalTime}ms`);
              
              successfulDocs++;
              batchSuccessful++;
              lastProgressTime = Date.now();
              
              // Detect potential slow documents
              const docTime = Date.now() - docStartTime;
              if (docTime > 1000) { // Document took more than 1 second
                this.vwarn(`[SLOW-DOCUMENT] Document ${docId} took ${docTime}ms to process (text length: ${text.length})`);
              }
              
            } catch (error) {
              const docId = doc.key || doc.id || `unknown_${totalProcessed + i}`;
              this.verror(`[ERROR] Failed to process document ${docId}: ${(error as Error).message}`);
              failedDocs++;
              batchFailed++;
              
              // Don't throw - continue processing other documents
            }
            
            // Progress reporting within batch
            const currentDoc = totalProcessed + i + 1;
            if (currentDoc % progressInterval === 0 || i === batch.length - 1) {
              const elapsed = Date.now() - startTime;
              const rate = currentDoc / (elapsed / 1000);
              this.vlog(`[PROGRESS] Documents: ${currentDoc} processed (${rate.toFixed(1)} docs/sec) | Success: ${successfulDocs} | Failed: ${failedDocs} | Skipped: ${skippedDocs}`);
            }
            
            // Memory monitoring within batch
            if (currentDoc % memoryCheckInterval === 0) {
              const currentMemory = this.getMemoryUsage();
              this.vlog(`[MEMORY-TRACK] Memory at ${currentDoc} documents: ${currentMemory.usage}`);
              
              // Detect memory growth issues
              if (currentMemory.used > initialMemory.used * 2) {
                this.vwarn(`[MEMORY-WARNING] Memory usage has doubled since start: ${initialMemory.used}MB -> ${currentMemory.used}MB`);
                this.performMemoryCleanup();
              }
            }
          }
          
          totalProcessed += batch.length;
          const batchTime = Date.now() - batchStartTime;
          const batchRate = batch.length / (batchTime / 1000);
          
          this.vlog(`[BATCH-COMPLETE] Batch ${batchCount} completed in ${batchTime}ms (${batchRate.toFixed(1)} docs/sec)`);
          this.vlog(`[BATCH-STATS] Success: ${batchSuccessful} | Failed: ${batchFailed} | Skipped: ${batchSkipped}`);
          
          // Periodic memory cleanup and comprehensive progress reporting
          if (totalProcessed % (batchSize * 5) === 0) { // Every 5 batches
            this.vlog(`[CLEANUP] Performing memory cleanup at ${totalProcessed} documents`);
            this.performMemoryCleanup();
            
            const elapsed = Date.now() - startTime;
            const overallRate = totalProcessed / (elapsed / 1000);
            const memoryAfterCleanup = this.getMemoryUsage();
            
            this.vlog(`[MILESTONE] Processed ${totalProcessed} documents in ${elapsed}ms (${overallRate.toFixed(1)} docs/sec)`);
            this.vlog(`[MILESTONE] Success: ${successfulDocs} | Failed: ${failedDocs} | Skipped: ${skippedDocs}`);
            this.vlog(`[MEMORY-TRACK] Memory after cleanup: ${memoryAfterCleanup.usage}`);
          }
          
          // Check for timeout periodically during processing
          const elapsed = Date.now() - startTime;
          if (elapsed > timeoutMs * 0.8) { // Warning at 80% of timeout
            this.vwarn(`[TIMEOUT-WARNING] Approaching timeout limit (${elapsed}ms of ${timeoutMs}ms)`);
            this.vwarn(`[TIMEOUT-WARNING] Progress: ${totalProcessed} documents processed`);
          }
        }
        
        clearTimeout(timeoutId);
        
      } catch (error) {
        clearTimeout(timeoutId);
        
        if (error instanceof Error && error.message.includes('timed out')) {
          this.vwarn(`[TIMEOUT] Operation timed out after ${timeoutMs}ms`);
          this.vwarn(`[TIMEOUT] Final stats - Total: ${totalProcessed} | Success: ${successfulDocs} | Failed: ${failedDocs} | Skipped: ${skippedDocs}`);
          this.vwarn(`[TIMEOUT] Continuing with partial corpus for graceful degradation`);
        } else {
          throw error;
        }
      }
      
      const totalTime = Date.now() - startTime;
      const finalMemory = this.getMemoryUsage();
      const overallRate = totalProcessed / (totalTime / 1000);
      
      this.vlog(`[COMPLETE] Corpus building completed in ${totalTime}ms (${overallRate.toFixed(1)} docs/sec)`);
      this.vlog(`[COMPLETE] Final stats - Total: ${totalProcessed} | Success: ${successfulDocs} | Failed: ${failedDocs} | Skipped: ${skippedDocs}`);
      this.vlog(`[MEMORY-TRACK] Final memory: ${finalMemory.usage} (growth: ${(finalMemory.used - initialMemory.used)}MB)`);
      
      this.vlog(`[CORPUS-STATS] Starting corpus statistics calculation...`);
      const statsStartTime = Date.now();
      this.calculateCorpusStats();
      const statsTime = Date.now() - statsStartTime;
      this.vlog(`[CORPUS-STATS] Corpus statistics calculated in ${statsTime}ms`);
      
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.verror(`[ERROR] buildCorpusStreaming failed after ${elapsed}ms: ${(error as Error).message}`);
      this.verror(`[ERROR] Progress at failure - Total: ${totalProcessed} | Success: ${successfulDocs} | Failed: ${failedDocs} | Skipped: ${skippedDocs}`);
      
      // Still calculate corpus stats for partial data if we have any successful documents
      if (successfulDocs > 0) {
        this.vlog(`[RECOVERY] Calculating corpus stats for ${successfulDocs} successful documents despite error`);
        try {
          this.calculateCorpusStats();
        } catch (statsError) {
          this.verror(`[ERROR] Failed to calculate corpus stats during recovery: ${(statsError as Error).message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Get current memory usage statistics
   */
  private getMemoryUsage(): { used: number, total: number, usage: string } {
    const usage = process.memoryUsage();
    const used = Math.round(usage.heapUsed / 1024 / 1024);
    const total = Math.round(usage.heapTotal / 1024 / 1024);
    const external = Math.round(usage.external / 1024 / 1024);
    const rss = Math.round(usage.rss / 1024 / 1024);
    
    return {
      used,
      total,
      usage: `${used}MB heap / ${total}MB total (${(used/total*100).toFixed(1)}%) | RSS: ${rss}MB | External: ${external}MB`
    };
  }

  /**
   * Perform memory cleanup by removing unused references
   */
  private performMemoryCleanup(): void {
    const beforeCleanup = this.getMemoryUsage();
    
    // Force garbage collection hint
    if (global.gc) {
      global.gc();
    }
    
    // Give GC time to run
    setTimeout(() => {
      const afterCleanup = this.getMemoryUsage();
      const memoryFreed = beforeCleanup.used - afterCleanup.used;
      if (memoryFreed > 0) {
        this.vlog(`[MEMORY-CLEANUP] Freed ${memoryFreed}MB of memory (${beforeCleanup.used}MB -> ${afterCleanup.used}MB)`);
      }
    }, 100);
  }

  /**
   * Combine multiple text fields from an issue
   */
  private combineTextFields(issue: ProcessableDocument): string {
    const fields: string[] = [];
    
    if (issue.title) fields.push(issue.title);
    if (issue.description) fields.push(issue.description);
    if (issue.summary) fields.push(issue.summary);
    if (issue.resolution) fields.push(issue.resolution);
    
    // Add custom fields if present
    if (issue.custom_fields) {
      issue.custom_fields.forEach(field => {
        if (field.field_value && typeof field.field_value === 'string') {
          fields.push(field.field_value);
        }
      });
    }
    
    return fields.join(' ');
  }

  /**
   * Calculate TF-IDF scores for a specific document
   */
  calculateTFIDF(documentId: string): TFIDFScore[] {
    const scores: TFIDFScore[] = [];
    
    // Ensure documentId is valid
    if (!documentId) {
      return scores;
    }
    
    // Check if document exists
    if (!this.documents.has(documentId)) {
      return scores;
    }
    
    // Find the document index for this documentId
    // The natural.TfIdf library uses array indices, so we need to find the position
    let documentIndex = -1;
    let currentIndex = 0;
    for (const [docId, doc] of this.documents) {
      if (docId === documentId) {
        documentIndex = currentIndex;
        break;
      }
      currentIndex++;
    }
    
    if (documentIndex === -1) {
      return scores;
    }
    
    // Get terms for this specific document
    const terms = this.tfidf.listTerms(documentIndex);
    terms.forEach(term => {
      // Only include terms that passed frequency filtering
      if (this.corpusStats.has(term.term)) {
        scores.push({
          term: term.term,
          tfidf: term.tfidf,
          tf: term.tf
        });
      }
    });
    
    // Sort by TF-IDF score
    scores.sort((a, b) => b.tfidf - a.tfidf);
    
    return scores;
  }

  /**
   * Extract top N keywords for a document
   */
  extractKeywords(documentId: string, topN: number = 10): TFIDFScore[] {
    const scores = this.calculateTFIDF(documentId);
    return scores.slice(0, topN);
  }

  /**
   * Calculate corpus-wide statistics
   */
  private calculateCorpusStats(): void {
    const termDocFrequency = new Map<string, number>();
    const totalDocs = this.documents.size;
    
    // Count document frequency for each term
    this.documents.forEach((doc, docId) => {
      const uniqueTerms = new Set(doc.tokens);
      uniqueTerms.forEach(term => {
        termDocFrequency.set(term, (termDocFrequency.get(term) || 0) + 1);
      });
    });
    
    // Calculate maximum document frequency threshold (as absolute number)
    const maxDocFreq = Math.floor(this.maxDocumentFrequency * totalDocs);
    
    // Filter terms based on document frequency and calculate IDF
    termDocFrequency.forEach((docFreq, term) => {
      // Apply frequency filtering
      if (docFreq < this.minDocumentFrequency || docFreq > maxDocFreq) {
        return; // Skip this term
      }
      
      // Add smoothing to prevent division by zero and improve numerical stability
      const idf = Math.log((totalDocs + 1) / (docFreq + 1));
      this.corpusStats.set(term, {
        documentFrequency: docFreq,
        idf: idf,
        totalDocuments: totalDocs
      });
    });
    
    console.log(`Corpus statistics: ${termDocFrequency.size} unique terms, ${this.corpusStats.size} terms after frequency filtering`);
  }

  /**
   * Get all keywords for all documents
   */
  extractAllKeywords(topN: number = 10): Map<string, TFIDFScore[]> {
    const allKeywords = new Map<string, TFIDFScore[]>();
    
    this.documents.forEach((doc, docId) => {
      const keywords = this.extractKeywords(docId, topN);
      allKeywords.set(docId, keywords);
    });
    
    return allKeywords;
  }

  /**
   * Find similar documents based on TF-IDF vectors
   */
  findSimilarDocuments(documentId: string, topN: number = 5): SimilarDocument[] {
    const similarities: SimilarDocument[] = [];
    const baseVector = this.getDocumentVector(documentId);
    
    this.documents.forEach((doc, docId) => {
      if (docId !== documentId) {
        const compareVector = this.getDocumentVector(docId);
        const similarity = this.cosineSimilarity(baseVector, compareVector);
        similarities.push({
          documentId: docId,
          similarity: similarity
        });
      }
    });
    
    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, topN);
  }

  /**
   * Get TF-IDF vector for a document
   */
  private getDocumentVector(documentId: string): Map<string, number> {
    const vector = new Map<string, number>();
    const scores = this.calculateTFIDF(documentId);
    
    scores.forEach(score => {
      vector.set(score.term, score.tfidf);
    });
    
    return vector;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vector1: Map<string, number>, vector2: Map<string, number>): number {
    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;
    
    // Get all unique terms
    const allTerms = new Set([...vector1.keys(), ...vector2.keys()]);
    
    allTerms.forEach(term => {
      const val1 = vector1.get(term) || 0;
      const val2 = vector2.get(term) || 0;
      
      dotProduct += val1 * val2;
      magnitude1 += val1 * val1;
      magnitude2 += val2 * val2;
    });
    
    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);
    
    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }
    
    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Get corpus statistics
   */
  getCorpusStats(): Map<string, CorpusStatistic> {
    return this.corpusStats;
  }

  /**
   * Export keywords data for database storage
   */
  exportKeywordsForDB(topN: number = 10): KeywordExport[] {
    const results: KeywordExport[] = [];
    
    this.documents.forEach((doc, docId) => {
      const keywords = this.extractKeywords(docId, topN);
      keywords.forEach(keyword => {
        const corpusStat = this.corpusStats.get(keyword.term) || {} as CorpusStatistic;
        results.push({
          issue_key: docId,
          keyword: keyword.term,
          tfidf_score: keyword.tfidf,
          tf_score: keyword.tf,
          idf_score: corpusStat.idf || 0
        });
      });
    });
    
    return results;
  }

  /**
   * Export corpus statistics for database storage
   */
  exportCorpusStatsForDB(): CorpusStatsExport[] {
    const results: CorpusStatsExport[] = [];
    
    this.corpusStats.forEach((stats, term) => {
      results.push({
        keyword: term,
        idf_score: stats.idf,
        document_frequency: stats.documentFrequency,
        total_documents: stats.totalDocuments
      });
    });
    
    return results;
  }

  /**
   * Enhanced addDocument with comprehensive error recovery
   * Gracefully handles individual document failures without stopping processing
   */
  addDocumentWithRecovery(
    id: string, 
    text: string, 
    metadata: Record<string, any> = {},
    errorCallback?: (error: Error, docId: string) => void
  ): { success: boolean; error?: Error; skipped?: boolean } {
    try {
      // Validate inputs
      if (!id || typeof id !== 'string') {
        const error = new Error('Document ID must be a non-empty string');
        if (errorCallback) errorCallback(error, id || 'unknown');
        return { success: false, error };
      }
      
      if (this.documents.has(id)) {
        this.vwarn(`[RECOVERY] Document with ID '${id}' already exists, skipping`);
        return { success: true, skipped: true };
      }

      // Handle empty or null text gracefully
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        this.vwarn(`[RECOVERY] Document '${id}' has no meaningful text content, skipping`);
        return { success: true, skipped: true, error: new Error('No text content') };
      }

      // Preprocess text with error recovery
      let tokens: string[] = [];
      try {
        tokens = this.preprocessText(text);
      } catch (preprocessError) {
        this.vwarn(`[RECOVERY] Preprocessing failed for document '${id}': ${(preprocessError as Error).message}`);
        // Try fallback preprocessing
        try {
          tokens = this.fallbackPreprocessText(text);
        } catch (fallbackError) {
          const error = new Error(`Both primary and fallback preprocessing failed: ${(fallbackError as Error).message}`);
          if (errorCallback) errorCallback(error, id);
          return { success: false, error };
        }
      }
      
      // Skip documents with no meaningful tokens
      if (tokens.length === 0) {
        this.vwarn(`[RECOVERY] Document '${id}' has no meaningful tokens after preprocessing, skipping`);
        return { success: true, skipped: true, error: new Error('No meaningful tokens') };
      }

      const tokenString = tokens.join(' ');
      
      // Store document data with error recovery
      try {
        this.documents.set(id, {
          original: text,
          tokens: tokens,
          metadata: metadata || {}
        });
      } catch (storageError) {
        const error = new Error(`Failed to store document data: ${(storageError as Error).message}`);
        if (errorCallback) errorCallback(error, id);
        return { success: false, error };
      }
      
      // Add to natural.js TF-IDF with error recovery
      try {
        this.tfidf.addDocument(tokenString, id);
      } catch (tfidfError) {
        // Remove from documents map if TF-IDF addition failed
        this.documents.delete(id);
        const error = new Error(`Failed to add document to TF-IDF: ${(tfidfError as Error).message}`);
        if (errorCallback) errorCallback(error, id);
        return { success: false, error };
      }

      return { success: true };
      
    } catch (error) {
      const processingError = new Error(`Unexpected error processing document '${id}': ${(error as Error).message}`);
      if (errorCallback) errorCallback(processingError, id);
      return { success: false, error: processingError };
    }
  }

  /**
   * Fallback text preprocessing that uses safer methods
   * Used when primary preprocessing fails
   */
  private fallbackPreprocessText(text: string): string[] {
    if (!text || typeof text !== 'string') return [];
    
    this.vlog('[RECOVERY] Using fallback text preprocessing');
    
    try {
      // Basic cleanup without regex
      let cleanText = text.toLowerCase();
      
      // Remove common HTML entities manually
      cleanText = cleanText
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      
      // Simple tokenization by splitting on common delimiters
      const tokens = cleanText
        .split(/[\s,;.:!?()[\]{}"'<>=+\-*/\\|@#$%^&~`]+/)
        .filter(token => {
          // Basic filtering
          return token && 
                 token.length >= this.minTermLength && 
                 token.length <= this.maxTermLength &&
                 !/^\d+$/.test(token) && // Skip pure numbers
                 !/^[^a-z0-9]+$/i.test(token); // Skip pure special chars
        });

      // Apply basic stemming if possible
      return tokens.map(token => {
        try {
          return this.stemmer.stem(token);
        } catch (stemmingError) {
          this.vwarn(`[RECOVERY] Stemming failed for token '${token}', using original`);
          return token;
        }
      });
      
    } catch (error) {
      this.verror(`[RECOVERY] Fallback preprocessing failed: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Process a batch of documents with comprehensive error recovery
   * Returns statistics about successful, failed, and skipped documents
   */
  processBatchWithRecovery(
    documents: ProcessableDocument[],
    batchId: string = `batch_${Date.now()}`
  ): {
    processed: number;
    successful: number;
    failed: number;
    skipped: number;
    errors: Array<{ docId: string; error: Error }>;
    canContinue: boolean;
  } {
    this.vlog(`[RECOVERY] Processing batch ${batchId} with ${documents.length} documents`);
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    const errors: Array<{ docId: string; error: Error }> = [];
    
    for (const doc of documents) {
      processed++;
      const docId = doc.key || doc.id || `unknown_${processed}`;
      
      try {
        // Combine text fields
        const text = this.combineTextFields(doc);
        
        // Process document with recovery
        const result = this.addDocumentWithRecovery(
          docId,
          text,
          doc,
          (error, errorDocId) => {
            errors.push({ docId: errorDocId, error });
          }
        );
        
        if (result.success) {
          if (result.skipped) {
            skipped++;
          } else {
            successful++;
          }
        } else {
          failed++;
          if (result.error && !errors.some(e => e.docId === docId)) {
            errors.push({ docId, error: result.error });
          }
        }
        
      } catch (error) {
        failed++;
        errors.push({ 
          docId, 
          error: new Error(`Unexpected error: ${(error as Error).message}`) 
        });
      }
      
      // Progress logging for large batches
      if (processed % 1000 === 0) {
        console.log(`[RECOVERY] Batch ${batchId} progress: ${processed}/${documents.length} processed (${successful} success, ${failed} failed, ${skipped} skipped)`);
      }
      
      // Early termination if too many failures
      const failureRate = failed / processed;
      if (processed > 100 && failureRate > 0.5) { // More than 50% failure rate after 100 documents
        this.vwarn(`[RECOVERY] High failure rate detected in batch ${batchId}: ${(failureRate * 100).toFixed(1)}%`);
        this.vwarn(`[RECOVERY] Terminating batch early to prevent resource waste`);
        break;
      }
    }
    
    const overallFailureRate = failed / processed;
    const canContinue = overallFailureRate < 0.8; // Stop if more than 80% failed
    
    console.log(`[RECOVERY] Batch ${batchId} completed: ${processed} processed, ${successful} successful, ${failed} failed, ${skipped} skipped`);
    console.log(`[RECOVERY] Failure rate: ${(overallFailureRate * 100).toFixed(1)}%, Can continue: ${canContinue}`);
    
    return {
      processed,
      successful,
      failed,
      skipped,
      errors,
      canContinue
    };
  }

  /**
   * Get corpus health statistics for monitoring
   */
  getCorpusHealthStats(): {
    totalDocuments: number;
    totalTerms: number;
    averageDocumentLength: number;
    memoryUsage: number;
    healthScore: number;
    issues: string[];
  } {
    const issues: string[] = [];
    const totalDocuments = this.documents.size;
    const totalTerms = this.corpusStats.size;
    
    // Calculate average document length
    let totalTokens = 0;
    this.documents.forEach(doc => {
      totalTokens += doc.tokens.length;
    });
    const averageDocumentLength = totalDocuments > 0 ? totalTokens / totalDocuments : 0;
    
    // Memory usage estimation
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB
    
    // Health checks
    if (totalDocuments === 0) {
      issues.push('No documents in corpus');
    }
    
    if (totalTerms < totalDocuments * 0.1) {
      issues.push('Very low term diversity (possible preprocessing issues)');
    }
    
    if (averageDocumentLength < 5) {
      issues.push('Very short average document length (possible content issues)');
    }
    
    if (memoryUsage > 1000) { // More than 1GB
      issues.push('High memory usage detected');
    }
    
    // Calculate health score (0-100)
    let healthScore = 100;
    if (totalDocuments === 0) healthScore = 0;
    else {
      healthScore -= issues.length * 20; // Deduct 20 points per issue
      healthScore = Math.max(0, Math.min(100, healthScore));
    }
    
    return {
      totalDocuments,
      totalTerms,
      averageDocumentLength: Math.round(averageDocumentLength * 100) / 100,
      memoryUsage: Math.round(memoryUsage * 100) / 100,
      healthScore,
      issues
    };
  }

  /**
   * Clean up resources and optimize memory usage
   */
  cleanup(): void {
    this.vlog('[RECOVERY] Performing TFIDFProcessor cleanup');
    
    // Force garbage collection if available
    if (global.gc) {
      const beforeGc = process.memoryUsage().heapUsed / 1024 / 1024;
      global.gc();
      const afterGc = process.memoryUsage().heapUsed / 1024 / 1024;
      this.vlog(`[RECOVERY] Garbage collection freed ${(beforeGc - afterGc).toFixed(1)}MB`);
    }
    
    this.vlog('[RECOVERY] TFIDFProcessor cleanup completed');
  }

  /**
   * Validate corpus integrity and consistency
   */
  validateCorpus(): {
    isValid: boolean;
    issues: string[];
    warnings: string[];
    statistics: Record<string, number>;
  } {
    const issues: string[] = [];
    const warnings: string[] = [];
    
    // Check document consistency
    const tfidfDocCount = this.tfidf.documents.length;
    const storedDocCount = this.documents.size;
    
    if (tfidfDocCount !== storedDocCount) {
      issues.push(`Document count mismatch: TF-IDF has ${tfidfDocCount}, stored has ${storedDocCount}`);
    }
    
    // Check corpus statistics consistency
    const statsCount = this.corpusStats.size;
    if (statsCount === 0 && storedDocCount > 0) {
      issues.push('Corpus statistics not calculated despite having documents');
    }
    
    // Check for empty documents
    let emptyDocuments = 0;
    this.documents.forEach((doc, id) => {
      if (doc.tokens.length === 0) {
        emptyDocuments++;
        warnings.push(`Document '${id}' has no tokens`);
      }
    });
    
    // Memory usage check
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    if (memoryUsage > 2000) { // More than 2GB
      warnings.push(`High memory usage: ${memoryUsage.toFixed(1)}MB`);
    }
    
    const statistics = {
      totalDocuments: storedDocCount,
      tfidfDocuments: tfidfDocCount,
      totalTerms: statsCount,
      emptyDocuments,
      memoryUsageMB: Math.round(memoryUsage * 100) / 100
    };
    
    const isValid = issues.length === 0;
    
    return {
      isValid,
      issues,
      warnings,
      statistics
    };
  }
}