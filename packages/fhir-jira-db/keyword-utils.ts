import { Database } from "bun:sqlite";
import { getDatabasePath } from "@jira-fhir-utils/database-utils";

// Type definitions for database records
interface KeywordRecord {
  keyword: string;
  tfidf_score: number;
  tf_score: number;
  idf_score: number;
}

interface KeywordSearchResult {
  issue_key: string;
  matching_keywords: string;
  total_score: number;
  match_count: number;
}

interface SimilarIssueResult {
  issue_key: string;
  common_keywords: string;
  similarity_score: number;
  common_count: number;
  title: string;
  status: string;
}

interface KeywordTrendResult {
  period: string;
  issue_count: number;
  avg_score: number;
  max_score: number;
}

interface ProjectKeywordResult {
  keyword: string;
  issue_count: number;
  avg_score: number;
  total_score: number;
}

interface TopKeywordResult {
  keyword: string;
  frequency: number;
}

interface KeywordStatsFrequency {
  keyword: string;
  issue_count: number;
  avg_score: number;
}

interface KeywordStatsScore {
  keyword: string;
  avg_score: number;
  issue_count: number;
}

interface KeywordStats {
  totalKeywords: number;
  totalOccurrences: number;
  issuesWithKeywords: number;
  avgKeywordsPerIssue: number;
  topKeywordsByFrequency: KeywordStatsFrequency[];
  topKeywordsByScore: KeywordStatsScore[];
}

interface VisualizationNode {
  id: string;
  label: string;
  value: number;
  score: number;
}

interface VisualizationData {
  nodes: VisualizationNode[];
  metadata: {
    totalKeywords: number;
    maxFrequency: number;
    minFrequency: number;
  };
}

interface KeywordVisualizationResult {
  keyword: string;
  frequency: number;
  avg_score: number;
  max_score: number;
}

type GroupByPeriod = 'day' | 'week' | 'month' | 'year';

export class KeywordUtils {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  /**
   * Create a new KeywordUtils instance with database path resolution
   */
  static async create(dbPath: string | null = null): Promise<KeywordUtils> {
    const databasePath = dbPath || await getDatabasePath();
    return new KeywordUtils(databasePath);
  }

  /**
   * Get top keywords for a specific issue
   */
  getIssueKeywords(issueKey: string, limit: number = 10): KeywordRecord[] {
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
    
    return this.db.prepare(query).all(issueKey, limit) as KeywordRecord[];
  }

  /**
   * Find issues by keywords
   */
  searchByKeywords(keywords: string | string[], limit: number = 20): KeywordSearchResult[] {
    let keywordArray: string[];
    if (!Array.isArray(keywords)) {
      keywordArray = [keywords];
    } else {
      keywordArray = keywords;
    }
    
    const placeholders = keywordArray.map(() => '?').join(',');
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
    
    return this.db.prepare(query).all(...keywordArray, limit) as KeywordSearchResult[];
  }

  /**
   * Find similar issues based on keyword overlap
   */
  findSimilarIssues(issueKey: string, limit: number = 10): SimilarIssueResult[] {
    // First get keywords for the source issue
    const sourceKeywords = this.getIssueKeywords(issueKey, 20);
    
    if (sourceKeywords.length === 0) {
      return [];
    }
    
    // Calculate weighted keyword list
    const keywordWeights = new Map<string, number>();
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
    const params: (string | number)[] = [];
    keywords.forEach(kw => {
      const weight = keywordWeights.get(kw);
      if (weight !== undefined) {
        params.push(weight);
      }
    });
    params.push(...keywords, issueKey, limit);
    
    return this.db.prepare(query).all(...params) as SimilarIssueResult[];
  }

  /**
   * Get keyword trends over time
   */
  getKeywordTrends(keyword: string, groupBy: GroupByPeriod = 'month'): KeywordTrendResult[] {
    let dateFormat: string;
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
    
    return this.db.prepare(query).all(keyword) as KeywordTrendResult[];
  }

