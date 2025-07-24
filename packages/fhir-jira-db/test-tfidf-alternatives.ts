/**
 * Comprehensive Test Suite for TF-IDF Alternatives
 * 
 * Tests all TF-IDF backend implementations for functionality, performance,
 * and compatibility with existing systems.
 */

import { test, expect } from 'bun:test';
import { 
  PureTFIDF, 
  NodeTFIDFCompatible, 
  LightweightTFIDF,
  TFIDFAlternativeOptions 
} from './tfidf-alternatives.ts';
import { UnifiedTFIDFProcessor, TFIDFBackend } from './tfidf-backend-compatibility.ts';

// Test data for consistent testing across backends
const sampleDocuments = [
  { id: 'doc1', text: 'FHIR Patient resource contains demographic information' },
  { id: 'doc2', text: 'Patient data includes name address and contact information' },
  { id: 'doc3', text: 'FHIR Observation resource stores clinical measurements' },
  { id: 'doc4', text: 'Clinical data analysis using TF-IDF for keyword extraction' },
  { id: 'doc5', text: 'Healthcare interoperability requires standardized data formats' }
];

const largeDocument = `
FHIR (Fast Healthcare Interoperability Resources) is a standard describing data formats and elements 
and an application programming interface for exchanging electronic health records. The standard was 
created by the Health Level Seven International health-care standards organization. FHIR builds on 
previous data format standards from HL7, like HL7 version 2.x and HL7 version 3.x. FHIR uses modern 
web-based suite of API technology, including an HTTP-based RESTful protocol, HTML and Cascading Style 
Sheet for user interface integration, and a choice of JSON, XML or RDF for data representation.
`.repeat(10); // Make it larger for stress testing

/**
 * Test Suite for Pure JavaScript TF-IDF Implementation
 */
test('PureTFIDF - Basic Functionality', () => {
  const tfidf = new PureTFIDF();
  
  // Add sample documents
  sampleDocuments.forEach(doc => {
    tfidf.addDocument(doc.id, doc.text);
  });
  
  // Test document addition
  expect(tfidf.getCorpusInfo().totalDocuments).toBe(5);
  expect(tfidf.getCorpusInfo().totalUniqueTerms).toBeGreaterThan(10);
  
  // Test TF-IDF calculation
  const doc1Results = tfidf.getDocumentTFIDF('doc1');
  expect(doc1Results.length).toBeGreaterThan(0);
  expect(doc1Results[0]).toHaveProperty('term');
  expect(doc1Results[0]).toHaveProperty('tfidf');
  expect(doc1Results[0]).toHaveProperty('tf');
  expect(doc1Results[0]).toHaveProperty('idf');
  
  // Test keyword extraction
  const keywords = tfidf.getTopKeywords('doc1', 5);
  expect(keywords.length).toBeLessThanOrEqual(5);
  expect(keywords[0].tfidf).toBeGreaterThanOrEqual(keywords[1]?.tfidf || 0);
  
  console.log(`✅ PureTFIDF basic functionality test passed`);
});

test('PureTFIDF - Advanced Features', () => {
  const options: TFIDFAlternativeOptions = {
    minDocumentFrequency: 1,
    maxDocumentFrequency: 0.8,
    stemming: true,
    normalization: 'l2'
  };
  
  const tfidf = new PureTFIDF(options);
  
  // Add documents with stemming enabled
  sampleDocuments.forEach(doc => {
    tfidf.addDocument(doc.id, doc.text);
  });
  
  // Test corpus statistics
  const stats = tfidf.calculateCorpusStats();
  expect(stats.size).toBeGreaterThan(0);
  
  // Test document statistics
  const docStats = tfidf.getDocumentStats('doc1');
  expect(docStats).not.toBeNull();
  expect(docStats!.termCount).toBeGreaterThan(0);
  expect(docStats!.uniqueTerms).toBeGreaterThan(0);
  
  // Test cosine similarity
  const similarity = tfidf.calculateCosineSimilarity('doc1', 'doc2');
  expect(similarity).toBeGreaterThanOrEqual(0);
  expect(similarity).toBeLessThanOrEqual(1);
  
  console.log(`✅ PureTFIDF advanced features test passed`);
});

