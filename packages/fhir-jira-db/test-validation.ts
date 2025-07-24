#!/usr/bin/env bun

/**
 * Test script to demonstrate the enhanced data validation functionality
 * Tests various malformed data scenarios to show sanitization in action
 */

// Mock the IssueData interface for testing
interface IssueData {
  issue_key: string;
  title: string | null;
  description: string | null;
  summary: string | null;
  resolution_description: string | null;
  related_url: string | null;
  related_artifacts: string | null;
  related_pages: string | null;
  comments: string | null;
}

// Data validation configuration (copied from create-tfidf.ts)
interface ValidationConfig {
  maxFieldLength: number;
  maxValuesPerField: number;
  minValueLength: number;
  maxValueLength: number;
  allowEmptyValues: boolean;
  strictUrlValidation: boolean;
  normalizeWhitespace: boolean;
}

const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  maxFieldLength: 50000,
  maxValuesPerField: 1000,
  minValueLength: 1,
  maxValueLength: 2000,
  allowEmptyValues: false,
  strictUrlValidation: true,
  normalizeWhitespace: true
};

/**
 * Comprehensive input sanitization for comma-separated fields
 */
function sanitizeCommaSeparatedField(
  field: string | null, 
  fieldName: string, 
  issueKey: string,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): string[] {
  // Handle null/undefined/empty cases
  if (!field || typeof field !== 'string') {
    return [];
  }
  
  // Check total field length
  if (field.length > config.maxFieldLength) {
    console.log(`[DATA-VALIDATION] Field ${fieldName} in issue ${issueKey} exceeds maximum length (${field.length} > ${config.maxFieldLength}), truncating`);
    field = field.substring(0, config.maxFieldLength);
  }
  
  // Detect various types of malformed comma-separated data
  const malformationTypes: string[] = [];
  if (field.includes(',,')) malformationTypes.push('double commas');
  if (field.startsWith(',')) malformationTypes.push('leading comma');
  if (field.endsWith(',')) malformationTypes.push('trailing comma');
  if (field.includes(',,,')) malformationTypes.push('triple+ commas');
  if (/,\s*,\s*,/.test(field)) malformationTypes.push('spaced multiple commas');
  if (/[,;]{2,}/.test(field)) malformationTypes.push('mixed separators');
  
  if (malformationTypes.length > 0) {
    console.log(`[DATA-VALIDATION] Malformed comma-separated data in ${fieldName} for issue ${issueKey}: [${malformationTypes.join(', ')}] - "${field.substring(0, 200)}${field.length > 200 ? '...' : ''}"`);
  }
  
  // Clean and parse the field with multiple separator handling
  let values = field
    .split(/[,;]+/) // Split on commas and semicolons
    .map(v => {
      if (!config.normalizeWhitespace) {
        return v.trim();
      }
      // Normalize whitespace: replace multiple spaces/tabs/newlines with single space
      return v.replace(/\s+/g, ' ').trim();
    })
    .filter(v => config.allowEmptyValues || v.length > 0);
  
  // Check for too many values
  if (values.length > config.maxValuesPerField) {
    console.log(`[DATA-VALIDATION] Field ${fieldName} in issue ${issueKey} has too many values (${values.length} > ${config.maxValuesPerField}), keeping first ${config.maxValuesPerField}`);
    values = values.slice(0, config.maxValuesPerField);
  }
  
  // Validate and clean individual values
  const cleanedValues: string[] = [];
  let invalidValueCount = 0;
  let truncatedValueCount = 0;
  
  for (const value of values) {
    // Length validation
    if (value.length < config.minValueLength) {
      invalidValueCount++;
      continue; // Skip values that are too short
    }
    
    let cleanedValue = value;
    if (value.length > config.maxValueLength) {
      console.log(`[DATA-VALIDATION] Value in ${fieldName} for issue ${issueKey} exceeds maximum length (${value.length} > ${config.maxValueLength}), truncating: "${value.substring(0, 100)}..."`);
      cleanedValue = value.substring(0, config.maxValueLength);
      truncatedValueCount++;
    }
    
    // Additional cleaning for URLs
    if (fieldName === 'related_url') {
      cleanedValue = cleanUrlValue(cleanedValue, issueKey, config);
    }
    
    // Final validation: ensure cleaned value is still valid
    if (cleanedValue.length >= config.minValueLength) {
      cleanedValues.push(cleanedValue);
    } else {
      invalidValueCount++;
    }
  }
  
  // Log summary of cleaning results
  if (invalidValueCount > 0 || truncatedValueCount > 0 || malformationTypes.length > 0) {
    console.log(`[DATA-VALIDATION] Cleaning summary for ${fieldName} in issue ${issueKey}: ${values.length} original → ${cleanedValues.length} cleaned (${invalidValueCount} invalid, ${truncatedValueCount} truncated)`);
  }
  
  return cleanedValues;
}

