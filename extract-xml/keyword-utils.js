import Database from "better-sqlite3";

export class KeywordUtils {
  constructor(dbPath = "./jira_issues.sqlite") {
    this.db = new Database(dbPath);
  }

  /**
   * Get top keywords for a specific issue
   */
  getIssueKeywords(issueKey, limit = 10) {
    const query = `
      SELECT 
        keyword,
        tfidf_score,
        tf_score,
        idf_score
      FROM tfidf_keywords
      WHERE issue_key = ?
      ORDER BY tfidf_score DESC
      LIMIT ?
    `;
    
    return this.db.prepare(query).all(issueKey, limit);
  }

  /**
   * Find issues by keywords
   */
  searchByKeywords(keywords, limit = 20) {
    if (!Array.isArray(keywords)) {
      keywords = [keywords];
    }
    
    const placeholders = keywords.map(() => '?').join(',');
    const query = `
      SELECT 
        issue_key,
        GROUP_CONCAT(keyword) as matching_keywords,
        SUM(tfidf_score) as total_score,
        COUNT(DISTINCT keyword) as match_count
      FROM tfidf_keywords
      WHERE keyword IN (${placeholders})
      GROUP BY issue_key
      ORDER BY match_count DESC, total_score DESC
      LIMIT ?
    `;
    
    return this.db.prepare(query).all(...keywords, limit);
  }

  /**
   * Find similar issues based on keyword overlap
   */
  findSimilarIssues(issueKey, limit = 10) {
    // First get keywords for the source issue
    const sourceKeywords = this.getIssueKeywords(issueKey, 20);
    
    if (sourceKeywords.length === 0) {
      return [];
    }
    
    // Calculate weighted keyword list
    const keywordWeights = new Map();
    sourceKeywords.forEach(kw => {
      keywordWeights.set(kw.keyword, kw.tfidf_score);
    });
    
    // Find issues with overlapping keywords
    const keywords = Array.from(keywordWeights.keys());
    const placeholders = keywords.map(() => '?').join(',');
    
    const query = `
      SELECT 
        t1.issue_key,
        GROUP_CONCAT(t1.keyword) as common_keywords,
        SUM(t1.tfidf_score * ?) as similarity_score,
        COUNT(DISTINCT t1.keyword) as common_count,
        i.title,
        i.status
      FROM tfidf_keywords t1
      JOIN issues i ON t1.issue_key = i.key
      WHERE t1.keyword IN (${placeholders})
        AND t1.issue_key != ?
      GROUP BY t1.issue_key
      ORDER BY similarity_score DESC
      LIMIT ?
    `;
    
    // Build parameters with weights
    const params = [];
    keywords.forEach(kw => {
      params.push(keywordWeights.get(kw));
    });
    params.push(...keywords, issueKey, limit);
    
    return this.db.prepare(query).all(...params);
  }

  /**
   * Get keyword trends over time
   */
  getKeywordTrends(keyword, groupBy = 'month') {
    let dateFormat;
    switch (groupBy) {
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        dateFormat = '%Y-%W';
        break;
      case 'month':
        dateFormat = '%Y-%m';
        break;
      case 'year':
        dateFormat = '%Y';
        break;
      default:
        dateFormat = '%Y-%m';
    }
    
    const query = `
      SELECT 
        strftime('${dateFormat}', i.created) as period,
        COUNT(DISTINCT tk.issue_key) as issue_count,
        AVG(tk.tfidf_score) as avg_score,
        MAX(tk.tfidf_score) as max_score
      FROM tfidf_keywords tk
      JOIN issues i ON tk.issue_key = i.key
      WHERE tk.keyword = ?
      GROUP BY period
      ORDER BY period
    `;
    
    return this.db.prepare(query).all(keyword);
  }

  /**
   * Get top keywords for a project
   */
  getProjectKeywords(projectKey, limit = 20) {
    const query = `
      SELECT 
        tk.keyword,
        COUNT(DISTINCT tk.issue_key) as issue_count,
        AVG(tk.tfidf_score) as avg_score,
        SUM(tk.tfidf_score) as total_score
      FROM tfidf_keywords tk
      JOIN issues i ON tk.issue_key = i.key
      WHERE i.project_key = ?
      GROUP BY tk.keyword
      ORDER BY issue_count DESC, total_score DESC
      LIMIT ?
    `;
    
    return this.db.prepare(query).all(projectKey, limit);
  }

