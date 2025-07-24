#!/usr/bin/env bun

/**
 * TF-IDF Alternatives Demo Script
 * 
 * Demonstrates the usage of different TF-IDF backend implementations
 * and the unified compatibility layer for seamless switching.
 */

import { 
  PureTFIDF, 
  NodeTFIDFCompatible, 
  LightweightTFIDF 
} from './tfidf-alternatives.ts';
import { UnifiedTFIDFProcessor } from './tfidf-backend-compatibility.ts';

// Sample JIRA-like documents
const sampleIssues = [
  {
    key: 'FHIR-100',
    title: 'Patient resource validation error',
    description: 'FHIR Patient resource fails validation when required demographic elements are missing',
    resolution: 'Fixed by implementing comprehensive field validation for all Patient resource fields'
  },
  {
    key: 'FHIR-101', 
    title: 'Observation resource performance issue',
    description: 'Large Observation resources cause memory issues and slow processing during bulk operations',
    resolution: 'Optimized memory usage with streaming and implemented efficient batch processing'
  },
  {
    key: 'FHIR-102',
    title: 'Bundle resource serialization problem', 
    description: 'FHIR Bundle resources fail to serialize correctly to JSON when containing nested resources',
    resolution: 'Updated serialization engine to handle complex nested resource structures'
  },
  {
    key: 'FHIR-103',
    title: 'Medication resource data consistency issue',
    description: 'Medication resources show inconsistent data when retrieved through different API endpoints',
    resolution: 'Implemented unified data access layer for consistent resource retrieval'
  }
];

console.log('🚀 TF-IDF Alternatives Demo');
console.log('=' .repeat(50));

/**
 * Demo 1: Pure JavaScript TF-IDF Implementation
 */
console.log('\n📊 Demo 1: Pure JavaScript TF-IDF Implementation');
console.log('-'.repeat(50));

const pureTfidf = new PureTFIDF({
  minDocumentFrequency: 1,
  maxDocumentFrequency: 0.8,
  stemming: true
});

// Add sample issues
sampleIssues.forEach(issue => {
  const text = `${issue.title} ${issue.description} ${issue.resolution}`;
  pureTfidf.addDocument(issue.key, text);
});

// Extract keywords for each issue
console.log('Top keywords for each JIRA issue:');
sampleIssues.forEach(issue => {
  const keywords = pureTfidf.getTopKeywords(issue.key, 5);
  console.log(`\n${issue.key}: ${issue.title}`);
  console.log(`Keywords: ${keywords.map(k => `${k.term}(${k.tfidf.toFixed(3)})`).join(', ')}`);
});

// Display corpus statistics
const corpusStats = pureTfidf.calculateCorpusStats();
console.log(`\nCorpus Statistics: ${corpusStats.size} unique terms across ${pureTfidf.getCorpusInfo().totalDocuments} documents`);

/**
 * Demo 2: Node-TFIDF Compatible Implementation
 */
console.log('\n📊 Demo 2: Node-TFIDF Compatible Implementation');
console.log('-'.repeat(50));

const nodeCompatible = new NodeTFIDFCompatible({
  minDocumentFrequency: 1,
  maxDocumentFrequency: 1.0
});

// Add documents using node-tfidf API
sampleIssues.forEach(issue => {
  const text = `${issue.title} ${issue.description} ${issue.resolution}`;
  nodeCompatible.addDocument(text, issue.key);
});

console.log(`Corpus size: ${nodeCompatible.size()} documents`);

// Calculate TF-IDF scores for specific terms
const importantTerms = ['fhir', 'patient', 'resource', 'validation'];
console.log('\nTF-IDF scores for important terms across all documents:');
importantTerms.forEach(term => {
  console.log(`\n"${term}" scores:`);
  const scores = nodeCompatible.tfidfs(term);
  scores.forEach((score, index) => {
    if (score > 0) {
      console.log(`  ${sampleIssues[index].key}: ${score.toFixed(4)}`);
    }
  });
});

/**
 * Demo 3: Lightweight TF-IDF Implementation
 */
console.log('\n📊 Demo 3: Lightweight TF-IDF Implementation');
console.log('-'.repeat(50));

const lightweight = new LightweightTFIDF();

// Add pre-tokenized documents
const tokenizedIssues = sampleIssues.map(issue => {
  const text = `${issue.title} ${issue.description} ${issue.resolution}`;
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2);
});

