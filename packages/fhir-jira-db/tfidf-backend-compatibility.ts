import natural from 'natural';
import { removeStopwords } from 'stopword';
import { 
  PureTFIDF, 
  NodeTFIDFCompatible, 
  LightweightTFIDF, 
  TFIDFAlternativeOptions,
  TFIDFResult 
} from './tfidf-alternatives.ts';

/**
 * TF-IDF Backend Compatibility Layer
 * 
 * This module provides a unified interface for different TF-IDF implementations,
 * allowing seamless switching between natural.js, pure JavaScript implementations,
 * and other alternatives based on runtime compatibility or performance requirements.
 */

export type TFIDFBackend = 'natural' | 'pure' | 'node-compatible' | 'lightweight';

export interface BackendCapabilities {
  backend: TFIDFBackend;
  name: string;
  description: string;
  features: {
    stemming: boolean;
    stopwordRemoval: boolean;
    tokenization: boolean;
    cosineSimalirity: boolean;
    memoryEfficient: boolean;
    performanceOptimized: boolean;
  };
  dependencies: string[];
  bunCompatible: boolean;
  nodeCompatible: boolean;
}

export interface TFIDFBackendOptions extends TFIDFAlternativeOptions {
  preferredBackend?: TFIDFBackend;
  fallbackBackends?: TFIDFBackend[];
  autoFallback?: boolean;
}

export interface UnifiedTFIDFResult {
  term: string;
  tfidf: number;
  tf: number;
  idf?: number;
  documentId: string;
}

/**
 * Unified TF-IDF Interface
 * 
 * Provides a consistent API across different TF-IDF implementations with automatic
 * fallback capabilities for maximum compatibility and reliability.
 */
export class UnifiedTFIDFProcessor {
  private backend: TFIDFBackend;
  private processor: any;
  private options: Required<TFIDFBackendOptions>;
  private documents: Map<string, string> = new Map();
  private documentOrder: string[] = [];

  constructor(options: TFIDFBackendOptions = {}) {
    this.options = {
      preferredBackend: options.preferredBackend || 'natural',
      fallbackBackends: options.fallbackBackends || ['pure', 'node-compatible', 'lightweight'],
      autoFallback: options.autoFallback !== false,
      minDocumentFrequency: options.minDocumentFrequency || 2,
      maxDocumentFrequency: options.maxDocumentFrequency || 0.5,
      minTermLength: options.minTermLength || 2,
      maxTermLength: options.maxTermLength || 30,
      stemming: options.stemming || false,
      normalization: options.normalization || 'l2'
    };

    this.backend = this.initializeBackend();
  }

  /**
   * Initialize the TF-IDF backend with fallback support
   */
  private initializeBackend(): TFIDFBackend {
    const backendsToTry = [this.options.preferredBackend, ...this.options.fallbackBackends];
    
    for (const backend of backendsToTry) {
      try {
        console.log(`[TFIDF-BACKEND] Attempting to initialize ${backend} backend...`);
        this.processor = this.createBackendProcessor(backend);
        console.log(`[TFIDF-BACKEND] Successfully initialized ${backend} backend`);
        return backend;
      } catch (error) {
        console.warn(`[TFIDF-BACKEND] Failed to initialize ${backend} backend: ${(error as Error).message}`);
        if (!this.options.autoFallback) {
          throw error;
        }
      }
    }

    throw new Error('All TF-IDF backends failed to initialize');
  }

  /**
   * Create a backend processor instance
   */
  private createBackendProcessor(backend: TFIDFBackend): any {
    switch (backend) {
      case 'natural':
        return this.createNaturalProcessor();
      
      case 'pure':
        return new PureTFIDF(this.options);
      
      case 'node-compatible':
        return new NodeTFIDFCompatible(this.options);
      
      case 'lightweight':
        return new LightweightTFIDF();
      
      default:
        throw new Error(`Unsupported backend: ${backend}`);
    }
  }