  /**
   * Get keyword co-occurrence matrix
   */
  getKeywordCooccurrence(topN = 50) {
    // Get top N keywords
    const topKeywords = this.db.prepare(`
      SELECT 
        keyword,
        COUNT(*) as frequency
      FROM tfidf_keywords
      GROUP BY keyword
      ORDER BY frequency DESC
      LIMIT ?
    `).all(topN);
    
    const keywords = topKeywords.map(k => k.keyword);
    const cooccurrence = new Map();
    
    // For each pair of keywords, count co-occurrences
    for (let i = 0; i < keywords.length; i++) {
      for (let j = i + 1; j < keywords.length; j++) {
        const kw1 = keywords[i];
        const kw2 = keywords[j];
        
        const count = this.db.prepare(`
          SELECT COUNT(DISTINCT t1.issue_key) as count
          FROM tfidf_keywords t1
          JOIN tfidf_keywords t2 ON t1.issue_key = t2.issue_key
          WHERE t1.keyword = ? AND t2.keyword = ?
        `).get(kw1, kw2).count;
        
        if (count > 0) {
          const key = `${kw1}|${kw2}`;
          cooccurrence.set(key, count);
        }
      }
    }
    
    return cooccurrence;
  }

  /**
   * Get keyword statistics
   */
  getKeywordStats() {
    const stats = {};
    
    // Total keywords
    stats.totalKeywords = this.db.prepare(
      "SELECT COUNT(DISTINCT keyword) as count FROM tfidf_keywords"
    ).get().count;
    
    // Total keyword occurrences
    stats.totalOccurrences = this.db.prepare(
      "SELECT COUNT(*) as count FROM tfidf_keywords"
    ).get().count;
    
    // Issues with keywords
    stats.issuesWithKeywords = this.db.prepare(
      "SELECT COUNT(DISTINCT issue_key) as count FROM tfidf_keywords"
    ).get().count;
    
    // Average keywords per issue
    stats.avgKeywordsPerIssue = stats.totalOccurrences / stats.issuesWithKeywords;
    
    // Top keywords by frequency
    stats.topKeywordsByFrequency = this.db.prepare(`
      SELECT 
        keyword,
        COUNT(*) as issue_count,
        AVG(tfidf_score) as avg_score
      FROM tfidf_keywords
      GROUP BY keyword
      ORDER BY issue_count DESC
      LIMIT 10
    `).all();
    
    // Top keywords by average TF-IDF score
    stats.topKeywordsByScore = this.db.prepare(`
      SELECT 
        keyword,
        AVG(tfidf_score) as avg_score,
        COUNT(*) as issue_count
      FROM tfidf_keywords
      GROUP BY keyword
      HAVING issue_count >= 5
      ORDER BY avg_score DESC
      LIMIT 10
    `).all();
    
    return stats;
  }

  /**
   * Export keywords for visualization
   */
  exportKeywordsForVisualization(limit = 100) {
    const keywords = this.db.prepare(`
      SELECT 
        keyword,
        COUNT(*) as frequency,
        AVG(tfidf_score) as avg_score,
        MAX(tfidf_score) as max_score
      FROM tfidf_keywords
      GROUP BY keyword
      ORDER BY frequency DESC
      LIMIT ?
    `).all(limit);
    
    // Format for common visualization libraries
    return {
      nodes: keywords.map(kw => ({
        id: kw.keyword,
        label: kw.keyword,
        value: kw.frequency,
        score: kw.avg_score
      })),
      metadata: {
        totalKeywords: keywords.length,
        maxFrequency: keywords[0]?.frequency || 0,
        minFrequency: keywords[keywords.length - 1]?.frequency || 0
      }
    };
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}

// Export convenience functions
export function getIssueKeywords(issueKey, limit = 10) {
  const utils = new KeywordUtils();
  const results = utils.getIssueKeywords(issueKey, limit);
  utils.close();
  return results;
}

export function findSimilarIssues(issueKey, limit = 10) {
  const utils = new KeywordUtils();
  const results = utils.findSimilarIssues(issueKey, limit);
  utils.close();
  return results;
}

export function searchByKeywords(keywords, limit = 20) {
  const utils = new KeywordUtils();
  const results = utils.searchByKeywords(keywords, limit);
  utils.close();
  return results;
}