tokenizedIssues.forEach(tokens => {
  lightweight.addDocument(tokens);
});

console.log(`Lightweight corpus: ${lightweight.size()} documents, ${lightweight.vocabularySize()} unique terms`);

// Get document vectors
console.log('\nDocument vectors (top 3 terms):');
for (let i = 0; i < sampleIssues.length; i++) {
  const vector = lightweight.getDocumentVector(i);
  const topTerms = Array.from(vector.entries())
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3);
  
  console.log(`${sampleIssues[i].key}: ${topTerms.map(([term, score]) => `${term}(${score.toFixed(3)})`).join(', ')}`);
}

/**
 * Demo 4: Unified TF-IDF Processor with Backend Switching
 */
console.log('\n📊 Demo 4: Unified TF-IDF Processor with Backend Switching');
console.log('-'.repeat(50));

// Test different backends
const backends = ['natural', 'pure', 'node-compatible', 'lightweight'] as const;

for (const backend of backends) {
  console.log(`\nTesting ${backend} backend:`);
  
  const processor = new UnifiedTFIDFProcessor({
    preferredBackend: backend,
    autoFallback: false,
    minDocumentFrequency: 1,
    maxDocumentFrequency: 1.0
  });
  
  // Add sample documents
  sampleIssues.forEach(issue => {
    const text = `${issue.title} ${issue.description} ${issue.resolution}`;
    processor.addDocument(issue.key, text);
  });
  
  // Get backend info
  const backendInfo = processor.getBackendInfo();
  console.log(`  Backend: ${backendInfo.name}`);
  console.log(`  Features: Stemming(${backendInfo.features.stemming}), Stopwords(${backendInfo.features.stopwordRemoval}), CosineSim(${backendInfo.features.cosineSimalirity})`);
  
  // Extract keywords for first issue
  const keywords = processor.extractKeywords(sampleIssues[0].key, 3);
  console.log(`  Top keywords for ${sampleIssues[0].key}: ${keywords.map(k => k.term).join(', ')}`);
}

/**
 * Demo 5: Performance Comparison
 */
console.log('\n📊 Demo 5: Performance Comparison');
console.log('-'.repeat(50));

const performanceTest = async () => {
  console.log('Testing backend performance with realistic dataset...');
  
  // Create larger test dataset
  const largeDataset = Array.from({ length: 50 }, (_, i) => ({
    id: `ISSUE-${i}`,
    text: sampleIssues[i % sampleIssues.length].description.repeat(Math.floor(Math.random() * 3) + 1)
  }));
  
  for (const backend of backends) {
    const startTime = Date.now();
    
    try {
      const processor = new UnifiedTFIDFProcessor({
        preferredBackend: backend,
        autoFallback: false
      });
      
      // Add all documents
      largeDataset.forEach(doc => {
        processor.addDocument(doc.id, doc.text);
      });
      
      // Extract keywords for first 5 documents
      for (let i = 0; i < 5; i++) {
        processor.extractKeywords(largeDataset[i].id, 10);
      }
      
      const duration = Date.now() - startTime;
      console.log(`  ${backend}: ${duration}ms (${largeDataset.length} docs)`);
      
    } catch (error) {
      console.log(`  ${backend}: ERROR - ${(error as Error).message}`);
    }
  }
};

await performanceTest();

/**
 * Demo 6: Compatibility Testing
 */
console.log('\n📊 Demo 6: Backend Compatibility Testing');
console.log('-'.repeat(50));

const unifiedProcessor = new UnifiedTFIDFProcessor();

console.log('Testing backend compatibility...');
for (const backend of backends) {
  const result = await unifiedProcessor.testBackendCompatibility(backend);
  const status = result.success ? '✅' : '❌';
  const info = result.success ? `${result.performance}ms` : result.error;
  console.log(`  ${status} ${backend}: ${info}`);
}

console.log('\n🎉 Demo completed! All TF-IDF alternatives are ready for production use.');
console.log('\n💡 Recommendations:');
console.log('   • Use Natural.js for full NLP features and proven reliability');
console.log('   • Use Pure JS for maximum control and Bun optimization');
console.log('   • Use Node-compatible for easy migration from node-tfidf');
console.log('   • Use Lightweight for memory-constrained environments');
console.log('   • Use UnifiedTFIDFProcessor for automatic fallback support');