  /**
   * Create natural.js processor with error handling
   */
  private createNaturalProcessor(): any {
    try {
      // Test natural.js availability and basic functionality
      const testTfidf = new natural.TfIdf();
      testTfidf.addDocument('test document');
      
      return {
        tfidf: new natural.TfIdf(),
        tokenizer: new natural.WordTokenizer(),
        stemmer: natural.PorterStemmer,
        type: 'natural'
      };
    } catch (error) {
      throw new Error(`Natural.js initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * Add a document to the corpus
   */
  addDocument(id: string, text: string, metadata: Record<string, any> = {}): void {
    try {
      if (!id || !text) {
        console.warn(`[UNIFIED-TFIDF] Skipping invalid document: ${id}`);
        return;
      }

      // Store document for potential backend switching
      this.documents.set(id, text);
      if (!this.documentOrder.includes(id)) {
        this.documentOrder.push(id);
      }

      // Add to current backend
      switch (this.backend) {
        case 'natural':
          this.addToNaturalBackend(id, text);
          break;
        
        case 'pure':
          (this.processor as PureTFIDF).addDocument(id, text);
          break;
        
        case 'node-compatible':
          (this.processor as NodeTFIDFCompatible).addDocument(text, id);
          break;
        
        case 'lightweight':
          const tokens = this.tokenizeText(text);
          (this.processor as LightweightTFIDF).addDocument(tokens);
          break;
        
        default:
          throw new Error(`Unsupported backend: ${this.backend}`);
      }
    } catch (error) {
      console.error(`[UNIFIED-TFIDF] Error adding document ${id} to ${this.backend} backend: ${(error as Error).message}`);
      
      if (this.options.autoFallback) {
        this.attemptBackendFallback();
        // Retry with new backend
        this.addDocument(id, text, metadata);
      } else {
        throw error;
      }
    }
  }

  /**
   * Add document to natural.js backend with preprocessing
   */
  private addToNaturalBackend(id: string, text: string): void {
    const tokens = this.tokenizeText(text);
    const tokenString = tokens.join(' ');
    this.processor.tfidf.addDocument(tokenString, id);
  }

  /**
   * Simple tokenization for lightweight backend
   */
  private tokenizeText(text: string): string[] {
    if (!text || typeof text !== 'string') return [];
    
    // Basic tokenization
    const tokens = text.toLowerCase()
      .replace(/[^\w\s\-_.]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length >= this.options.minTermLength && 
                      token.length <= this.options.maxTermLength)
      .filter(token => !/^\d+$/.test(token));
    
    // Remove stopwords
    return removeStopwords(tokens);
  }

  /**
   * Calculate TF-IDF scores for a document
   */
  calculateTFIDF(documentId: string): UnifiedTFIDFResult[] {
    try {
      switch (this.backend) {
        case 'natural':
          return this.calculateNaturalTFIDF(documentId);
        
        case 'pure':
          return this.convertPureTFIDFResults((this.processor as PureTFIDF).getDocumentTFIDF(documentId));
        
        case 'node-compatible':
          return this.calculateNodeCompatibleTFIDF(documentId);
        
        case 'lightweight':
          return this.calculateLightweightTFIDF(documentId);
        
        default:
          throw new Error(`Unsupported backend: ${this.backend}`);
      }
    } catch (error) {
      console.error(`[UNIFIED-TFIDF] Error calculating TF-IDF for ${documentId} with ${this.backend} backend: ${(error as Error).message}`);
      
      if (this.options.autoFallback) {
        this.attemptBackendFallback();
        return this.calculateTFIDF(documentId);
      }
      
      throw error;
    }
  }

  /**
   * Calculate TF-IDF using natural.js backend
   */
  private calculateNaturalTFIDF(documentId: string): UnifiedTFIDFResult[] {
    const results: UnifiedTFIDFResult[] = [];
    
    // Find the document index
    let documentIndex = -1;
    let currentIndex = 0;
    for (const docId of this.documentOrder) {
      if (docId === documentId) {
        documentIndex = currentIndex;
        break;
      }
      currentIndex++;
    }
    
    if (documentIndex === -1) {
      return results;
    }
    
    // Get terms for this document
    const terms = this.processor.tfidf.listTerms(documentIndex);
    terms.forEach((term: any) => {
      results.push({
        term: term.term,
        tfidf: term.tfidf,
        tf: term.tf || 0,
        idf: undefined, // Natural.js doesn't expose IDF separately
        documentId
      });
    });
    
    return results.sort((a, b) => b.tfidf - a.tfidf);
  }

  /**
   * Convert PureTFIDF results to unified format
   */
  private convertPureTFIDFResults(results: TFIDFResult[]): UnifiedTFIDFResult[] {
    return results.map(result => ({
      term: result.term,
      tfidf: result.tfidf,
      tf: result.tf,
      idf: result.idf,
      documentId: result.documentId
    }));
  }

  /**
   * Calculate TF-IDF using node-compatible backend
   */
  private calculateNodeCompatibleTFIDF(documentId: string): UnifiedTFIDFResult[] {
    const documentIndex = this.documentOrder.indexOf(documentId);
    if (documentIndex === -1) return [];

    const terms = (this.processor as NodeTFIDFCompatible).listTerms(documentIndex);
    
    return terms.map(term => ({
      term: term.term,
      tfidf: term.tfidf,
      tf: 0, // Node-compatible doesn't expose TF separately
      idf: undefined,
      documentId
    })).sort((a, b) => b.tfidf - a.tfidf);
  }

  /**
   * Calculate TF-IDF using lightweight backend
   */
  private calculateLightweightTFIDF(documentId: string): UnifiedTFIDFResult[] {
    const documentIndex = this.documentOrder.indexOf(documentId);
    if (documentIndex === -1) return [];

    const vector = (this.processor as LightweightTFIDF).getDocumentVector(documentIndex);
    const results: UnifiedTFIDFResult[] = [];

    vector.forEach((tfidf, term) => {
      results.push({
        term,
        tfidf,
        tf: 0, // Lightweight doesn't expose TF separately
        idf: undefined,
        documentId
      });
    });

    return results.sort((a, b) => b.tfidf - a.tfidf);
  }

  /**
   * Get top N keywords for a document
   */
  extractKeywords(documentId: string, topN: number = 10): UnifiedTFIDFResult[] {
    return this.calculateTFIDF(documentId).slice(0, topN);
  }

  /**
   * Attempt to fallback to another backend
   */
  private attemptBackendFallback(): void {
    const currentBackendIndex = [this.options.preferredBackend, ...this.options.fallbackBackends].indexOf(this.backend);
    const remainingBackends = this.options.fallbackBackends.slice(currentBackendIndex);
    
    if (remainingBackends.length === 0) {
      throw new Error('No more backends available for fallback');
    }
    
    console.log(`[UNIFIED-TFIDF] Attempting fallback from ${this.backend} to ${remainingBackends[0]}`);
    
    // Switch to next backend
    const newBackend = remainingBackends[0];
    this.processor = this.createBackendProcessor(newBackend);
    this.backend = newBackend;
    
    // Re-add all documents to new backend
    console.log(`[UNIFIED-TFIDF] Re-adding ${this.documents.size} documents to ${newBackend} backend`);
    const documentsToReadd = new Map(this.documents);
    this.documents.clear();
    this.documentOrder = [];
    
    documentsToReadd.forEach((text, id) => {
      this.addDocument(id, text);
    });
    
    console.log(`[UNIFIED-TFIDF] Successfully switched to ${newBackend} backend`);
  }

  /**
   * Get current backend information
   */
  getBackendInfo(): BackendCapabilities {
    return this.getBackendCapabilities(this.backend);
  }

  /**
   * Get capabilities for a specific backend
   */
  getBackendCapabilities(backend: TFIDFBackend): BackendCapabilities {
    switch (backend) {
      case 'natural':
        return {
          backend: 'natural',
          name: 'Natural.js',
          description: 'Full-featured NLP library with comprehensive TF-IDF support',
          features: {
            stemming: true,
            stopwordRemoval: true,
            tokenization: true,
            cosineSimalirity: true,
            memoryEfficient: false,
            performanceOptimized: false
          },
          dependencies: ['natural'],
          bunCompatible: true,
          nodeCompatible: true
        };
      
      case 'pure':
        return {
          backend: 'pure',
          name: 'Pure JavaScript TF-IDF',
          description: 'Custom TF-IDF implementation with no external dependencies',
          features: {
            stemming: true,
            stopwordRemoval: true,
            tokenization: true,
            cosineSimalirity: true,
            memoryEfficient: true,
            performanceOptimized: true
          },
          dependencies: ['stopword'],
          bunCompatible: true,
          nodeCompatible: true
        };
      
      case 'node-compatible':
        return {
          backend: 'node-compatible',
          name: 'Node-TFIDF Compatible',
          description: 'API-compatible with node-tfidf package',
          features: {
            stemming: true,
            stopwordRemoval: true,
            tokenization: true,
            cosineSimalirity: false,
            memoryEfficient: true,
            performanceOptimized: true
          },
          dependencies: ['stopword'],
          bunCompatible: true,
          nodeCompatible: true
        };
      
      case 'lightweight':
        return {
          backend: 'lightweight',
          name: 'Lightweight TF-IDF',
          description: 'Minimal TF-IDF implementation for maximum performance',
          features: {
            stemming: false,
            stopwordRemoval: false,
            tokenization: false,
            cosineSimalirity: false,
            memoryEfficient: true,
            performanceOptimized: true
          },
          dependencies: [],
          bunCompatible: true,
          nodeCompatible: true
        };
      
      default:
        throw new Error(`Unknown backend: ${backend}`);
    }
  }

  /**
   * List all available backends
   */
  listAvailableBackends(): BackendCapabilities[] {
    const backends: TFIDFBackend[] = ['natural', 'pure', 'node-compatible', 'lightweight'];
    return backends.map(backend => this.getBackendCapabilities(backend));
  }

  /**
   * Test backend compatibility
   */
  async testBackendCompatibility(backend: TFIDFBackend): Promise<{success: boolean, error?: string, performance?: number}> {
    const startTime = Date.now();
    
    try {
      console.log(`[BACKEND-TEST] Testing ${backend} backend compatibility...`);
      
      // Create test processor
      const testProcessor = this.createBackendProcessor(backend);
      
      // Test basic operations
      const testDoc = "This is a test document for TF-IDF processing with various terms.";
      
      switch (backend) {
        case 'natural':
          testProcessor.tfidf.addDocument(testDoc);
          // Test retrieval
          const naturalTerms = testProcessor.tfidf.listTerms(0);
          break;
        case 'pure':
          testProcessor.addDocument('test', testDoc);
          // Test retrieval
          const pureResults = testProcessor.getDocumentTFIDF('test');
          break;
        case 'node-compatible':
          testProcessor.addDocument(testDoc, 'test');
          // Test retrieval
          const nodeResults = testProcessor.listTerms(0);
          break;
        case 'lightweight':
          testProcessor.addDocument(['test', 'document', 'tfidf', 'processing', 'various', 'terms']);
          // Test retrieval
          const lightResults = testProcessor.getDocumentVector(0);
          break;
      }
      
      const performance = Math.max(Date.now() - startTime, 1); // Ensure at least 1ms to avoid zero performance
      console.log(`[BACKEND-TEST] ${backend} backend test successful (${performance}ms)`);
      
      return { success: true, performance };
      
    } catch (error) {
      console.error(`[BACKEND-TEST] ${backend} backend test failed: ${(error as Error).message}`);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get corpus statistics
   */
  getCorpusStats() {
    return {
      backend: this.backend,
      totalDocuments: this.documents.size,
      backendInfo: this.getBackendInfo()
    };
  }
}