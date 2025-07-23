import natural from 'natural';
import { removeStopwords } from 'stopword';

// Type definitions for TF-IDF processing
export interface TFIDFOptions {
  minDocumentFrequency?: number;
  maxDocumentFrequency?: number;
  minTermLength?: number;
  maxTermLength?: number;
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
   */
  private cleanText(text: string): string {
    try {
      if (!text || typeof text !== 'string') {
        return '';
      }
      
      // Handle very large text by truncating
      if (text.length > 50000) {
        text = text.substring(0, 50000);
      }
      
      return text
        // Remove HTML entities
        .replace(/&[a-zA-Z]+;/g, ' ')
        // Remove HTML tags
        .replace(/<[^>]*>/g, ' ')
        // Replace multiple whitespace with single space
        .replace(/\s+/g, ' ')
        // Remove special characters but keep hyphens and underscores for technical terms
        .replace(/[^\w\s\-_.]/g, ' ')
        .trim();
    } catch (error) {
      console.warn(`Error cleaning text: ${(error as Error).message}`);
      return '';
    }
  }

  /**
   * Check if a token is valid for inclusion in the corpus
   */
  private isValidToken(token: string): boolean {
    // Check length constraints
    if (token.length < this.minTermLength || token.length > this.maxTermLength) return false;
    
    // Skip pure numbers
    if (/^\d+$/.test(token)) return false;
    
    // Skip tokens that are only special characters
    if (/^[^a-z0-9]+$/i.test(token)) return false;
    
    // Skip common meaningless tokens
    if (['http', 'https', 'www', 'com', 'org', 'net'].includes(token)) return false;
    
    // Keep tokens with alphanumeric characters
    if (/[a-z0-9]/i.test(token)) return true;
    
    return false;
  }

  /**
   * Process FHIR-specific terms
   */
  private processFHIRTerms(tokens: string[]): string[] {
    return tokens.map(token => {
      // Preserve FHIR resource names (expanded list)
      if (token.match(/^(patient|observation|procedure|condition|medication|encounter|practitioner|organization|device|diagnostic|immunization|allergyintolerance|careplan|careteam|goal|location|endpoint|healthcareservice|schedule|slot|appointment|bundle|composition|documentreference|binary|media|list|library|measure|questionnaire|questionnaireresponse|subscription|communication|communicationrequest|claim|claimresponse|coverage|eligibilityrequest|eligibilityresponse|enrollmentrequest|enrollmentresponse|explanationofbenefit|paymentnotice|paymentreconciliation|valueSet|codesystem|conceptmap|structuredefinition|implementationguide|searchparameter|operationdefinition|conformance|capabilitystatement|structuremap|graphdefinition|messagedefinition|eventdefinition|activitydefinition|plandefinition|task|provenance|auditEvent|consent|contract|person|relatedperson|group|bodystructure|substance|substancespecification|substanceprotein|substancereferenceinformation|substancesourcematerial|medicationknowledge|medicationrequest|medicationadministration|medicationdispense|medicationstatement|detectedissue|adverseevent|researchstudy|researchsubject|riskassessment|clinicalimpression|flag|familymemberhistory|molecularsequence|imagingstudy|diagnosticreport|specimen|bodysite|imagingmanifest|imagingobjectselection|imagingexcerpt|medicinalproduct|medicinalproductauthorization|medicinalproductcontraindication|medicinalproductindication|medicinalproductingredient|medicinalproductinteraction|medicinalproductmanufactured|medicinalproductpackaged|medicinalproductpharmaceutical|medicinalproductundesirableeffect|devicedefinition|devicemetric|devicecomponent|deviceuserequest|deviceusestatement|devicerequest|supplyrequest|supplydelivery|inventoryreport|linkage|requestgroup|nutritionorder|visionprescription|invoice|account|chargeitem|chargeitemdefinition|contract|person|relatedperson|group)$/i)) {
        return token.toUpperCase();
      }
      
      // Preserve version identifiers
      if (token.match(/^(r4|r5|stu3|dstu2|r4b|r3)$/i)) {
        return token.toUpperCase();
      }
      
      // Preserve common FHIR operations
      if (token.match(/^\$(expand|validate|lookup|subsumes|compose|translate|populate|extract|document|transform|closure|conforms|member-match|lastn|stats|snapshot|diff|apply|meta|meta-add|meta-delete|process-message|convert|graphql|evaluate|evaluate-measure|collect|submit|batch|transaction|history|search|update|patch|delete|create|read|vread|capabilities|batch)$/)) {
        return token;
      }
      
      // Preserve FHIR data types
      if (token.match(/^(string|boolean|integer|decimal|uri|url|canonical|base64binary|instant|date|datetime|time|code|oid|id|markdown|unsignedint|positiveint|uuid|identifier|humanname|address|contactpoint|timing|duration|period|range|ratio|sampleddata|attachment|coding|codeableconcept|quantity|money|age|count|distance|signature|annotation|reference|narrative|extension|dosage|contactdetail|contributor|datarequirement|parameterdefinition|relatedartifact|triggerdefinition|usagecontext|meta|element|resource|domainresource|backboneelement|primitivetype|element)$/i)) {
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
        console.warn(`Document with ID '${id}' already exists, skipping`);
        return;
      }
      
      const tokens = this.preprocessText(text);
      
      // Skip documents with no meaningful tokens
      if (tokens.length === 0) {
        console.warn(`Document '${id}' has no meaningful tokens, skipping`);
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
   * Build corpus from documents in streaming fashion to handle large datasets
   */
  buildCorpusStreaming(documentBatches: Iterable<ProcessableDocument[]>, batchSize: number = 1000): void {
    let totalProcessed = 0;
    
    for (const batch of documentBatches) {
      // Process batch
      batch.forEach(doc => {
        const text = this.combineTextFields(doc);
        this.addDocument(doc.key || doc.id || '', text, doc);
      });
      
      totalProcessed += batch.length;
      
      // Periodic memory cleanup and progress reporting
      if (totalProcessed % (batchSize * 10) === 0) {
        this.performMemoryCleanup();
        console.log(`Processed ${totalProcessed} documents...`);
      }
    }
    
    console.log(`Total documents processed: ${totalProcessed}`);
    this.calculateCorpusStats();
  }

  /**
   * Perform memory cleanup by removing unused references
   */
  private performMemoryCleanup(): void {
    // Force garbage collection hint
    if (global.gc) {
      global.gc();
    }
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
}