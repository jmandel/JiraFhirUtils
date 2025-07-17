import natural from 'natural';
import { removeStopwords } from 'stopword';

export class TFIDFProcessor {
  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.tfidf = new natural.TfIdf();
    this.documents = new Map();
    this.corpusStats = new Map();
  }

  /**
   * Preprocess text by tokenizing, lowercasing, and removing stopwords
   */
  preprocessText(text) {
    if (!text) return [];
    
    // Tokenize
    let tokens = this.tokenizer.tokenize(text.toLowerCase());
    
    // Remove stopwords
    tokens = removeStopwords(tokens);
    
    // Filter out short tokens and numbers
    tokens = tokens.filter(token => 
      token.length > 2 && 
      !/^\d+$/.test(token) &&
      !/^[^a-z0-9]+$/i.test(token)
    );
    
    // Add FHIR-specific preprocessing
    tokens = this.processFHIRTerms(tokens);
    
    return tokens;
  }

  /**
   * Process FHIR-specific terms
   */
  processFHIRTerms(tokens) {
    return tokens.map(token => {
      // Preserve FHIR resource names
      if (token.match(/^(patient|observation|procedure|condition|medication|encounter|practitioner|organization|device|diagnostic|immunization|allergyintolerance|careplan|careteam|goal)$/i)) {
        return token.toUpperCase();
      }
      
      // Preserve version identifiers
      if (token.match(/^(r4|r5|stu3|dstu2)$/i)) {
        return token.toUpperCase();
      }
      
      // Preserve common FHIR operations
      if (token.match(/^\$(expand|validate|lookup|subsumes|compose|translate)$/)) {
        return token;
      }
      
      return token;
    });
  }

  /**
   * Add a document to the corpus
   */
  addDocument(id, text, metadata = {}) {
    const tokens = this.preprocessText(text);
    const tokenString = tokens.join(' ');
    
    this.documents.set(id, {
      original: text,
      tokens: tokens,
      metadata: metadata
    });
    
    this.tfidf.addDocument(tokenString, id);
  }

  /**
   * Build corpus from array of documents
   */
  buildCorpus(documents) {
    documents.forEach(doc => {
      const text = this.combineTextFields(doc);
      this.addDocument(doc.key || doc.id, text, doc);
    });
    
    this.calculateCorpusStats();
  }

  /**
   * Combine multiple text fields from an issue
   */
  combineTextFields(issue) {
    const fields = [];
    
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
  calculateTFIDF(documentId) {
    const scores = [];
    
    this.tfidf.tfidfs(null, (i, measure, key) => {
      if (key && key.toString() === documentId.toString()) {
        this.tfidf.listTerms(i).forEach(term => {
          scores.push({
            term: term.term,
            tfidf: term.tfidf,
            tf: term.tf
          });
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
  extractKeywords(documentId, topN = 10) {
    const scores = this.calculateTFIDF(documentId);
    return scores.slice(0, topN);
  }

  /**
   * Calculate corpus-wide statistics
   */
  calculateCorpusStats() {
    const termDocFrequency = new Map();
    const totalDocs = this.documents.size;
    
    // Count document frequency for each term
    this.documents.forEach((doc, docId) => {
      const uniqueTerms = new Set(doc.tokens);
      uniqueTerms.forEach(term => {
        termDocFrequency.set(term, (termDocFrequency.get(term) || 0) + 1);
      });
    });
    
    // Calculate IDF for each term
    termDocFrequency.forEach((docFreq, term) => {
      const idf = Math.log(totalDocs / docFreq);
      this.corpusStats.set(term, {
        documentFrequency: docFreq,
        idf: idf,
        totalDocuments: totalDocs
      });
    });
  }

  /**
   * Get all keywords for all documents
   */
  extractAllKeywords(topN = 10) {
    const allKeywords = new Map();
    
    this.documents.forEach((doc, docId) => {
      const keywords = this.extractKeywords(docId, topN);
      allKeywords.set(docId, keywords);
    });
    
    return allKeywords;
  }

  /**
   * Find similar documents based on TF-IDF vectors
   */
  findSimilarDocuments(documentId, topN = 5) {
    const similarities = [];
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
  getDocumentVector(documentId) {
    const vector = new Map();
    const scores = this.calculateTFIDF(documentId);
    
    scores.forEach(score => {
      vector.set(score.term, score.tfidf);
    });
    
    return vector;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(vector1, vector2) {
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
  getCorpusStats() {
    return this.corpusStats;
  }

  /**
   * Export keywords data for database storage
   */
  exportKeywordsForDB(topN = 10) {
    const results = [];
    
    this.documents.forEach((doc, docId) => {
      const keywords = this.extractKeywords(docId, topN);
      keywords.forEach(keyword => {
        const corpusStat = this.corpusStats.get(keyword.term) || {};
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
  exportCorpusStatsForDB() {
    const results = [];
    
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