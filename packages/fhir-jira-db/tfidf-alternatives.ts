import { removeStopwords } from 'stopword';

/**
 * TF-IDF Alternatives Implementation for Bun Compatibility
 * 
 * This module provides alternative TF-IDF implementations that serve as fallbacks
 * for natural.js when encountering compatibility issues or performance bottlenecks.
 * 
 * Features:
 * - Pure JavaScript implementation (no external dependencies)
 * - Node-tfidf-compatible API
 * - Bun-optimized performance
 * - TypeScript support
 * - Compatibility layer for different TF-IDF backends
 */

// Type definitions for compatibility with existing TFIDFProcessor
export interface TFIDFAlternativeOptions {
  minDocumentFrequency?: number;
  maxDocumentFrequency?: number;
  minTermLength?: number;
  maxTermLength?: number;
  stemming?: boolean;
  normalization?: 'l1' | 'l2' | 'none';
}

export interface DocumentStats {
  id: string;
  termCount: number;
  uniqueTerms: number;
  maxTermFrequency: number;
}

export interface TermStats {
  term: string;
  documentFrequency: number;
  idf: number;
  totalOccurrences: number;
}

export interface TFIDFResult {
  term: string;
  tfidf: number;
  tf: number;
  idf: number;
  documentId: string;
}

/**
 * Pure JavaScript TF-IDF Implementation
 * 
 * A lightweight, dependency-free TF-IDF calculator optimized for Bun runtime.
 * This implementation provides the core functionality without relying on natural.js
 * or other heavy NLP libraries.
 */
export class PureTFIDF {
  private documents: Map<string, string[]> = new Map();
  private termDocumentFrequency: Map<string, Set<string>> = new Map();
  private documentTermCounts: Map<string, Map<string, number>> = new Map();
  private idfCache: Map<string, number> = new Map();
  private corpusStats: Map<string, TermStats> = new Map();
  
  private options: Required<TFIDFAlternativeOptions>;

  constructor(options: TFIDFAlternativeOptions = {}) {
    this.options = {
      minDocumentFrequency: options.minDocumentFrequency || 2,
      maxDocumentFrequency: options.maxDocumentFrequency || 0.5,
      minTermLength: options.minTermLength || 2,
      maxTermLength: options.maxTermLength || 30,
      stemming: options.stemming || false,
      normalization: options.normalization || 'l2'
    };
  }

  /**
   * Simple tokenizer that splits text into words and applies basic filtering
   */
  private tokenize(text: string): string[] {
    if (!text || typeof text !== 'string') return [];
    
    // Convert to lowercase and split on word boundaries
    const tokens = text.toLowerCase()
      .replace(/[^\w\s\-_.]/g, ' ') // Keep only alphanumeric, hyphens, underscores, dots
      .split(/\s+/)
      .filter(token => token.length >= this.options.minTermLength && 
                      token.length <= this.options.maxTermLength)
      .filter(token => !/^\d+$/.test(token)); // Remove pure numbers
    
    // Remove stopwords
    const cleanTokens = removeStopwords(tokens);
    
    // Apply simple stemming if enabled (basic suffix removal)
    if (this.options.stemming) {
      return cleanTokens.map(token => this.simpleStem(token));
    }
    
    return cleanTokens;
  }

  /**
   * Simple stemming implementation (removes common suffixes)
   */
  private simpleStem(word: string): string {
    if (word.length <= 3) return word;
    
    // Common English suffixes
    const suffixes = ['ing', 'ed', 'er', 'est', 'ly', 'ion', 'tion', 'ation', 'ness', 'ment'];
    
    for (const suffix of suffixes) {
      if (word.endsWith(suffix)) {
        const stem = word.slice(0, -suffix.length);
        if (stem.length >= 3) {
          return stem;
        }
      }
    }
    
    return word;
  }