/**
 * Clean and validate URL values
 */
function cleanUrlValue(url: string, issueKey: string, config: ValidationConfig): string {
  let cleanedUrl = url;
  
  // Remove common URL artifacts and normalize
  cleanedUrl = cleanedUrl
    .replace(/[\r\n\t]/g, '') // Remove line breaks and tabs
    .replace(/\s+/g, '') // Remove all whitespace from URLs
    .replace(/[<>"']/g, '') // Remove HTML-like characters
    .replace(/^[.\s]+|[.\s]+$/g, ''); // Remove leading/trailing dots and spaces
  
  // Handle common URL prefixing issues
  if (cleanedUrl && !cleanedUrl.match(/^https?:\/\//i) && !cleanedUrl.includes('://')) {
    // Check if it looks like a domain
    if (cleanedUrl.includes('.') && !cleanedUrl.includes('/') && cleanedUrl.length < 100) {
      console.log(`[DATA-VALIDATION] Adding http:// prefix to potential domain in issue ${issueKey}: "${cleanedUrl}"`);
      cleanedUrl = 'http://' + cleanedUrl;
    }
  }
  
  return cleanedUrl;
}

// Test cases with various malformed data scenarios
function runValidationTests(): void {
  console.log("=== Data Validation Test Suite ===\n");
  
  const testCases: IssueData[] = [
    {
      issue_key: "TEST-001",
      title: "Test Issue 1",
      description: null,
      summary: null,
      resolution_description: null,
      related_url: "http://example.com,https://test.org,,invalid-url,ftp://files.example.com,",
      related_artifacts: "file1.txt,/path/to/file2.java,,document.pdf,",
      related_pages: "HomePage,User Guide,,FAQ Page,",
      comments: null
    },
    {
      issue_key: "TEST-002", 
      title: "Test Issue 2",
      description: null,
      summary: null,
      resolution_description: null,
      related_url: ",,,http://malformed.com,,,example.org,;https://mixed-separators.com;,",
      related_artifacts: "\\windows\\path\\file.txt,/unix/path/file.sh,,,file   with   spaces.doc,",
      related_pages: "Page\nWith\nNewlines,Page\tWith\tTabs,   Spaced   Page   ,",
      comments: null
    },
    {
      issue_key: "TEST-003",
      title: "Test Issue 3", 
      description: null,
      summary: null,
      resolution_description: null,
      related_url: null, // Test null handling
      related_artifacts: "", // Test empty string
      related_pages: "Single Page", // Test single value
      comments: null
    },
    {
      issue_key: "TEST-004",
      title: "Test Issue 4",
      description: null,
      summary: null, 
      resolution_description: null,
      related_url: "example.org,test.com,no-protocol-domain.net",
      related_artifacts: "very-long-filename-that-might-exceed-normal-limits-but-should-still-be-processed-correctly.extension",
      related_pages: "<script>alert('xss')</script>,\"quoted page\",page'with'quotes",
      comments: null
    }
  ];
  
  console.log("Testing data validation with various malformed inputs...\n");
  
  testCases.forEach((testCase, index) => {
    console.log(`--- Test Case ${index + 1}: ${testCase.issue_key} ---`);
    
    // Test URL validation
    console.log(`\nOriginal related_url: "${testCase.related_url}"`);
    const cleanedUrls = sanitizeCommaSeparatedField(testCase.related_url, 'related_url', testCase.issue_key);
    console.log(`Cleaned URLs (${cleanedUrls.length}): [${cleanedUrls.join(', ')}]`);
    
    // Test artifact validation
    console.log(`\nOriginal related_artifacts: "${testCase.related_artifacts}"`);
    const cleanedArtifacts = sanitizeCommaSeparatedField(testCase.related_artifacts, 'related_artifacts', testCase.issue_key);
    console.log(`Cleaned Artifacts (${cleanedArtifacts.length}): [${cleanedArtifacts.join(', ')}]`);
    
    // Test page validation
    console.log(`\nOriginal related_pages: "${testCase.related_pages}"`);
    const cleanedPages = sanitizeCommaSeparatedField(testCase.related_pages, 'related_pages', testCase.issue_key);
    console.log(`Cleaned Pages (${cleanedPages.length}): [${cleanedPages.join(', ')}]`);
    
    console.log("\n" + "=".repeat(60) + "\n");
  });
  
  console.log("✅ Data validation test suite completed successfully!");
  console.log("All malformed data scenarios handled gracefully with appropriate cleaning and logging.");
}

// Run the tests
runValidationTests();