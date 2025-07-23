#!/usr/bin/env bun

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema,  } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolRequest, CallToolResult, ListToolsResult, } from '@modelcontextprotocol/sdk/types.js';
import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { program } from 'commander';
import { getDatabasePath, setupDatabaseCliArgs } from '@jira-fhir-utils/database-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _defaultSearchFields = [
  'title', 
  'description', 
  'summary', 
  'resolution_description'
] as const;

type SearchField = typeof _defaultSearchFields[number];

interface DatabaseOptions {
  [key: string]: any;
}

interface IssueRecord {
  issue_key: string;
  project_key: string;
  work_group: string;
  title: string;
  description: string;
  summary: string;
  resolution_description: string;
  resolution: string;
  status: string;
  assignee: string;
  updated_at: string;
  issue_int: number;
  related_url?: string;
  related_artifacts?: string;
  related_pages?: string;
  [key: string]: any;
}

interface ListIssuesArgs {
  project_key?: string;
  work_group?: string;
  resolution?: string;
  status?: string;
  assignee?: string;
  limit?: number;
  offset?: number;
}

interface SearchIssuesArgs {
  keywords: string;
  search_fields?: SearchField[];
  limit?: number;
}

interface RelatedIssuesArgs {
  issue_key: string;
  limit?: number;
}

interface IssueDetailsArgs {
  issue_key: string;
}

interface IssueCommentsArgs {
  issue_key: string;
}

interface CustomFieldRecord {
  field_name: string;
  field_value: string;
}

interface CommentRecord {
  issue_key: string;
  created_at: string;
  [key: string]: any;
}

interface KeywordRecord {
  keyword: string;
  tfidf_score: number;
}

interface ProjectKeyRecord {
  project_key: string;
}

interface WorkGroupRecord {
  work_group: string;
}

// Parse command line arguments (async function call will be handled in main execution)
let options: DatabaseOptions = {};

async function initializeOptions(): Promise<void> {
  options = await setupDatabaseCliArgs('fhir-jira-mcp', 'FHIR JIRA MCP Server');
}

class JiraIssuesMCPServer {
  private server: Server;
  private db: Database | null = null;

  constructor() {
    this.server = new Server({
      name: 'fhir-jira-mcp',
      version: '1.0.0',
    }, {
      capabilities: {
        tools: {},
      },
    });

    this.setupHandlers();
  }