  /**
   * Add a document to the corpus
   */
  addDocument(id: string, text: string): void {
    if (!id || !text) {
      console.warn(`[PURE-TFIDF] Skipping empty document: ${id}`);
      return;
    }

    if (this.documents.has(id)) {
      console.warn(`[PURE-TFIDF] Document ${id} already exists, replacing`);
    }

    // Tokenize the document
    const tokens = this.tokenize(text);
    
    if (tokens.length === 0) {
      console.warn(`[PURE-TFIDF] Document ${id} has no valid tokens after processing`);
      return;
    }

    // Store the document tokens
    this.documents.set(id, tokens);

    // Count term frequencies for this document
    const termCounts = new Map<string, number>();
    tokens.forEach(token => {
      termCounts.set(token, (termCounts.get(token) || 0) + 1);
    });
    
    this.documentTermCounts.set(id, termCounts);

    // Update global term-document frequency tracking
    const uniqueTerms = new Set(tokens);
    uniqueTerms.forEach(term => {
      if (!this.termDocumentFrequency.has(term)) {
        this.termDocumentFrequency.set(term, new Set());
      }
      this.termDocumentFrequency.get(term)!.add(id);
    });

    // Clear caches since corpus has changed
    this.idfCache.clear();
    this.corpusStats.clear();
  }

  /**
   * Calculate Term Frequency (TF) for a term in a document
   */
  private calculateTF(term: string, documentId: string): number {
    const termCounts = this.documentTermCounts.get(documentId);
    if (!termCounts) return 0;

    const termCount = termCounts.get(term) || 0;
    const totalTerms = this.documents.get(documentId)?.length || 1;

    // Use normalized term frequency (term count / total terms in document)
    return termCount / totalTerms;
  }

  /**
   * Calculate Inverse Document Frequency (IDF) for a term
   */
  private calculateIDF(term: string): number {
    // Check cache first
    if (this.idfCache.has(term)) {
      return this.idfCache.get(term)!;
    }

    const totalDocuments = this.documents.size;
    const documentsWithTerm = this.termDocumentFrequency.get(term)?.size || 0;

    if (documentsWithTerm === 0) {
      return 0;
    }

    let idf: number;
    
    // Special handling for single-document cases
    if (totalDocuments === 1) {
      // For single documents, use a small constant IDF to allow TF to dominate
      // This ensures terms can still be ranked by their frequency within the document
      idf = 1.0;
    } else {
      // Standard IDF calculation with smoothing for multi-document corpora
      idf = Math.log((totalDocuments + 1) / (documentsWithTerm + 1));
    }
    
    // Cache the result
    this.idfCache.set(term, idf);
    
    return idf;
  }

  /**
   * Calculate TF-IDF score for a term in a document
   */
  calculateTFIDF(term: string, documentId: string): number {
    const tf = this.calculateTF(term, documentId);
    const idf = this.calculateIDF(term);
    
    return tf * idf;
  }

  /**
   * Get all TF-IDF scores for a document
   */
  getDocumentTFIDF(documentId: string): TFIDFResult[] {
    const termCounts = this.documentTermCounts.get(documentId);
    if (!termCounts) {
      return [];
    }

    const results: TFIDFResult[] = [];
    const totalDocs = this.documents.size;
    const maxDocFreq = Math.floor(this.options.maxDocumentFrequency * totalDocs);
    
    termCounts.forEach((count, term) => {
      // Apply frequency filtering only if we have enough documents for it to make sense
      const docFreq = this.termDocumentFrequency.get(term)?.size || 0;
      
      // For small corpora (< 5 docs), be more lenient with filtering
      const effectiveMinFreq = totalDocs < 5 ? 1 : this.options.minDocumentFrequency;
      const effectiveMaxFreq = totalDocs < 5 ? totalDocs : maxDocFreq;
      
      if (docFreq < effectiveMinFreq || docFreq > effectiveMaxFreq) {
        return; // Skip this term
      }

      const tf = this.calculateTF(term, documentId);
      const idf = this.calculateIDF(term);
      const tfidf = tf * idf;

      // Only include terms with meaningful TF-IDF scores
      if (tfidf > 0) {
        results.push({
          term,
          tfidf,
          tf,
          idf,
          documentId
        });
      }
    });

    // Sort by TF-IDF score descending
    results.sort((a, b) => b.tfidf - a.tfidf);
    
    return results;
  }

