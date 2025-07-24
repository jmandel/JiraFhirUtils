/**
 * Comprehensive natural.js compatibility test
 * Tests realistic JIRA issue processing with the actual TFIDFProcessor
 */

import natural from 'natural';
import { removeStopwords } from 'stopword';
import { TFIDFProcessor, ProcessableDocument } from './tfidf-processor.ts';

// Realistic JIRA-like test data that mirrors actual issues
const REALISTIC_JIRA_ISSUES: ProcessableDocument[] = [
  {
    key: 'FHIR-12345',
    title: 'Patient resource validation fails for missing required fields',
    description: `When submitting a Patient resource without the required 'identifier' field, 
    the validation should return a clear error message indicating which fields are missing. 
    Currently it throws a generic validation error that doesn't help developers understand 
    what needs to be fixed. This impacts R4 implementations specifically.`,
    summary: 'Patient validation needs better error messages for required fields',
    resolution: 'Fixed by updating validation logic to provide detailed field-level errors'
  },
  {
    key: 'FHIR-12346', 
    title: 'Observation resource timing precision issues in R5',
    description: `The Observation resource effectiveDateTime field is losing precision when 
    converted from internal representation to JSON. Microseconds are being truncated to 
    milliseconds which causes issues with high-precision timing requirements for diagnostic 
    equipment integration. This is specific to FHIR R5 implementations.`,
    summary: 'Fix datetime precision loss in Observation resources',
    resolution: 'Updated JSON serialization to preserve full datetime precision'
  },
  {
    key: 'FHIR-12347',
    title: 'Bundle processing performance degradation with large resource sets', 
    description: `Processing Bundle resources containing more than 1000 entries experiences 
    significant performance degradation. Memory usage increases exponentially and processing 
    time grows from seconds to minutes. This affects batch processing workflows and needs 
    optimization. The issue appears to be related to inefficient resource linking algorithms.`,
    summary: 'Optimize Bundle processing for large resource sets',
    resolution: 'Implemented streaming processing and optimized resource indexing'
  },
  {
    key: 'FHIR-12348',
    title: 'CodeSystem lookup fails for custom terminology',
    description: `When using custom CodeSystem resources with locally defined concepts, 
    the terminology server fails to resolve concept lookups with HTTP 404 errors. 
    This breaks validation workflows that depend on custom vocabularies. The issue 
    seems to be in the URL resolution logic for custom vs standard code systems.`,
    summary: 'Fix CodeSystem resolution for custom terminologies', 
    resolution: null // Unresolved issue
  },
  {
    key: 'FHIR-12349',
    title: 'Questionnaire response validation incorrect for choice fields',
    description: `QuestionnaireResponse validation incorrectly rejects valid answers for 
    choice-type questions when multiple selections are allowed. The validation logic 
    appears to only check for single values even when the corresponding Questionnaire 
    allows multiple answers. This affects clinical assessment workflows.`,
    summary: 'Fix choice field validation in QuestionnaireResponse',
    resolution: 'Updated validation to properly handle multiple choice selections'
  },
  {
    key: 'FHIR-12350',
    title: 'Medication resource dosage instructions parsing error',
    description: `Medication resources with complex dosage instructions containing 
    conditional logic (e.g., "take 2 tablets twice daily if symptoms persist, otherwise 
    once daily") fail to parse correctly. The dosage parser doesn't handle conditional 
    statements properly, leading to incomplete medication instructions.`,
    summary: 'Improve dosage instruction parsing for complex cases',
    resolution: 'Enhanced parser to handle conditional and complex dosage patterns'
  },
  {
    key: 'FHIR-12351',
    title: 'Search parameter handling for chained queries in Practitioner resources',
    description: `Chained search queries like Practitioner?organization.name=Hospital fail 
    with incorrect SQL generation. The query builder doesn't properly handle the join 
    relationships between Practitioner and Organization resources, resulting in empty 
    result sets even when matching data exists in the database.`,
    summary: 'Fix chained search queries for Practitioner resources',
    resolution: null // Unresolved issue
  },
  {
    key: 'FHIR-12352',
    title: 'DiagnosticReport resource attachment handling memory leak',
    description: `DiagnosticReport resources with large binary attachments (medical images, 
    PDFs) are causing memory leaks in the server. Memory usage continuously increases 
    during processing and is not released after the request completes. This eventually 
    leads to out-of-memory errors in production environments.`,
    summary: 'Fix memory leak in DiagnosticReport attachment processing',
    resolution: 'Implemented proper resource cleanup and streaming for large attachments'
  }
];

interface ComprehensiveTestResult {
  testName: string;
  success: boolean;
  duration: number;
  bunResults?: any;
  nodeResults?: any;
  comparison?: {
    identical: boolean;
    differences: string[];
    performanceRatio: number;
  };
  error?: string;
}

