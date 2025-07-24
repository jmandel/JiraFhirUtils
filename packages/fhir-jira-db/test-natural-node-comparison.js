/**
 * Node.js version of natural.js isolation test for comparison with Bun
 */

import natural from 'natural';
import { removeStopwords } from 'stopword'; 

// Sample test dataset (same as Bun test)
const SAMPLE_DOCUMENTS = [
  {
    id: 'DOC-001',
    text: 'FHIR Patient resource contains demographic information including name, gender, and birth date. The Patient resource is fundamental to healthcare interoperability.'
  },
  {
    id: 'DOC-002', 
    text: 'Observation resource in FHIR represents measurements and simple assertions about a patient. Blood pressure readings are common observations.'
  },
  {
    id: 'DOC-003',
    text: 'Medication resources describe drugs and pharmaceutical products used in patient care. Prescription medications require careful tracking.'
  },
  {
    id: 'DOC-004',
    text: 'Procedure resource documents actions performed on or for patients including surgeries, therapies, and diagnostic procedures.'
  },
  {
    id: 'DOC-005',
    text: 'Healthcare interoperability requires standardized data exchange using FHIR resources for patient information sharing between systems.'
  }
];

class NaturalJsNodeTester {
  constructor() {
    this.tfidf = new natural.TfIdf();
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
    
    console.log('[NATURAL-NODE] Initializing Natural.js components...');
    console.log(`[NATURAL-NODE] Natural.js version: ${natural.version || 'unknown'}`);
    console.log(`[NATURAL-NODE] Node.js version: ${process.version}`);
  }
  