  async init(): Promise<void> {
    try {
      const dbPath = await getDatabasePath();
      this.db = new Database(dbPath, { readonly: true });
      console.error(`Connected to database at ${dbPath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to connect to database: ${errorMessage}`);
      throw error;
    }
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
      tools: [
        {
          name: 'list_issues',
          description: 'List issues filtered by project_key, work_group, resolution, status, and/or assignee',
          inputSchema: {
            type: 'object',
            properties: {
              project_key: { type: 'string', description: 'Filter by project key' },
              work_group: { type: 'string', description: 'Filter by work group' },
              resolution: { type: 'string', description: 'Filter by resolution' },
              status: { type: 'string', description: 'Filter by status' },
              assignee: { type: 'string', description: 'Filter by assignee' },
              limit: { type: 'number', description: 'Maximum number of results (default: 50)', default: 50 },
              offset: { type: 'number', description: 'Offset for pagination (default: 0)', default: 0 }
            },
          },
        },
        {
          name: 'list_related_issues',
          description: 'List issues related to a specific issue by key',
          inputSchema: {
            type: 'object',
            properties: {
              issue_key: { type: 'string', description: 'The issue key to find related issues for' },
              limit: { type: 'number', description: 'Maximum number of results (default: 10)', default: 10 }
            },
            required: ['issue_key'],
          },
        },
        {
          name: 'find_related_issues',
          description: 'Find issues related to a specific issue by key',
          inputSchema: {
            type: 'object',
            properties: {
              issue_key: { type: 'string', description: 'The issue key to find related issues for' },
              limit: { type: 'number', description: 'Maximum number of results (default: 10)', default: 10 }
            },
            required: ['issue_key'],
          },
        },
        {
          name: 'search_issues_by_keywords',
          description: 'Search for tickets using SQLite FTS5 testing for keywords in multiple fields',
          inputSchema: {
            type: 'object',
            properties: {
              keywords: { type: 'string', description: 'Keywords to search for in issues' },
              search_fields: {
                type: 'array',
                description: 'Fields to search in (default: all)',
                items: {
                  type: 'string',
                  enum: _defaultSearchFields,
                }
              },
              limit: { type: 'number', description: 'Maximum number of results (default: 20)', default: 20 }
            },
            required: ['keywords'],
          },
        },
        {
          name: 'get_issue_details',
          description: 'Get detailed information about a specific issue by key',
          inputSchema: {
            type: 'object',
            properties: {
              issue_key: { type: 'string', description: 'The issue key (e.g., FHIR-123)' }
            },
            required: ['issue_key'],
          },
        },
        {
          name: 'get_issue_comments',
          description: 'Get comments for a specific issue',
          inputSchema: {
            type: 'object',
            properties: {
              issue_key: { type: 'string', description: 'The issue key (e.g., FHIR-123)' }
            },
            required: ['issue_key'],
          },
        },
        {
          name: 'list_project_keys',
          description: 'List all unique project keys in the database',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'list_work_groups',
          description: 'List all unique work groups in the database',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'list_issues':
          return await this.listIssues(args as ListIssuesArgs);
        case 'search_issues_by_keywords':
          return await this.searchIssuesByKeywords(args as SearchIssuesArgs);
        case 'list_related_issues':
          return await this.listRelatedIssues(args as RelatedIssuesArgs);
        case 'find_related_issues':
          return await this.findRelatedIssues(args as RelatedIssuesArgs);
        case 'get_issue_details':
          return await this.getIssueDetails(args as IssueDetailsArgs);
        case 'get_issue_comments':
          return await this.getIssueComments(args as IssueCommentsArgs);
        case 'list_project_keys':
          return await this.listProjectKeys();
        case 'list_work_groups':
          return await this.listWorkGroups();
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async listIssues(args: ListIssuesArgs): Promise<CallToolResult> {
    if (!this.db) throw new Error('Database not initialized');
    
    const { project_key, work_group, resolution, status, assignee, limit = 50, offset = 0 } = args;
    
    const searchConditions: string[] = [];
    let query = 'SELECT * FROM issues_fts';
    const params: Record<string, any> = {};
    
    if (project_key) {
      searchConditions.push('project_key = @project_key');
      params.project_key = project_key;
    }
    
    if (work_group) {
      searchConditions.push('work_group = @work_group');
      params.work_group = work_group;
    }
    
    if (resolution) {
      searchConditions.push('resolution = @resolution');
      params.resolution = resolution;
    }
    
    if (status) {
      searchConditions.push('status = @status');
      params.status = status;
    }
    
    if (assignee) {
      searchConditions.push('assignee = @assignee');
      params.assignee = assignee;
    }

    if (searchConditions.length > 0) {
      query += ' WHERE ' + searchConditions.join(' AND ');
    }
    
    // query += ' ORDER BY updated_at DESC LIMIT @limit OFFSET @offset';
    query += ' ORDER BY issue_int DESC LIMIT @limit OFFSET @offset';
    params.limit = limit;
    params.offset = offset;
    
    try {
      // console.log(`Executing query: ${query} with params:`, params);
      const stmt = this.db.prepare(query);
      const issues = stmt.all(params) as IssueRecord[];
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: issues.length,
            offset,
            issues: issues
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error browsing work queue: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  private async listRelatedIssues(args: RelatedIssuesArgs): Promise<CallToolResult> {
    if (!this.db) throw new Error('Database not initialized');
    
    const { issue_key, limit = 10 } = args;
    
    // retrieve the original issue so we can use it for context
    const sourceIssueQuery = 'SELECT * FROM issues_fts WHERE issue_key = ?';
    let sourceIssue: IssueRecord | null;
    try {
      const sourceIssueStatement = this.db.prepare(sourceIssueQuery);
      sourceIssue = sourceIssueStatement.get(issue_key) as IssueRecord | null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error finding related tickets: ${errorMessage}`
        }],
        isError: true
      };
    }

    if (!sourceIssue) {
      return {
        content: [{
          type: 'text',
          text: `Source issue not found: ${issue_key}`
        }],
        isError: true
      };
    }

    // get the explicit linked related issues
    let linkedIssues: string[] = [];

    try {
      const linkedIssuesQuery = `SELECT field_value FROM custom_fields WHERE issue_key = ? AND field_name = 'Related Issues'`;
      const linkedIssuesStatement = this.db.prepare(linkedIssuesQuery);
      const linkedIssueValue = linkedIssuesStatement.get(issue_key) as { field_value: string } | null;

      if (linkedIssueValue && linkedIssueValue.field_value) {
        linkedIssues = linkedIssueValue.field_value.split(',').map(issue => issue.trim());
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error finding related tickets: ${errorMessage}`
        }],
        isError: true
      };
    }

    // get the top keywords from the source issue
    const keywordQuery = 'SELECT keyword from tfidf_keywords where issue_key = ? ORDER BY tfidf_score DESC LIMIT 3';
    let keywords = '';
    try {
      const keywordStatement = this.db.prepare(keywordQuery);
      const keywordRows = keywordStatement.all(issue_key) as KeywordRecord[];
      if (keywordRows.length > 0) {
        keywords = keywordRows.map(row => row.keyword).join(' OR ');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error retrieving keywords for related issues: ${errorMessage}`
        }],
        isError: true
      };
    }

    // Build a regular SQL query using the issues_fts table for consistency
    let baseQuery = 'SELECT issue_key FROM issues_fts WHERE ';
    const conditions: string[] = [];
    const queryParams: any[] = [];

    // Match project_key and work_group
    conditions.push('project_key = ?');
    conditions.push('work_group = ?');
    conditions.push('issue_key != ?');
    queryParams.push(sourceIssue.project_key);
    queryParams.push(sourceIssue.work_group);
    queryParams.push(issue_key);

    // Add related_url, related_artifacts, related_pages if present
    (['related_url', 'related_artifacts', 'related_pages'] as const).forEach(field => {
      if (sourceIssue![field] && sourceIssue![field] !== '') {
        // if the string value has a comma character, split into multiple terms
        if (typeof sourceIssue![field] === 'string' && sourceIssue![field]!.includes(',')) {
          const fieldTerms: string[] = [];
          const terms = sourceIssue![field]!.split(',').map(term => term.trim());
          terms.forEach((term) => {
            let searchTerm = term;
            
            // For related_url, extract filename from URL
            if (field === 'related_url') {
              try {
                const url = new URL(term);
                let filename = url.pathname.split('/').pop();
                // Remove file extension and fragment
                if (filename) {
                  filename = filename.split('.')[0]; // Remove extension
                }
                searchTerm = filename || term; // fallback to original if no filename
              } catch (e) {
                // If URL parsing fails, use the original term
                searchTerm = term;
              }
            }
            
            fieldTerms.push(`${field} LIKE ?`);
            queryParams.push(`%${searchTerm}%`);
          });
          if (fieldTerms.length > 0) {
            conditions.push(`(${fieldTerms.join(' OR ')})`);
          }
        } else {
          let searchTerm = sourceIssue![field]!;
          
          // For related_url, extract filename from URL
          if (field === 'related_url') {
            try {
              const url = new URL(sourceIssue![field]!);
              let filename = url.pathname.split('/').pop();
              // Remove file extension and fragment
              if (filename) {
                filename = filename.split('.')[0]; // Remove extension
              }
              searchTerm = filename || sourceIssue![field]!; // fallback to original if no filename
            } catch (e) {
              // If URL parsing fails, use the original value
              searchTerm = sourceIssue![field]!;
            }
          }
          
          conditions.push(`${field} LIKE ?`);
          queryParams.push(`%${searchTerm}%`);
        }
      }
    });

    // For keyword matching, use a separate FTS5 query if we have keywords
    let keywordMatches: string[] = [];
    if (keywords && keywords.trim()) {
      try {
        const ftsQuery = 'SELECT issue_key FROM issues_fts WHERE ' + 
          _defaultSearchFields.map(field => `${field} MATCH ?`).join(' OR ') +
          ' ORDER BY rank DESC LIMIT ?';
        const ftsStmt = this.db.prepare(ftsQuery);
        const ftsParams = [..._defaultSearchFields.map(() => keywords), limit];
        const ftsResults = ftsStmt.all(...ftsParams) as { issue_key: string }[];
        keywordMatches = ftsResults.map(r => r.issue_key);
      } catch (error) {
        // If FTS5 fails, continue without keyword matching
        console.error('FTS5 keyword matching failed:', error);
      }
    }

    baseQuery += conditions.join(' AND ') + ' ORDER BY issue_int DESC LIMIT ?';
    queryParams.push(limit);
    
    let debug = 'start';
    try {
      const stmt = this.db.prepare(baseQuery);
      debug = 'after prepare';
      const relatedIssues = stmt.all(...queryParams) as { issue_key: string }[];
      debug = 'after execute';
      
      // Combine keyword matches with related field matches, removing duplicates
      const allMatches = new Set([
        ...relatedIssues.map(r => r.issue_key),
        ...keywordMatches
      ]);
      
      // Remove the source issue itself and convert back to array
      const finalMatches = Array.from(allMatches)
        .filter(key => key !== issue_key)
        .slice(0, limit);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            issue_key: issue_key,
            total_linked: linkedIssues.length,
            total_keyword_related: finalMatches.length,
            keywords: keywords || '',
            issues_linked: linkedIssues,
            issues_keyword_related: finalMatches.map(key => ({ issue_key: key })),
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error listing related issues, dbg: ${debug}: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  private async findRelatedIssues(args: RelatedIssuesArgs): Promise<CallToolResult> {
    if (!this.db) throw new Error('Database not initialized');
    
    const { issue_key, limit = 10 } = args;
    
    // retrieve the original issue so we can use it for context
    const sourceIssueQuery = 'SELECT * FROM issues_fts WHERE issue_key = ?';
    let sourceIssue: IssueRecord | null;
    try {
      const sourceIssueStatement = this.db.prepare(sourceIssueQuery);
      sourceIssue = sourceIssueStatement.get(issue_key) as IssueRecord | null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error finding related tickets: ${errorMessage}`
        }],
        isError: true
      };
    }

    if (!sourceIssue) {
      return {
        content: [{
          type: 'text',
          text: `Source issue not found: ${issue_key}`
        }],
        isError: true
      };
    }

    // get the explicit linked related issues
    let linkedIssues: IssueRecord[] = [];

    try {
      const linkedIssuesQuery = `SELECT field_value FROM custom_fields WHERE issue_key = ? AND field_name = 'Related Issues'`;
      const linkedIssuesStatement = this.db.prepare(linkedIssuesQuery);
      const linkedIssueValue = linkedIssuesStatement.get(issue_key) as { field_value: string } | null;

      if (linkedIssueValue && linkedIssueValue.field_value) {
        const relatedIssueKeys = linkedIssueValue.field_value.split(',').map(issue => issue.trim());
        linkedIssues = relatedIssueKeys.map(key => {
          const issueStmt = this.db!.prepare('SELECT * FROM issues_fts WHERE issue_key = ?');
          return issueStmt.get(key) as IssueRecord | null;
        }).filter((issue): issue is IssueRecord => issue !== null); // filter out any null results
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error finding related tickets: ${errorMessage}`
        }],
        isError: true
      };
    }

    // get the top keywords from the source issue
    const keywordQuery = 'SELECT keyword from tfidf_keywords where issue_key = ? ORDER BY tfidf_score DESC LIMIT 3';
    let keywords = '';
    try {
      const keywordStatement = this.db.prepare(keywordQuery);
      const keywordRows = keywordStatement.all(issue_key) as KeywordRecord[];
      if (keywordRows.length > 0) {
        keywords = keywordRows.map(row => row.keyword).join(' OR ');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error retrieving keywords for related issues: ${errorMessage}`
        }],
        isError: true
      };
    }

    const params: Record<string, any> = { limit };

    // Use FTS5 for efficient searching
    let ftsQuery = 'SELECT * FROM issues_fts WHERE ';

    // Match project_key and work_group
    ftsQuery += 'project_key = @project_key AND work_group = @work_group AND issue_key != @issue_key';
    params.project_key = sourceIssue.project_key;
    params.work_group = sourceIssue.work_group;
    params.issue_key = issue_key;

    // Add related_url, related_artifacts, related_pages if present
    (['related_url', 'related_artifacts', 'related_pages'] as const).forEach(field => {
      if (sourceIssue![field] && sourceIssue![field] !== '') {
        // if the string value has a comma character, split into multiple terms
        if (typeof sourceIssue![field] === 'string' && sourceIssue![field]!.includes(',')) {
          const fieldTerms: string[] = [];
          const terms = sourceIssue![field]!.split(',').map(term => term.trim());
          terms.forEach((term, index) => {
            let searchTerm = term;
            
            // For related_url, extract filename from URL
            if (field === 'related_url') {
              try {
                const url = new URL(term);
                let filename = url.pathname.split('/').pop();
                // Remove file extension and fragment
                if (filename) {
                  filename = filename.split('.')[0]; // Remove extension
                }
                searchTerm = filename || term; // fallback to original if no filename
              } catch (e) {
                // If URL parsing fails, use the original term
                searchTerm = term;
              }
            }
            
            params[`${field}_${index}`] = `%${searchTerm}%`;
            fieldTerms.push(`${field} like @${field}_${index}`);
          });
          ftsQuery += ` AND (${fieldTerms.join(' OR ')})`;
        } else {
          let searchTerm = sourceIssue![field]!;
          
          // For related_url, extract filename from URL
          if (field === 'related_url') {
            try {
              const url = new URL(sourceIssue![field]!);
              let filename = url.pathname.split('/').pop();
              // Remove file extension and fragment
              if (filename) {
                filename = filename.split('.')[0]; // Remove extension
              }
              searchTerm = filename || sourceIssue![field]!; // fallback to original if no filename
            } catch (e) {
              // If URL parsing fails, use the original value
              searchTerm = sourceIssue![field]!;
            }
          }
          
          params[field] = `%${searchTerm}%`;
          ftsQuery += ` AND ${field} like @${field}`;
        }
      }
    });

    // Only add keyword matching if we have keywords
    if (keywords && keywords.trim()) {
      params.keywords = keywords;
      const matchConditions: string[] = [];
      _defaultSearchFields.forEach(field => {
        matchConditions.push(`${field} MATCH @keywords`);
      });
      
      ftsQuery += ` AND (${matchConditions.join(' OR ')})`;
      ftsQuery += ' ORDER BY rank DESC';
    } else {
      // If no keywords, just order by issue number
      ftsQuery += ' ORDER BY issue_int DESC';
    }
    ftsQuery += ' LIMIT @limit';
    
    try {
      const stmt = this.db.prepare(ftsQuery);
      const issues = stmt.all(params) as IssueRecord[];
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            issue_key: issue_key,
            total_linked: linkedIssues.length,
            total_keyword_related: issues.length,
            keywords: keywords || '',
            issues_linked: linkedIssues,
            issues_keyword_related: issues,
            // ftsQuery: ftsQuery,
            // params: params
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error finding related issues: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  private async searchIssuesByKeywords(args: SearchIssuesArgs): Promise<CallToolResult> {
    if (!this.db) throw new Error('Database not initialized');
    
    const { keywords, search_fields, limit = 50 } = args;
    
    // Use FTS5 for efficient searching
    let ftsQuery = 'SELECT * FROM issues_fts WHERE ';
    const searchConditions: string[] = [];
    
    const fieldsToSearch = search_fields && search_fields.length > 0 
      ? search_fields 
      : _defaultSearchFields;
    
    // Build the FTS query
    fieldsToSearch.forEach(field => {
      searchConditions.push(`${field} MATCH @keywords`);
    });
    
    ftsQuery += searchConditions.join(' OR ');
    ftsQuery += ' ORDER BY rank DESC';
    ftsQuery += ' LIMIT @limit';
    
    try {
      // console.log(`Executing query: ${ftsQuery} with params:`, { query, limit });
      const stmt = this.db.prepare(ftsQuery);
      const issues = stmt.all({ keywords, limit }) as IssueRecord[];
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: issues.length,
            keywords: keywords,
            search_fields: fieldsToSearch,
            issues: issues
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error searching for issues: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  private async getIssueDetails(args: IssueDetailsArgs): Promise<CallToolResult> {
    if (!this.db) throw new Error('Database not initialized');
    
    const { issue_key } = args;
    
    try {
      const issueStmt = this.db.prepare('SELECT * FROM issues WHERE key = ?');
      const issue = issueStmt.get(issue_key) as IssueRecord | null;
      
      if (!issue) {
        return {
          content: [{
            type: 'text',
            text: `Issue ${issue_key} not found`
          }],
          isError: true
        };
      }
      
      // Get custom fields
      const customFieldsStmt = this.db.prepare(
        'SELECT field_name, field_value FROM custom_fields WHERE issue_key = ?'
      );
      const customFields = customFieldsStmt.all(issue_key) as CustomFieldRecord[];
      
      const customFieldsMap: Record<string, string> = {};
      customFields.forEach(field => {
        customFieldsMap[field.field_name] = field.field_value;
      });
      
      // Get comment count
      const commentCountStmt = this.db.prepare(
        'SELECT COUNT(*) as count FROM comments WHERE issue_key = ?'
      );
      const commentCount = (commentCountStmt.get(issue_key) as { count: number }).count;
      
      const result = {
        ...issue,
        custom_fields: customFieldsMap,
        comment_count: commentCount
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error getting issue details: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  private async getIssueComments(args: IssueCommentsArgs): Promise<CallToolResult> {
    if (!this.db) throw new Error('Database not initialized');
    
    const { issue_key } = args;
    
    try {
      const stmt = this.db.prepare(
        'SELECT * FROM comments WHERE issue_key = ? ORDER BY created_at DESC'
      );
      const comments = stmt.all(issue_key) as CommentRecord[];
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            issue_key,
            total: comments.length,
            comments
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error getting comments: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  private async listProjectKeys(): Promise<CallToolResult> {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const stmt = this.db.prepare('SELECT DISTINCT project_key FROM issues ORDER BY project_key');
      const projects = stmt.all() as ProjectKeyRecord[];
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: projects.length,
            project_keys: projects.map(p => p.project_key)
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error listing project keys: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  private async listWorkGroups(): Promise<CallToolResult> {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const stmt = this.db.prepare(
        `SELECT DISTINCT(work_group) as work_group FROM issues_fts`
      );
      const workGroups = stmt.all() as WorkGroupRecord[];
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: workGroups.length,
            work_groups: workGroups.map(w => w.work_group)
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error listing work groups: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  async run(): Promise<void> {
    await this.init();
    
    // Start stdio transport
    const stdioTransport = new StdioServerTransport();
    await this.server.connect(stdioTransport);
    console.error('FHIR JIRA MCP Server running on stdio');
  }
}

// Export for testing
export { JiraIssuesMCPServer };

async function main(): Promise<void> {
  await initializeOptions();
  const server = new JiraIssuesMCPServer();
  await server.run();
}

// Only run main if this file is executed directly (not imported)
if (import.meta.main) {
  main().catch(console.error);
}