test('PureTFIDF - Error Handling', () => {
  const tfidf = new PureTFIDF();
  
  // Test empty document handling
  tfidf.addDocument('empty', '');
  expect(tfidf.getCorpusInfo().totalDocuments).toBe(0);
  
  // Test invalid document ID
  const results = tfidf.getDocumentTFIDF('nonexistent');
  expect(results.length).toBe(0);
  
  // Test null/undefined handling
  tfidf.addDocument('null-test', null as any);
  tfidf.addDocument('undefined-test', undefined as any);
  
  console.log(`✅ PureTFIDF error handling test passed`);
});

/**
 * Test Suite for Node-TFIDF Compatible Implementation
 */
test('NodeTFIDFCompatible - API Compatibility', () => {
  const tfidf = new NodeTFIDFCompatible();
  
  // Test string documents
  sampleDocuments.forEach(doc => {
    tfidf.addDocument(doc.text, doc.id);
  });
  
  expect(tfidf.size()).toBe(5);
  
  // Test array documents
  const arrayDoc = ['FHIR', 'healthcare', 'interoperability', 'standard'];
  tfidf.addDocument(arrayDoc);
  expect(tfidf.size()).toBe(6);
  
  // Test tfidf method (by index)
  const score = tfidf.tfidf('FHIR', 0);
  expect(typeof score).toBe('number');
  expect(score).toBeGreaterThanOrEqual(0);
  
  // Test tfidfs method (across all documents)
  const scores = tfidf.tfidfs('healthcare');
  expect(scores.length).toBe(6);
  expect(scores.every(score => typeof score === 'number')).toBe(true);
  
  // Test callback functionality
  let callbackCount = 0;
  tfidf.tfidfs('data', (index, measure) => {
    expect(typeof index).toBe('number');
    expect(typeof measure).toBe('number');
    callbackCount++;
  });
  expect(callbackCount).toBe(6);
  
  // Test listTerms method
  const terms = tfidf.listTerms(0);
  expect(Array.isArray(terms)).toBe(true);
  expect(terms.length).toBeGreaterThan(0);
  expect(terms[0]).toHaveProperty('term');
  expect(terms[0]).toHaveProperty('tfidf');
  
  console.log(`✅ NodeTFIDFCompatible API compatibility test passed`);
});

/**
 * Test Suite for Lightweight TF-IDF Implementation
 */
test('LightweightTFIDF - Performance Focus', () => {
  const tfidf = new LightweightTFIDF();
  
  // Test with pre-tokenized data
  const tokenizedDocs = sampleDocuments.map(doc => 
    doc.text.toLowerCase().split(/\s+/).filter(token => token.length > 2)
  );
  
  tokenizedDocs.forEach(tokens => {
    tfidf.addDocument(tokens);
  });
  
  expect(tfidf.size()).toBe(5);
  expect(tfidf.vocabularySize()).toBeGreaterThan(10);
  
  // Test TF-IDF calculation
  const score = tfidf.tfidf('fhir', 0);
  expect(typeof score).toBe('number');
  
  // Test document vector
  const vector = tfidf.getDocumentVector(0);
  expect(vector.size).toBeGreaterThan(0);
  
  console.log(`✅ LightweightTFIDF performance test passed`);
});

/**
 * Test Suite for Unified TF-IDF Processor
 */
test('UnifiedTFIDFProcessor - Backend Switching', async () => {
  // Test natural.js backend
  const naturalProcessor = new UnifiedTFIDFProcessor({
    preferredBackend: 'natural',
    autoFallback: true
  });
  
  sampleDocuments.forEach(doc => {
    naturalProcessor.addDocument(doc.id, doc.text);
  });
  
  const naturalResults = naturalProcessor.calculateTFIDF('doc1');
  expect(naturalResults.length).toBeGreaterThan(0);
  expect(naturalProcessor.getBackendInfo().backend).toBe('natural');
  
  // Test pure backend
  const pureProcessor = new UnifiedTFIDFProcessor({
    preferredBackend: 'pure',
    autoFallback: false
  });
  
  sampleDocuments.forEach(doc => {
    pureProcessor.addDocument(doc.id, doc.text);
  });
  
  const pureResults = pureProcessor.calculateTFIDF('doc1');
  expect(pureResults.length).toBeGreaterThan(0);
  expect(pureProcessor.getBackendInfo().backend).toBe('pure');
  
  // Results should be similar (top terms should overlap)
  const naturalTopTerms = new Set(naturalResults.slice(0, 3).map(r => r.term));
  const pureTopTerms = new Set(pureResults.slice(0, 3).map(r => r.term));
  const overlap = [...naturalTopTerms].filter(term => pureTopTerms.has(term));
  expect(overlap.length).toBeGreaterThan(0); // At least some overlap expected
  
  console.log(`✅ UnifiedTFIDFProcessor backend switching test passed`);
});

