/**
 * Isolated test case for natural.js TF-IDF in Bun environment
 * Tests basic functionality and compares behavior
 */

import natural from 'natural';
import { removeStopwords } from 'stopword';

// Sample test dataset
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

interface TestResult {
  testName: string;
  success: boolean;
  duration: number;
  details: any;
  error?: string;
}

interface ComparisonResult {
  bunResults: TestResult[];
  nodeResults?: TestResult[];
  compatibilityIssues: string[];
  performanceComparison?: {
    bunTime: number;
    nodeTime?: number;
    ratio?: number;
  };
}

class NaturalJsIsolationTester {
  private tfidf: natural.TfIdf;
  private tokenizer: natural.WordTokenizer;
  private stemmer: typeof natural.PorterStemmer;
  
  constructor() {
    this.tfidf = new natural.TfIdf();
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
    
    console.log('[NATURAL-TEST] Initializing Natural.js components...');
    console.log(`[NATURAL-TEST] Natural.js version: ${(natural as any).version || 'unknown'}`);
  }
  
  /**
   * Test basic tokenization functionality
   */
  async testTokenization(): Promise<TestResult> {
    const startTime = Date.now();
    const testName = 'Basic Tokenization';
    
    try {
      console.log(`[NATURAL-TEST] Running ${testName}...`);
      
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
      
      console.log(`[NATURAL-TEST] ${testName} - Original: ${tokens.length} tokens, Filtered: ${filteredTokens.length} tokens`);
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        details: result
      };
    } catch (error) {
      console.error(`[NATURAL-TEST] ${testName} failed:`, (error as Error).message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        details: null,
        error: (error as Error).message
      };
    }
  }
  
  /**
   * Test Porter stemming functionality
   */
  async testStemming(): Promise<TestResult> {
    const startTime = Date.now();
    const testName = 'Porter Stemming';
    
    try {
      console.log(`[NATURAL-TEST] Running ${testName}...`);
      
      const testWords = ['running', 'ran', 'runs', 'healthcare', 'interoperability', 'measurements'];
      const stemmedWords = testWords.map(word => this.stemmer.stem(word));
      
      const result = {
        original: testWords,
        stemmed: stemmedWords,
        pairs: testWords.map((word, i) => ({ original: word, stemmed: stemmedWords[i] }))
      };
      
      console.log(`[NATURAL-TEST] ${testName} - Stemmed ${testWords.length} words`);
      result.pairs.forEach(pair => {
        console.log(`[NATURAL-TEST]   "${pair.original}" → "${pair.stemmed}"`);
      });
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        details: result
      };
    } catch (error) {
      console.error(`[NATURAL-TEST] ${testName} failed:`, (error as Error).message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        details: null,
        error: (error as Error).message
      };
    }
  }
  
  /**
   * Test TF-IDF document addition and processing
   */
  async testTfIdfDocumentProcessing(): Promise<TestResult> {
    const startTime = Date.now();
    const testName = 'TF-IDF Document Processing';
    
    try {
      console.log(`[NATURAL-TEST] Running ${testName}...`);
      
      // Create fresh TF-IDF instance for this test
      const tfidf = new natural.TfIdf();
      let documentsAdded = 0;
      
      // Add sample documents one by one and monitor for hangs
      for (const doc of SAMPLE_DOCUMENTS) {
        const docStartTime = Date.now();
        
        // Preprocess text
        const tokens = this.tokenizer.tokenize(doc.text.toLowerCase()) || [];
        const filteredTokens = removeStopwords(tokens);
        const processedText = filteredTokens.join(' ');
        
        console.log(`[NATURAL-TEST] Adding document ${doc.id} with ${filteredTokens.length} tokens...`);
        
        // This is the critical call that might hang in Bun
        tfidf.addDocument(processedText, doc.id);
        
        documentsAdded++;
        const docTime = Date.now() - docStartTime;
        console.log(`[NATURAL-TEST] Document ${doc.id} added in ${docTime}ms`);
        
        // Test intermediate state
        if (documentsAdded === 1) {
          try {
            const terms = tfidf.listTerms(0);
            console.log(`[NATURAL-TEST] First document has ${terms.length} terms`);
          } catch (termError) {
            console.warn(`[NATURAL-TEST] Error listing terms for first document: ${(termError as Error).message}`);
          }
        }
      }
      
      console.log(`[NATURAL-TEST] All ${documentsAdded} documents added successfully`);
      
      // Test term listing for all documents
      const allTermsResults = [];
      for (let i = 0; i < documentsAdded; i++) {
        try {
          const terms = tfidf.listTerms(i);
          allTermsResults.push({
            docIndex: i,
            termCount: terms.length,
            topTerms: terms.slice(0, 5).map(t => ({ term: t.term, tfidf: t.tfidf }))
          });
          console.log(`[NATURAL-TEST] Document ${i}: ${terms.length} terms`);
        } catch (termError) {
          console.warn(`[NATURAL-TEST] Error processing terms for doc ${i}: ${(termError as Error).message}`);
          allTermsResults.push({
            docIndex: i,
            error: (termError as Error).message
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
      console.error(`[NATURAL-TEST] ${testName} failed:`, (error as Error).message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        details: { documentsProcessed: 0 },
        error: (error as Error).message
      };
    }
  }
  
  /**
   * Test TF-IDF similarity calculations
   */
  async testTfIdfSimilarity(): Promise<TestResult> {
    const startTime = Date.now();
    const testName = 'TF-IDF Similarity Calculations';
    
    try {
      console.log(`[NATURAL-TEST] Running ${testName}...`);
      
      // Use existing TF-IDF instance or create new one
      const tfidf = new natural.TfIdf();
      
      // Add documents
      SAMPLE_DOCUMENTS.forEach(doc => {
        const tokens = this.tokenizer.tokenize(doc.text.toLowerCase()) || [];
        const filteredTokens = removeStopwords(tokens);
        const processedText = filteredTokens.join(' ');
        tfidf.addDocument(processedText, doc.id);
      });
      
      // Test TF-IDF measure between documents
      const similarities = [];
      const testPairs = [
        [0, 1], // Patient vs Observation
        [0, 4], // Patient vs Interoperability
        [1, 2], // Observation vs Medication
      ];
      
      for (const [doc1, doc2] of testPairs) {
        try {
          const similarity = tfidf.tfidf('patient', doc1) - tfidf.tfidf('patient', doc2);
          similarities.push({
            doc1Index: doc1,
            doc2Index: doc2,
            doc1Id: SAMPLE_DOCUMENTS[doc1].id,
            doc2Id: SAMPLE_DOCUMENTS[doc2].id,
            patientTermDifference: similarity
          });
          console.log(`[NATURAL-TEST] Similarity between ${SAMPLE_DOCUMENTS[doc1].id} and ${SAMPLE_DOCUMENTS[doc2].id}: ${similarity}`);
        } catch (simError) {
          console.warn(`[NATURAL-TEST] Error calculating similarity between docs ${doc1} and ${doc2}: ${(simError as Error).message}`);
        }
      }
      
      // Test specific term TF-IDF values
      const termTests = ['patient', 'fhir', 'resource', 'healthcare'];
      const termResults = [];
      
      for (const term of termTests) {
        const termData = { term, values: [] as number[] };
        for (let docIndex = 0; docIndex < SAMPLE_DOCUMENTS.length; docIndex++) {
          try {
            const tfidfValue = tfidf.tfidf(term, docIndex);
            termData.values.push(tfidfValue);
          } catch (termError) {
            console.warn(`[NATURAL-TEST] Error getting TF-IDF for term '${term}' in doc ${docIndex}: ${(termError as Error).message}`);
            termData.values.push(0);
          }
        }
        termResults.push(termData);
        console.log(`[NATURAL-TEST] Term '${term}' TF-IDF values: [${termData.values.join(', ')}]`);
      }
      
      const result = {
        similarities,
        termResults,
        documentsProcessed: SAMPLE_DOCUMENTS.length
      };
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        details: result
      };
    } catch (error) {
      console.error(`[NATURAL-TEST] ${testName} failed:`, (error as Error).message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        details: null,
        error: (error as Error).message
      };
    }
  }
  
  /**
   * Test memory usage and performance under load
   */
  async testMemoryAndPerformance(): Promise<TestResult> {
    const startTime = Date.now();
    const testName = 'Memory and Performance Test';
    
    try {
      console.log(`[NATURAL-TEST] Running ${testName}...`);
      
      const getMemoryUsage = () => {
        if (typeof process !== 'undefined' && process.memoryUsage) {
          const usage = process.memoryUsage();
          return {
            heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
            external: Math.round(usage.external / 1024 / 1024),
            rss: Math.round(usage.rss / 1024 / 1024)
          };
        }
        return { heapUsed: 0, heapTotal: 0, external: 0, rss: 0 };
      };
      
      const initialMemory = getMemoryUsage();
      console.log(`[NATURAL-TEST] Initial memory usage: ${JSON.stringify(initialMemory)}`);
      
      // Create larger dataset by repeating sample documents
      const largeDataset = [];
      for (let i = 0; i < 10; i++) {
        SAMPLE_DOCUMENTS.forEach((doc, index) => {
          largeDataset.push({
            id: `${doc.id}-COPY-${i}`,
            text: doc.text + ` This is copy number ${i} with additional text for variation.`
          });
        });
      }
      
      console.log(`[NATURAL-TEST] Testing with ${largeDataset.length} documents...`);
      
      const tfidf = new natural.TfIdf();
      const processingTimes = [];
      
      // Process documents in batches to monitor progress
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
        console.log(`[NATURAL-TEST] Batch ${Math.floor(i/batchSize) + 1}: ${batch.length} docs in ${batchTime}ms, Memory: ${currentMemory.heapUsed}MB`);
      }
      
      const finalMemory = getMemoryUsage();
      const totalProcessingTime = processingTimes.reduce((sum, time) => sum + time, 0);
      
      // Test final operations
      const finalTestStart = Date.now();
      try {
        const lastDocTerms = tfidf.listTerms(largeDataset.length - 1);
        console.log(`[NATURAL-TEST] Final document has ${lastDocTerms.length} terms`);
      } catch (finalError) {
        console.warn(`[NATURAL-TEST] Error in final term listing: ${(finalError as Error).message}`);
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
      
      console.log(`[NATURAL-TEST] ${testName} completed: ${largeDataset.length} docs, ${totalProcessingTime}ms total`);
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        details: result
      };
    } catch (error) {
      console.error(`[NATURAL-TEST] ${testName} failed:`, (error as Error).message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        details: null,
        error: (error as Error).message
      };
    }
  }
  
  /**
   * Run all tests and return comprehensive results
   */
  async runAllTests(): Promise<ComparisonResult> {
    console.log('[NATURAL-TEST] ================================');
    console.log('[NATURAL-TEST] Starting Natural.js Isolation Tests');
    console.log('[NATURAL-TEST] Environment: Bun');
    console.log('[NATURAL-TEST] ================================');
    
    const overallStart = Date.now();
    
    const tests = [
      () => this.testTokenization(),
      () => this.testStemming(),
      () => this.testTfIdfDocumentProcessing(),
      () => this.testTfIdfSimilarity(),
      () => this.testMemoryAndPerformance()
    ];
    
    const results: TestResult[] = [];
    const compatibilityIssues: string[] = [];
    
    for (const test of tests) {
      try {
        const result = await test();
        results.push(result);
        
        if (!result.success) {
          compatibilityIssues.push(`${result.testName}: ${result.error || 'Unknown error'}`);
        }
        
        // Add delay between tests to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (testError) {
        console.error(`[NATURAL-TEST] Unexpected error in test: ${(testError as Error).message}`);
        results.push({
          testName: 'Unknown Test',
          success: false,
          duration: 0,
          details: null,
          error: (testError as Error).message
        });
        compatibilityIssues.push(`Test execution error: ${(testError as Error).message}`);
      }
    }
    
    const overallTime = Date.now() - overallStart;
    
    console.log('[NATURAL-TEST] ================================');
    console.log('[NATURAL-TEST] Test Summary');
    console.log(`[NATURAL-TEST] Total time: ${overallTime}ms`);
    console.log(`[NATURAL-TEST] Tests passed: ${results.filter(r => r.success).length}/${results.length}`);
    console.log(`[NATURAL-TEST] Compatibility issues: ${compatibilityIssues.length}`);
    console.log('[NATURAL-TEST] ================================');
    
    return {
      bunResults: results,
      compatibilityIssues,
      performanceComparison: {
        bunTime: overallTime
      }
    };
  }
}

// Export for testing
export { NaturalJsIsolationTester, SAMPLE_DOCUMENTS };

// Main execution when run directly
if (import.meta.main) {
  console.log('Starting natural.js isolation test in Bun environment...');
  
  const tester = new NaturalJsIsolationTester();
  
  try {
    const results = await tester.runAllTests();
    
    console.log('\n=== FINAL RESULTS ===');
    console.log(JSON.stringify(results, null, 2));
    
    const successCount = results.bunResults.filter(r => r.success).length;
    const totalCount = results.bunResults.length;
    
    if (successCount === totalCount && results.compatibilityIssues.length === 0) {
      console.log('\n✅ All tests passed - Natural.js appears compatible with Bun');
      process.exit(0);
    } else {
      console.log(`\n❌ Issues detected: ${results.compatibilityIssues.length} compatibility issues, ${totalCount - successCount} test failures`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Fatal error during testing:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}