  /**
   * Get top keywords for a project
   */
  getProjectKeywords(projectKey: string, limit: number = 20): ProjectKeywordResult[] {
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
    
    return this.db.prepare(query).all(projectKey, limit) as ProjectKeywordResult[];
  }

  /**
   * Get keyword co-occurrence matrix
   */
  getKeywordCooccurrence(topN: number = 50): Map<string, number> {
    // Get top N keywords
    const topKeywords = this.db.prepare(`
      SELECT 
        keyword,
        COUNT(*) as frequency
      FROM tfidf_keywords
      GROUP BY keyword
      ORDER BY frequency DESC
      LIMIT ?
    `).all(topN) as TopKeywordResult[];
    
    const keywords = topKeywords.map(k => k.keyword);
    const cooccurrence = new Map<string, number>();
    
    // For each pair of keywords, count co-occurrences
    for (let i = 0; i < keywords.length; i++) {
      for (let j = i + 1; j < keywords.length; j++) {
        const kw1 = keywords[i];
        const kw2 = keywords[j];
        
        const result = this.db.prepare(`
          SELECT COUNT(DISTINCT t1.issue_key) as count
          FROM tfidf_keywords t1
          JOIN tfidf_keywords t2 ON t1.issue_key = t2.issue_key
          WHERE t1.keyword = ? AND t2.keyword = ?
        `).get(kw1, kw2) as { count: number };
        
        if (result.count > 0) {
          const key = `${kw1}|${kw2}`;
          cooccurrence.set(key, result.count);
        }
      }
    }
    
    return cooccurrence;
  }

  /**
   * Get keyword statistics
   */
  getKeywordStats(): KeywordStats {
    const stats: Partial<KeywordStats> = {};
    
    // Total keywords
    const totalKeywordsResult = this.db.prepare(
      "SELECT COUNT(DISTINCT keyword) as count FROM tfidf_keywords"
    ).get() as { count: number };
    stats.totalKeywords = totalKeywordsResult.count;
    
    // Total keyword occurrences
    const totalOccurrencesResult = this.db.prepare(
      "SELECT COUNT(*) as count FROM tfidf_keywords"
    ).get() as { count: number };
    stats.totalOccurrences = totalOccurrencesResult.count;
    
    // Issues with keywords
    const issuesWithKeywordsResult = this.db.prepare(
      "SELECT COUNT(DISTINCT issue_key) as count FROM tfidf_keywords"
    ).get() as { count: number };
    stats.issuesWithKeywords = issuesWithKeywordsResult.count;
    
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
    `).all() as KeywordStatsFrequency[];
    
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
    `).all() as KeywordStatsScore[];
    
    return stats as KeywordStats;
  }

  /**
   * Export keywords for visualization
   */
  exportKeywordsForVisualization(limit: number = 100): VisualizationData {
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
    `).all(limit) as KeywordVisualizationResult[];
    
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
  close(): void {
    this.db.close();
  }
}

// Export convenience functions
export async function getIssueKeywords(issueKey: string, limit: number = 10, dbPath: string | null = null): Promise<KeywordRecord[]> {
  const utils = await KeywordUtils.create(dbPath);
  const results = utils.getIssueKeywords(issueKey, limit);
  utils.close();
  return results;
}

export async function findSimilarIssues(issueKey: string, limit: number = 10, dbPath: string | null = null): Promise<SimilarIssueResult[]> {
  const utils = await KeywordUtils.create(dbPath);
  const results = utils.findSimilarIssues(issueKey, limit);
  utils.close();
  return results;
}

export async function searchByKeywords(keywords: string | string[], limit: number = 20, dbPath: string | null = null): Promise<KeywordSearchResult[]> {
  const utils = await KeywordUtils.create(dbPath);
  const results = utils.searchByKeywords(keywords, limit);
  utils.close();
  return results;
}