test('UnifiedTFIDFProcessor - Backend Compatibility Testing', async () => {
  const processor = new UnifiedTFIDFProcessor();
  
  // Test all backends
  const backends: TFIDFBackend[] = ['natural', 'pure', 'node-compatible', 'lightweight'];
  
  for (const backend of backends) {
    const result = await processor.testBackendCompatibility(backend);
    expect(result.success).toBe(true);
    expect(result.performance).toBeGreaterThan(0);
    console.log(`✅ ${backend} backend compatibility test passed (${result.performance}ms)`);
  }
});

test('UnifiedTFIDFProcessor - Backend Capabilities', () => {
  const processor = new UnifiedTFIDFProcessor();
  
  const availableBackends = processor.listAvailableBackends();
  expect(availableBackends.length).toBe(4);
  
  availableBackends.forEach(backend => {
    expect(backend).toHaveProperty('backend');
    expect(backend).toHaveProperty('name');
    expect(backend).toHaveProperty('description');
    expect(backend).toHaveProperty('features');
    expect(backend).toHaveProperty('bunCompatible');
    expect(backend.bunCompatible).toBe(true); // All should be Bun compatible
  });
  
  console.log(`✅ UnifiedTFIDFProcessor capabilities test passed`);
});

/**
 * Performance Comparison Test
 */
test('Performance Comparison - All Backends', () => {
  const backends = [
    { name: 'Pure', processor: new PureTFIDF() },
    { name: 'NodeCompatible', processor: new NodeTFIDFCompatible() },
    { name: 'Lightweight', processor: new LightweightTFIDF() }
  ];
  
  const performanceResults: Record<string, number> = {};
  
  // Test each backend
  backends.forEach(({ name, processor }) => {
    const startTime = Date.now();
    
    if (name === 'Lightweight') {
      // Special handling for lightweight backend
      sampleDocuments.forEach((doc, index) => {
        const tokens = doc.text.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        (processor as LightweightTFIDF).addDocument(tokens);
      });
    } else if (name === 'Pure') {
      sampleDocuments.forEach(doc => {
        (processor as PureTFIDF).addDocument(doc.id, doc.text);
      });
    } else if (name === 'NodeCompatible') {
      sampleDocuments.forEach(doc => {
        (processor as NodeTFIDFCompatible).addDocument(doc.text, doc.id);
      });
    }
    
    const processingTime = Date.now() - startTime;
    performanceResults[name] = processingTime;
    
    console.log(`📊 ${name} backend processing time: ${processingTime}ms`);
  });
  
  // All backends should complete within reasonable time
  Object.values(performanceResults).forEach(time => {
    expect(time).toBeLessThan(1000); // Should complete within 1 second
  });
  
  console.log(`✅ Performance comparison test completed`);
});

/**
 * Stress Test with Large Document
 */
test('Stress Test - Large Document Processing', () => {
  const backends = [
    { name: 'Pure', processor: new PureTFIDF({ minDocumentFrequency: 1, maxDocumentFrequency: 1.0 }) },
    { name: 'NodeCompatible', processor: new NodeTFIDFCompatible({ minDocumentFrequency: 1, maxDocumentFrequency: 1.0 }) }
  ];
  
  backends.forEach(({ name, processor }) => {
    const startTime = Date.now();
    
    if (name === 'Pure') {
      (processor as PureTFIDF).addDocument('large-doc', largeDocument);
      const results = (processor as PureTFIDF).getTopKeywords('large-doc', 10);
      expect(results.length).toBeGreaterThan(0);
    } else if (name === 'NodeCompatible') {
      (processor as NodeTFIDFCompatible).addDocument(largeDocument, 'large-doc');
      const results = (processor as NodeTFIDFCompatible).listTerms(0);
      expect(results.length).toBeGreaterThan(0);
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`🚀 ${name} large document processing time: ${processingTime}ms`);
    
    // Should handle large documents within reasonable time
    expect(processingTime).toBeLessThan(5000); // 5 seconds max
  });
  
  console.log(`✅ Stress test completed`);
});

