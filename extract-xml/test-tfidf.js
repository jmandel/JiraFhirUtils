import { KeywordUtils } from "./keyword-utils.js";
import Database from "better-sqlite3";
import { getDatabasePath, setupDatabaseCliArgs } from "./database-utils.js";

// Test the TF-IDF implementation
async function testTFIDF() {
  console.log("Testing TF-IDF implementation...\n");
  
  // Setup CLI arguments
  const options = setupDatabaseCliArgs('test-tfidf', 'Test TF-IDF implementation and keyword utilities');
  
  const databasePath = getDatabasePath();
  console.log(`Using database: ${databasePath}`);
  
  const db = new Database(databasePath);
  
  try {
    // Check if TF-IDF tables exist
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tfidf%'"
    ).all();
    
    if (tables.length === 0) {
      console.log("❌ TF-IDF tables not found. Please run 'npm run create-tfidf' first.");
      return;
    }
    
    console.log("✅ Found TF-IDF tables:", tables.map(t => t.name).join(', '));
    
    // Check keyword count
    const keywordCount = db.prepare(
      "SELECT COUNT(DISTINCT keyword) as count FROM tfidf_keywords"
    ).get();
    
    console.log(`\n📊 Total unique keywords: ${keywordCount.count}`);
    
    // Test KeywordUtils
    const utils = new KeywordUtils(databasePath);
    
    // Get statistics
    console.log("\n📈 Keyword Statistics:");
    const stats = utils.getKeywordStats();
    console.log(`- Total keyword occurrences: ${stats.totalOccurrences}`);
    console.log(`- Issues with keywords: ${stats.issuesWithKeywords}`);
    console.log(`- Average keywords per issue: ${stats.avgKeywordsPerIssue.toFixed(2)}`);
    
    // Show top keywords
    console.log("\n🔝 Top 10 Keywords by Frequency:");
    stats.topKeywordsByFrequency.forEach((kw, idx) => {
      console.log(`${idx + 1}. "${kw.keyword}" - ${kw.issue_count} issues (avg TF-IDF: ${kw.avg_score.toFixed(4)})`);
    });
    
    // Test with a sample issue
    const sampleIssue = db.prepare(
      "SELECT issue_key FROM tfidf_keywords GROUP BY issue_key LIMIT 1"
    ).get();
    
    if (sampleIssue) {
      console.log(`\n🔍 Keywords for issue ${sampleIssue.issue_key}:`);
      const keywords = utils.getIssueKeywords(sampleIssue.issue_key, 10);
      keywords.forEach((kw, idx) => {
        console.log(`${idx + 1}. "${kw.keyword}" (TF-IDF: ${kw.tfidf_score.toFixed(4)})`);
      });
      
      // Find similar issues
      console.log(`\n🔗 Similar issues to ${sampleIssue.issue_key}:`);
      const similar = utils.findSimilarIssues(sampleIssue.issue_key, 5);
      similar.forEach((issue, idx) => {
        console.log(`${idx + 1}. ${issue.issue_key} - "${issue.title}" (similarity: ${issue.similarity_score.toFixed(2)})`);
      });
    }
    
    // Test keyword search
    console.log("\n🔎 Testing keyword search for 'FHIR':");
    const searchResults = utils.searchByKeywords(['FHIR'], 5);
    searchResults.forEach((result, idx) => {
      console.log(`${idx + 1}. ${result.issue_key} (score: ${result.total_score.toFixed(2)})`);
    });
    
    utils.close();
    console.log("\n✅ All tests completed successfully!");
    
  } catch (error) {
    console.error("❌ Error during testing:", error);
  } finally {
    db.close();
  }
}

// Run tests
testTFIDF();