  async testTokenization() {
    const startTime = Date.now();
    const testName = 'Basic Tokenization';
    
    try {
      console.log(`[NATURAL-NODE] Running ${testName}...`);
      
      const sampleText = 'FHIR Patient resource contains demographic information.';
      const tokens = this.tokenizer.tokenize(sampleText.toLowerCase()) || [];
      
      // Test stopword removal
      const filteredTokens = removeStopwords(tokens);
      
      const result = {
        originalTokens: tokens,
        filteredTokens: filteredTokens,
        tokenCount: tokens.length,
        filteredCount: filteredTokens.length
      };
      
      console.log(`[NATURAL-NODE] ${testName} - Original: ${tokens.length} tokens, Filtered: ${filteredTokens.length} tokens`);
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        details: result
      };
    } catch (error) {
      console.error(`[NATURAL-NODE] ${testName} failed:`, error.message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        details: null,
        error: error.message
      };
    }
  }
  
  async testStemming() {
    const startTime = Date.now();
    const testName = 'Porter Stemming';
    
    try {
      console.log(`[NATURAL-NODE] Running ${testName}...`);
      
      const testWords = ['running', 'ran', 'runs', 'healthcare', 'interoperability', 'measurements'];
      const stemmedWords = testWords.map(word => this.stemmer.stem(word));
      
      const result = {
        original: testWords,
        stemmed: stemmedWords,
        pairs: testWords.map((word, i) => ({ original: word, stemmed: stemmedWords[i] }))
      };
      
      console.log(`[NATURAL-NODE] ${testName} - Stemmed ${testWords.length} words`);
      result.pairs.forEach(pair => {
        console.log(`[NATURAL-NODE]   "${pair.original}" → "${pair.stemmed}"`);
      });
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        details: result
      };
    } catch (error) {
      console.error(`[NATURAL-NODE] ${testName} failed:`, error.message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        details: null,
        error: error.message
      };
    }
  }
  
  async testTfIdfDocumentProcessing() {
    const startTime = Date.now();
    const testName = 'TF-IDF Document Processing';
    
    try {
      console.log(`[NATURAL-NODE] Running ${testName}...`);
      
      const tfidf = new natural.TfIdf();
      let documentsAdded = 0;
      
      for (const doc of SAMPLE_DOCUMENTS) {
        const docStartTime = Date.now();
        
        const tokens = this.tokenizer.tokenize(doc.text.toLowerCase()) || [];
        const filteredTokens = removeStopwords(tokens);
        const processedText = filteredTokens.join(' ');
        
        console.log(`[NATURAL-NODE] Adding document ${doc.id} with ${filteredTokens.length} tokens...`);
        
        tfidf.addDocument(processedText, doc.id);
        
        documentsAdded++;
        const docTime = Date.now() - docStartTime;
        console.log(`[NATURAL-NODE] Document ${doc.id} added in ${docTime}ms`);
        
        if (documentsAdded === 1) {
          try {
            const terms = tfidf.listTerms(0);
            console.log(`[NATURAL-NODE] First document has ${terms.length} terms`);
          } catch (termError) {
            console.warn(`[NATURAL-NODE] Error listing terms for first document: ${termError.message}`);
          }
        }
      }
      
      console.log(`[NATURAL-NODE] All ${documentsAdded} documents added successfully`);
      
      const allTermsResults = [];
      for (let i = 0; i < documentsAdded; i++) {
        try {
          const terms = tfidf.listTerms(i);
          allTermsResults.push({
            docIndex: i,
            termCount: terms.length,
            topTerms: terms.slice(0, 5).map(t => ({ term: t.term, tfidf: t.tfidf }))
          });
          console.log(`[NATURAL-NODE] Document ${i}: ${terms.length} terms`);
        } catch (termError) {
          console.warn(`[NATURAL-NODE] Error processing terms for doc ${i}: ${termError.message}`);
          allTermsResults.push({
            docIndex: i,
            error: termError.message
          });
        }
      }
      
      const result = {
        documentsAdded,
        allTermsResults,
        totalProcessingTime: Date.now() - startTime
      };
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        details: result
      };
    } catch (error) {
      console.error(`[NATURAL-NODE] ${testName} failed:`, error.message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        details: { documentsProcessed: 0 },
        error: error.message
      };
    }
  }
  
  async testMemoryAndPerformance() {
    const startTime = Date.now();
    const testName = 'Memory and Performance Test';
    
    try {
      console.log(`[NATURAL-NODE] Running ${testName}...`);
      
      const getMemoryUsage = () => {
        const usage = process.memoryUsage();
        return {
          heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
          external: Math.round(usage.external / 1024 / 1024),
          rss: Math.round(usage.rss / 1024 / 1024)
        };
      };
      
      const initialMemory = getMemoryUsage();
      console.log(`[NATURAL-NODE] Initial memory usage: ${JSON.stringify(initialMemory)}`);
      
      // Create larger dataset
      const largeDataset = [];
      for (let i = 0; i < 10; i++) {
        SAMPLE_DOCUMENTS.forEach((doc, index) => {
          largeDataset.push({
            id: `${doc.id}-COPY-${i}`,
            text: doc.text + ` This is copy number ${i} with additional text for variation.`
          });
        });
      }
      
      console.log(`[NATURAL-NODE] Testing with ${largeDataset.length} documents...`);
      
      const tfidf = new natural.TfIdf();
      const processingTimes = [];
      
      const batchSize = 10;
      for (let i = 0; i < largeDataset.length; i += batchSize) {
        const batchStart = Date.now();
        const batch = largeDataset.slice(i, i + batchSize);
        
        batch.forEach(doc => {
          const tokens = this.tokenizer.tokenize(doc.text.toLowerCase()) || [];
          const filteredTokens = removeStopwords(tokens);
          const processedText = filteredTokens.join(' ');
          tfidf.addDocument(processedText, doc.id);
        });
        
        const batchTime = Date.now() - batchStart;
        processingTimes.push(batchTime);
        
        const currentMemory = getMemoryUsage();
        console.log(`[NATURAL-NODE] Batch ${Math.floor(i/batchSize) + 1}: ${batch.length} docs in ${batchTime}ms, Memory: ${currentMemory.heapUsed}MB`);
      }
      
      const finalMemory = getMemoryUsage();
      const totalProcessingTime = processingTimes.reduce((sum, time) => sum + time, 0);
      
      const finalTestStart = Date.now();
      try {
        const lastDocTerms = tfidf.listTerms(largeDataset.length - 1);
        console.log(`[NATURAL-NODE] Final document has ${lastDocTerms.length} terms`);
      } catch (finalError) {
        console.warn(`[NATURAL-NODE] Error in final term listing: ${finalError.message}`);
      }
      const finalTestTime = Date.now() - finalTestStart;
      
      const result = {
        documentsProcessed: largeDataset.length,
        totalProcessingTime,
        averageBatchTime: totalProcessingTime / processingTimes.length,
        finalTestTime,
        memoryUsage: {
          initial: initialMemory,
          final: finalMemory,
          increase: {
            heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
            heapTotal: finalMemory.heapTotal - initialMemory.heapTotal
          }
        },
        batchTimes: processingTimes
      };
      
      console.log(`[NATURAL-NODE] ${testName} completed: ${largeDataset.length} docs, ${totalProcessingTime}ms total`);
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        details: result
      };
    } catch (error) {
      console.error(`[NATURAL-NODE] ${testName} failed:`, error.message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        details: null,
        error: error.message
      };
    }
  }
  
  async runAllTests() {
    console.log('[NATURAL-NODE] ================================');
    console.log('[NATURAL-NODE] Starting Natural.js Node.js Tests');
    console.log('[NATURAL-NODE] ================================');
    
    const overallStart = Date.now();
    
    const tests = [
      () => this.testTokenization(),
      () => this.testStemming(), 
      () => this.testTfIdfDocumentProcessing(),
      () => this.testMemoryAndPerformance()
    ];
    
    const results = [];
    
    for (const test of tests) {
      try {
        const result = await test();
        results.push(result);
        
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (testError) {
        console.error(`[NATURAL-NODE] Unexpected error in test: ${testError.message}`);
        results.push({
          testName: 'Unknown Test',
          success: false,
          duration: 0,
          details: null,
          error: testError.message
        });
      }
    }
    
    const overallTime = Date.now() - overallStart;
    
    console.log('[NATURAL-NODE] ================================');
    console.log('[NATURAL-NODE] Node.js Test Summary');
    console.log(`[NATURAL-NODE] Total time: ${overallTime}ms`);
    console.log(`[NATURAL-NODE] Tests passed: ${results.filter(r => r.success).length}/${results.length}`);
    console.log('[NATURAL-NODE] ================================');
    
    return {
      nodeResults: results,
      performanceComparison: {
        nodeTime: overallTime
      }
    };
  }
}

// Main execution
async function main() {
  console.log('Starting natural.js Node.js comparison test...');
  
  const tester = new NaturalJsNodeTester();
  
  try {
    const results = await tester.runAllTests();
    
    console.log('\n=== NODE.JS RESULTS ===');
    console.log(JSON.stringify(results, null, 2));
    
    const successCount = results.nodeResults.filter(r => r.success).length;
    const totalCount = results.nodeResults.length;
    
    if (successCount === totalCount) {
      console.log('\n✅ All Node.js tests passed');
      process.exit(0);
    } else {
      console.log(`\n❌ Node.js test failures: ${totalCount - successCount} failed`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Fatal error during Node.js testing:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run main if this file is executed directly
main();