/**
 * Integration Test with Realistic JIRA Data
 */
test('Integration Test - Realistic JIRA Data', () => {
  const jiraIssues = [
    {
      key: 'FHIR-123',
      title: 'Patient resource validation error',
      description: 'FHIR Patient resource fails validation when required elements are missing',
      resolution: 'Fixed by adding mandatory field validation'
    },
    {
      key: 'FHIR-124', 
      title: 'Observation resource performance issue',
      description: 'Large Observation resources cause memory issues during processing',
      resolution: 'Optimized memory usage and added streaming support'
    },
    {
      key: 'FHIR-125',
      title: 'Bundle resource serialization problem',
      description: 'FHIR Bundle resources fail to serialize correctly to JSON',
      resolution: 'Updated serialization logic to handle nested resources'
    }
  ];
  
  const processor = new UnifiedTFIDFProcessor({
    preferredBackend: 'pure',
    minDocumentFrequency: 1,
    maxDocumentFrequency: 1.0
  });
  
  // Add JIRA issues as documents
  jiraIssues.forEach(issue => {
    const text = `${issue.title} ${issue.description} ${issue.resolution}`;
    processor.addDocument(issue.key, text);
  });
  
  // Extract keywords for each issue
  jiraIssues.forEach(issue => {
    const keywords = processor.extractKeywords(issue.key, 5);
    expect(keywords.length).toBeGreaterThan(0);
    
    // Should extract relevant technical terms
    const terms = keywords.map(k => k.term);
    const hasFhirTerms = terms.some(term => 
      ['fhir', 'patient', 'resource', 'observation', 'bundle'].includes(term.toLowerCase())
    );
    expect(hasFhirTerms).toBe(true);
    
    console.log(`📝 ${issue.key} top keywords:`, terms.slice(0, 3));
  });
  
  console.log(`✅ Integration test with JIRA data passed`);
});

/**
 * Compatibility Test with Natural.js Results
 */
test('Compatibility Test - Compare with Natural.js', () => {
  // Create both processors
  const naturalProcessor = new UnifiedTFIDFProcessor({ preferredBackend: 'natural' });
  const pureProcessor = new UnifiedTFIDFProcessor({ preferredBackend: 'pure' });
  
  // Add same documents to both
  const testDocs = sampleDocuments.slice(0, 3); // Use subset for focused comparison
  testDocs.forEach(doc => {
    naturalProcessor.addDocument(doc.id, doc.text);
    pureProcessor.addDocument(doc.id, doc.text);
  });
  
  // Compare results for each document
  testDocs.forEach(doc => {
    const naturalResults = naturalProcessor.extractKeywords(doc.id, 5);
    const pureResults = pureProcessor.extractKeywords(doc.id, 5);
    
    expect(naturalResults.length).toBeGreaterThan(0);
    expect(pureResults.length).toBeGreaterThan(0);
    
    // Check for term overlap (should have some common important terms)
    const naturalTerms = new Set(naturalResults.map(r => r.term));
    const pureTerms = new Set(pureResults.map(r => r.term));
    const overlap = [...naturalTerms].filter(term => pureTerms.has(term));
    
    console.log(`🔍 ${doc.id} - Natural terms:`, [...naturalTerms]);
    console.log(`🔍 ${doc.id} - Pure terms:`, [...pureTerms]);
    console.log(`🔍 ${doc.id} - Overlap:`, overlap);
    
    // Expect at least some overlap for similar documents
    expect(overlap.length).toBeGreaterThan(0);
  });
  
  console.log(`✅ Natural.js compatibility test passed`);
});

// Main test runner
if (import.meta.main) {
  console.log('🧪 Starting TF-IDF Alternatives Test Suite...');
  console.log('📚 Testing all backend implementations for functionality and compatibility');
  console.log('⚡ Performance testing and stress testing included');
  console.log('');
}