class ComprehensiveNaturalTester {
  
  async testBasicCompatibility(): Promise<ComprehensiveTestResult> {
    const testName = 'Basic Natural.js Compatibility';
    const startTime = Date.now();
    
    try {
      console.log(`[COMPREHENSIVE] Running ${testName}...`);
      
      // Test basic natural.js components
      const tokenizer = new natural.WordTokenizer();
      const tfidf = new natural.TfIdf();
      const stemmer = natural.PorterStemmer;
      
      // Test tokenization
      const testText = 'FHIR Patient resource validation fails for missing identifier fields';
      const tokens = tokenizer.tokenize(testText.toLowerCase()) || [];
      const filteredTokens = removeStopwords(tokens);
      
      // Test stemming
      const stemmedTokens = filteredTokens.map(token => stemmer.stem(token));
      
      // Test TF-IDF
      tfidf.addDocument(stemmedTokens.join(' '), 'test-doc');
      const terms = tfidf.listTerms(0);
      
      const results = {
        tokenCount: tokens.length,
        filteredCount: filteredTokens.length, 
        stemmedCount: stemmedTokens.length,
        termCount: terms.length,
        topTerms: terms.slice(0, 5).map(t => t.term)
      };
      
      console.log(`[COMPREHENSIVE] ${testName} - Processed ${tokens.length} tokens → ${terms.length} TF-IDF terms`);
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        bunResults: results
      };
      
    } catch (error) {
      console.error(`[COMPREHENSIVE] ${testName} failed:`, (error as Error).message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }
  
  async testTFIDFProcessorIntegration(): Promise<ComprehensiveTestResult> {
    const testName = 'TFIDFProcessor Integration';
    const startTime = Date.now();
    
    try {
      console.log(`[COMPREHENSIVE] Running ${testName}...`);
      
      // Test with actual TFIDFProcessor class
      const processor = new TFIDFProcessor({
        minDocumentFrequency: 1,
        maxDocumentFrequency: 0.8,
        minTermLength: 2,
        maxTermLength: 30
      });
      
      console.log(`[COMPREHENSIVE] Processing ${REALISTIC_JIRA_ISSUES.length} realistic JIRA issues...`);
      
      // Add documents to processor
      const addStartTime = Date.now();
      REALISTIC_JIRA_ISSUES.forEach(issue => {
        processor.addDocument(issue.key!, processor.preprocessText(
          [issue.title, issue.description, issue.summary, issue.resolution].filter(Boolean).join(' ')
        ).join(' '), issue);
      });
      const addTime = Date.now() - addStartTime;
      
      // Extract keywords
      const keywordStartTime = Date.now();
      const allKeywords = processor.extractAllKeywords(10);
      const keywordTime = Date.now() - keywordStartTime;
      
      // Test similarity
      const similarityStartTime = Date.now();
      const similarDocs = processor.findSimilarDocuments('FHIR-12345', 3);
      const similarityTime = Date.now() - similarityStartTime;
      
      // Export data (testing the database export functions)
      const exportStartTime = Date.now();
      const keywordExports = processor.exportKeywordsForDB(5);
      const corpusExports = processor.exportCorpusStatsForDB();
      const exportTime = Date.now() - exportStartTime;
      
      const results = {
        documentsProcessed: REALISTIC_JIRA_ISSUES.length,
        keywordCount: Array.from(allKeywords.values()).reduce((sum, keywords) => sum + keywords.length, 0),
        similarDocCount: similarDocs.length,
        exportedKeywords: keywordExports.length,
        exportedCorpusStats: corpusExports.length,
        timings: {
          addDocuments: addTime,
          extractKeywords: keywordTime, 
          findSimilar: similarityTime,
          exportData: exportTime
        },
        sampleKeywords: Array.from(allKeywords.entries()).slice(0, 2).map(([docId, keywords]) => ({
          docId,
          keywords: keywords.slice(0, 3).map(k => ({ term: k.term, score: k.tfidf }))
        })),
        similarityResults: similarDocs.map(doc => ({ docId: doc.documentId, similarity: doc.similarity }))
      };
      
      console.log(`[COMPREHENSIVE] ${testName} - Processed ${REALISTIC_JIRA_ISSUES.length} docs, extracted ${keywordExports.length} keywords`);
      console.log(`[COMPREHENSIVE] ${testName} - Timing: add=${addTime}ms, keywords=${keywordTime}ms, similarity=${similarityTime}ms`);
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        bunResults: results
      };
      
    } catch (error) {
      console.error(`[COMPREHENSIVE] ${testName} failed:`, (error as Error).message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }
  
  async testStressConditions(): Promise<ComprehensiveTestResult> {
    const testName = 'Stress Conditions Test';
    const startTime = Date.now();
    
    try {
      console.log(`[COMPREHENSIVE] Running ${testName}...`);
      
      // Create stress test dataset by duplicating and modifying realistic issues
      const stressDataset: ProcessableDocument[] = [];
      for (let i = 0; i < 20; i++) {
        REALISTIC_JIRA_ISSUES.forEach((issue, index) => {
          stressDataset.push({
            ...issue,
            key: `${issue.key}-STRESS-${i}`,
            title: `${issue.title} - Stress Test Variation ${i}`,
            description: `${issue.description} Additional stress test content with random data: ${Math.random().toString(36).substring(7)}`
          });
        });
      }
      
      console.log(`[COMPREHENSIVE] ${testName} - Processing ${stressDataset.length} documents...`);
      
      const processor = new TFIDFProcessor();
      
      // Track memory usage during processing
      const getMemoryMB = () => {
        if (typeof process !== 'undefined' && process.memoryUsage) {
          return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        }
        return 0;
      };
      
      const initialMemory = getMemoryMB();
      
      // Process in batches to simulate streaming
      const batchSize = 20;
      const batchTimes = [];
      let totalProcessed = 0;
      
      for (let i = 0; i < stressDataset.length; i += batchSize) {
        const batchStart = Date.now();
        const batch = stressDataset.slice(i, i + batchSize);
        
        batch.forEach(doc => {
          processor.addDocument(doc.key!, processor.preprocessText(
            [doc.title, doc.description].filter(Boolean).join(' ')
          ).join(' '), doc);
        });
        
        totalProcessed += batch.length;
        const batchTime = Date.now() - batchStart;
        batchTimes.push(batchTime);
        
        if (i % (batchSize * 5) === 0) {
          const currentMemory = getMemoryMB();
          console.log(`[COMPREHENSIVE] ${testName} - Batch ${Math.floor(i/batchSize) + 1}: ${batch.length} docs in ${batchTime}ms, Memory: ${currentMemory}MB`);
        }
      }
      
      const finalMemory = getMemoryMB();
      
      // Test final operations
      const keywordStart = Date.now();
      const allKeywords = processor.extractAllKeywords(5);
      const keywordTime = Date.now() - keywordStart;
      
      const results = {
        documentsProcessed: totalProcessed,
        totalBatches: batchTimes.length,
        averageBatchTime: batchTimes.reduce((sum, t) => sum + t, 0) / batchTimes.length,
        maxBatchTime: Math.max(...batchTimes),
        minBatchTime: Math.min(...batchTimes),
        memoryIncrease: finalMemory - initialMemory,
        finalKeywordCount: Array.from(allKeywords.values()).reduce((sum, kw) => sum + kw.length, 0),
        keywordExtractionTime: keywordTime
      };
      
      console.log(`[COMPREHENSIVE] ${testName} - Processed ${totalProcessed} docs, memory increase: ${results.memoryIncrease}MB`);
      
      return {
        testName,
        success: true,
        duration: Date.now() - startTime,
        bunResults: results
      };
      
    } catch (error) {
      console.error(`[COMPREHENSIVE] ${testName} failed:`, (error as Error).message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }
  
  async testHangSensitiveOperations(): Promise<ComprehensiveTestResult> {
    const testName = 'Hang-Sensitive Operations';
    const startTime = Date.now();
    
    try {
      console.log(`[COMPREHENSIVE] Running ${testName}...`);
      
      // Test operations that might hang in production
      const processor = new TFIDFProcessor();
      
      // Test with pathological text content that might cause hangs
      const pathologicalIssues: ProcessableDocument[] = [
        {
          key: 'HANG-TEST-1',
          title: 'Test with very long repeated text content',
          description: 'A'.repeat(50000) + ' FHIR resource validation ' + 'B'.repeat(50000),
          summary: 'Long text test case'
        },
        {
          key: 'HANG-TEST-2', 
          title: 'Test with many special characters and HTML',
          description: `<div><p>HTML content &amp; entities &lt;&gt; ${'word '.repeat(10000)}</div>`,
          summary: 'HTML and special character test'
        },
        {
          key: 'HANG-TEST-3',
          title: 'Test with complex nested structure',
          description: JSON.stringify({
            nested: {
              deeply: {
                structured: {
                  data: Array(1000).fill('FHIR').join(' '),
                  more: 'content here'
                }
              }
            }
          }),
          summary: 'Nested structure test'
        }
      ];
      
      // Process with timeout monitoring
      const timeouts = [];
      const results = [];
      
      for (const issue of pathologicalIssues) {
        const operationStart = Date.now();
        
        try {
          // Set up operation timeout
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Operation timeout')), 5000); // 5 second timeout
          });
          
          const operationPromise = new Promise<void>((resolve) => {
            processor.addDocument(issue.key!, processor.preprocessText(
              [issue.title, issue.description, issue.summary].filter(Boolean).join(' ')
            ).join(' '), issue);
            resolve();
          });
          
          await Promise.race([operationPromise, timeoutPromise]);
          
          const operationTime = Date.now() - operationStart;
          results.push({
            issueKey: issue.key,
            success: true,
            duration: operationTime
          });
          
          console.log(`[COMPREHENSIVE] ${testName} - ${issue.key}: processed in ${operationTime}ms`);
          
        } catch (error) {
          const operationTime = Date.now() - operationStart;
          if ((error as Error).message === 'Operation timeout') {
            timeouts.push(issue.key);
            console.warn(`[COMPREHENSIVE] ${testName} - ${issue.key}: TIMEOUT after ${operationTime}ms`);
          } else {
            console.error(`[COMPREHENSIVE] ${testName} - ${issue.key}: ERROR - ${(error as Error).message}`);
          }
          
          results.push({
            issueKey: issue.key,
            success: false,
            duration: operationTime,
            error: (error as Error).message
          });
        }
      }
      
      // Test final keyword extraction
      const extractStart = Date.now();
      const allKeywords = processor.extractAllKeywords(3);
      const extractTime = Date.now() - extractStart;
      
      const testResults = {
        pathologicalTestCount: pathologicalIssues.length,
        successfulProcessing: results.filter(r => r.success).length,
        timeouts: timeouts.length,
        timeoutKeys: timeouts,
        averageProcessingTime: results.reduce((sum, r) => sum + r.duration, 0) / results.length,
        keywordExtractionTime: extractTime,
        finalKeywordCount: Array.from(allKeywords.values()).reduce((sum, kw) => sum + kw.length, 0),
        detailedResults: results
      };
      
      console.log(`[COMPREHENSIVE] ${testName} - ${testResults.successfulProcessing}/${pathologicalIssues.length} processed successfully, ${timeouts.length} timeouts`);
      
      return {
        testName,
        success: timeouts.length === 0, // Success if no timeouts occurred
        duration: Date.now() - startTime,
        bunResults: testResults
      };
      
    } catch (error) {
      console.error(`[COMPREHENSIVE] ${testName} failed:`, (error as Error).message);
      return {
        testName,
        success: false,
        duration: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }
  
  async runAllTests(): Promise<ComprehensiveTestResult[]> {
    console.log('[COMPREHENSIVE] ==========================================');
    console.log('[COMPREHENSIVE] Starting Comprehensive Natural.js Tests');
    console.log('[COMPREHENSIVE] Environment: Bun');
    console.log('[COMPREHENSIVE] ==========================================');
    
    const tests = [
      () => this.testBasicCompatibility(),
      () => this.testTFIDFProcessorIntegration(),
      () => this.testStressConditions(),
      () => this.testHangSensitiveOperations()
    ];
    
    const results: ComprehensiveTestResult[] = [];
    
    for (const test of tests) {
      try {
        const result = await test();
        results.push(result);
        
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (testError) {
        console.error(`[COMPREHENSIVE] Test execution error: ${(testError as Error).message}`);
        results.push({
          testName: 'Unknown Test',
          success: false,
          duration: 0,
          error: (testError as Error).message
        });
      }
    }
    
    // Summary
    const successful = results.filter(r => r.success).length;
    const total = results.length;
    const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
    
    console.log('[COMPREHENSIVE] ==========================================');
    console.log('[COMPREHENSIVE] Comprehensive Test Summary');
    console.log(`[COMPREHENSIVE] Tests passed: ${successful}/${total}`);
    console.log(`[COMPREHENSIVE] Total time: ${totalTime}ms`);
    console.log('[COMPREHENSIVE] ==========================================');
    
    return results;
  }
}

// Main execution
if (import.meta.main) {
  console.log('Starting comprehensive natural.js compatibility analysis...');
  
  const tester = new ComprehensiveNaturalTester();
  
  try {
    const results = await tester.runAllTests();
    
    console.log('\n=== COMPREHENSIVE RESULTS ===');
    console.log(JSON.stringify(results, null, 2));
    
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;
    
    if (successCount === totalCount) {
      console.log('\n✅ All comprehensive tests passed - Natural.js fully compatible with Bun');
      process.exit(0);
    } else {
      console.log(`\n❌ Comprehensive test issues: ${totalCount - successCount} test failures`);
      results.filter(r => !r.success).forEach(result => {
        console.log(`   - ${result.testName}: ${result.error || 'Unknown error'}`);
      });
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Fatal error during comprehensive testing:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}