  /**
   * Get top N keywords for a document
   */
  getTopKeywords(documentId: string, topN: number = 10): TFIDFResult[] {
    return this.getDocumentTFIDF(documentId).slice(0, topN);
  }

  /**
   * Calculate corpus statistics
   */
  calculateCorpusStats(): Map<string, TermStats> {
    if (this.corpusStats.size > 0) {
      return this.corpusStats; // Return cached stats
    }

    const totalDocs = this.documents.size;
    
    // Apply frequency filtering before creating corpus stats
    const maxDocFreq = Math.floor(this.options.maxDocumentFrequency * totalDocs);
    
    this.termDocumentFrequency.forEach((documentSet, term) => {
      const documentFrequency = documentSet.size;
      
      // Apply frequency filtering
      if (documentFrequency < this.options.minDocumentFrequency || documentFrequency > maxDocFreq) {
        return; // Skip this term
      }
      
      const idf = this.calculateIDF(term);
      
      // Calculate total occurrences across all documents
      let totalOccurrences = 0;
      documentSet.forEach(docId => {
        const termCounts = this.documentTermCounts.get(docId);
        totalOccurrences += termCounts?.get(term) || 0;
      });

      this.corpusStats.set(term, {
        term,
        documentFrequency,
        idf,
        totalOccurrences
      });
    });

    console.log(`[PURE-TFIDF] Corpus stats calculated: ${this.corpusStats.size} unique terms across ${totalDocs} documents (after frequency filtering)`);
    
    return this.corpusStats;
  }

  /**
   * Get document statistics
   */
  getDocumentStats(documentId: string): DocumentStats | null {
    const tokens = this.documents.get(documentId);
    const termCounts = this.documentTermCounts.get(documentId);
    
    if (!tokens || !termCounts) {
      return null;
    }

    const maxTermFrequency = Math.max(...termCounts.values());

    return {
      id: documentId,
      termCount: tokens.length,
      uniqueTerms: termCounts.size,
      maxTermFrequency
    };
  }

  /**
   * Calculate cosine similarity between two documents
   */
  calculateCosineSimilarity(docId1: string, docId2: string): number {
    const vector1 = this.getDocumentVector(docId1);
    const vector2 = this.getDocumentVector(docId2);

    return this.cosineSimilarity(vector1, vector2);
  }

  /**
   * Get TF-IDF vector for a document
   */
  private getDocumentVector(documentId: string): Map<string, number> {
    const vector = new Map<string, number>();
    const tfidfScores = this.getDocumentTFIDF(documentId);
    
    tfidfScores.forEach(score => {
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
   * Get basic corpus information
   */
  getCorpusInfo() {
    return {
      totalDocuments: this.documents.size,
      totalUniqueTerms: this.termDocumentFrequency.size,
      averageDocumentLength: this.getAverageDocumentLength(),
      options: this.options
    };
  }

  private getAverageDocumentLength(): number {
    if (this.documents.size === 0) return 0;
    
    let totalTokens = 0;
    this.documents.forEach(tokens => {
      totalTokens += tokens.length;
    });
    
    return totalTokens / this.documents.size;
  }
}

/**
 * Node-TFIDF Compatible Implementation
 * 
 * This class provides an API compatible with the node-tfidf package
 * while using our pure JavaScript implementation under the hood.
 */
export class NodeTFIDFCompatible {
  private pureTfidf: PureTFIDF;
  private documentIds: string[] = [];

  constructor(options: TFIDFAlternativeOptions = {}) {
    this.pureTfidf = new PureTFIDF(options);
  }

  /**
   * Add a document (compatible with node-tfidf API)
   */
  addDocument(document: string | string[], identifier?: string): void {
    const docId = identifier || `doc_${this.documentIds.length}`;
    this.documentIds.push(docId);

    let text: string;
    if (Array.isArray(document)) {
      text = document.join(' ');
    } else {
      text = document;
    }

    this.pureTfidf.addDocument(docId, text);
  }

  /**
   * Get TF-IDF score for a term in a specific document (by index)
   */
  tfidf(term: string, documentIndex: number): number {
    if (documentIndex < 0 || documentIndex >= this.documentIds.length) {
      return 0;
    }

    const docId = this.documentIds[documentIndex];
    return this.pureTfidf.calculateTFIDF(term, docId);
  }

  /**
   * Get TF-IDF scores for a term across all documents
   */
  tfidfs(term: string, callback?: (index: number, measure: number) => void): number[] {
    const results: number[] = [];

    this.documentIds.forEach((docId, index) => {
      const score = this.pureTfidf.calculateTFIDF(term, docId);
      results.push(score);
      
      if (callback) {
        callback(index, score);
      }
    });

    return results;
  }

  /**
   * Get the number of documents in the corpus
   */
  size(): number {
    return this.documentIds.length;
  }

  /**
   * Get all terms and their TF-IDF scores for a document
   */
  listTerms(documentIndex: number): Array<{term: string, tfidf: number}> {
    if (documentIndex < 0 || documentIndex >= this.documentIds.length) {
      return [];
    }

    const docId = this.documentIds[documentIndex];
    const tfidfResults = this.pureTfidf.getDocumentTFIDF(docId);
    
    return tfidfResults.map(result => ({
      term: result.term,
      tfidf: result.tfidf
    }));
  }
}

/**
 * Lightweight TF-IDF Implementation (Minimal Dependencies)
 * 
 * An extremely lightweight TF-IDF implementation with minimal features
 * for situations where maximum performance and minimal memory usage are required.
 */
export class LightweightTFIDF {
  private docs: string[][] = [];
  private vocabulary: Set<string> = new Set();
  private docFreq: Map<string, number> = new Map();

  constructor() {}

  /**
   * Add a document as an array of tokens
   */
  addDocument(tokens: string[]): number {
    const docIndex = this.docs.length;
    this.docs.push([...tokens]);

    // Update vocabulary and document frequencies
    const uniqueTokens = new Set(tokens);
    uniqueTokens.forEach(token => {
      this.vocabulary.add(token);
      this.docFreq.set(token, (this.docFreq.get(token) || 0) + 1);
    });

    return docIndex;
  }

  /**
   * Calculate TF-IDF for a term in a document
   */
  tfidf(term: string, docIndex: number): number {
    if (docIndex < 0 || docIndex >= this.docs.length) return 0;

    const doc = this.docs[docIndex];
    const termFreq = doc.filter(t => t === term).length;
    const tf = termFreq / doc.length;

    const totalDocs = this.docs.length;
    const docsWithTerm = this.docFreq.get(term) || 0;
    const idf = docsWithTerm > 0 ? Math.log(totalDocs / docsWithTerm) : 0;

    return tf * idf;
  }

  /**
   * Get all terms and scores for a document
   */
  getDocumentVector(docIndex: number): Map<string, number> {
    const vector = new Map<string, number>();
    
    if (docIndex < 0 || docIndex >= this.docs.length) return vector;

    const doc = this.docs[docIndex];
    const uniqueTerms = new Set(doc);

    uniqueTerms.forEach(term => {
      vector.set(term, this.tfidf(term, docIndex));
    });

    return vector;
  }

  /**
   * Get corpus size
   */
  size(): number {
    return this.docs.length;
  }

  /**
   * Get vocabulary size
   */
  vocabularySize(): number {
    return this.vocabulary.size;
  }
}