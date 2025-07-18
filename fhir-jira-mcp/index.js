#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { program } from 'commander';
import { getDatabasePath, setupDatabaseCliArgs } from '../extract-xml/database-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _defaultSearchFields = [
  'title', 
  'description', 
  'summary', 
  'resolution_description'
];


// Parse command line arguments
const options = setupDatabaseCliArgs('fhir-jira-mcp', 'FHIR JIRA MCP Server', {
  '-p, --port <port>': {
    description: 'HTTP server port (optional)',
    defaultValue: undefined
  }
});

// Convert port to number if provided
if (options.port) {
  options.port = parseInt(options.port);
}

class JiraIssuesMCPServer {
  constructor() {
    this.server = new Server({
      name: 'fhir-jira-mcp',
      version: '1.0.0',
    }, {
      capabilities: {
        tools: {},
      },
    });

    this.db = null;
    this.setupHandlers();
  }

  async init() {
    try {
      const dbPath = getDatabasePath();
      this.db = new Database(dbPath, { readonly: true });
      console.error(`Connected to database at ${dbPath}`);
    } catch (error) {
      console.error(`Failed to connect to database: ${error.message}`);
      throw error;
    }
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
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
            required: ['query'],
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

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'list_issues':
          return await this.listIssues(args);
        case 'search_issues_by_keywords':
          return await this.searchIssuesByKeywords(args);
        case 'find_related_issues':
          return await this.findRelatedIssues(args);
        case 'get_issue_details':
          return await this.getIssueDetails(args);
        case 'get_issue_comments':
          return await this.getIssueComments(args);
        case 'list_project_keys':
          return await this.listProjectKeys();
        case 'list_work_groups':
          return await this.listWorkGroups();
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  async listIssues(args) {
    const { project_key, work_group, resolution, status, assignee, limit = 50, offset = 0 } = args;
    
    const searchConditions = [];
    let query = 'SELECT * FROM issues_fts';
    const params = {};
    
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
      const issues = stmt.all(params);
      
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
      return {
        content: [{
          type: 'text',
          text: `Error browsing work queue: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async findRelatedIssues(args) {
    const { issue_key, limit = 10 } = args;
    
    // retrieve the original issue so we can use it for context
    const sourceIssueQuery = 'SELECT * FROM issues_fts WHERE issue_key = ?';
    let sourceIssue;
    try {
      const sourceIssueStatement = this.db.prepare(sourceIssueQuery);
      sourceIssue = sourceIssueStatement.get(issue_key);
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error finding related tickets: ${error.message}`
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
    let linkedIssues = [];

    try {
      const linkedIssuesQuery = `SELECT field_value FROM custom_fields WHERE issue_key = ? AND field_name = 'Related Issues'`;
      const linkedIssuesStatement = this.db.prepare(linkedIssuesQuery);
      const linkedIssueValue = linkedIssuesStatement.get(issue_key);

      if (linkedIssueValue && linkedIssueValue.field_value) {
        const relatedIssueKeys = linkedIssueValue.field_value.split(',').map(issue => issue.trim());
        linkedIssues = relatedIssueKeys.map(key => {
          const issueStmt = this.db.prepare('SELECT * FROM issues_fts WHERE issue_key = ?');
          return issueStmt.get(key);
        }).filter(issue => issue); // filter out any null results
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error finding related tickets: ${error.message}`
        }],
        isError: true
      };
    }

    // get the top keywords from the source issue
    const keywordQuery = 'SELECT keyword from tfidf_keywords where issue_key = ? ORDER BY tfidf_score DESC LIMIT 3';
    let keywords = '';
    try {
      const keywordStatement = this.db.prepare(keywordQuery);
      const keywordRows = keywordStatement.all(issue_key);
      if (keywordRows.length > 0) {
        keywords = keywordRows.map(row => row.keyword).join(' OR ');
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error retrieving keywords for related issues: ${error.message}`
        }],
        isError: true
      };
    }

    const params = { limit, keywords: keywords };

    // Use FTS5 for efficient searching
    let ftsQuery = 'SELECT * FROM issues_fts WHERE ';

    // Match project_key and work_group
    ftsQuery += 'project_key = @project_key AND work_group = @work_group AND issue_key != @issue_key';
    params.project_key = sourceIssue.project_key;
    params.work_group = sourceIssue.work_group;
    params.issue_key = issue_key;

    // Add related_url, related_artifacts, related_pages if present
    ['related_url', 'related_artifacts', 'related_pages'].forEach(field => {
      if ((sourceIssue[field]) && (sourceIssue[field] !== '')) {
        // if the string value has a comma character, split into multiple terms
        if (typeof sourceIssue[field] === 'string' && sourceIssue[field].includes(',')) {
          const fieldTerms = [];
          const terms = sourceIssue[field].split(',').map(term => term.trim());
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
          let searchTerm = sourceIssue[field];
          
          // For related_url, extract filename from URL
          if (field === 'related_url') {
            try {
              const url = new URL(sourceIssue[field]);
              let filename = url.pathname.split('/').pop();
              // Remove file extension and fragment
              if (filename) {
                filename = filename.split('.')[0]; // Remove extension
              }
              searchTerm = filename || sourceIssue[field]; // fallback to original if no filename
            } catch (e) {
              // If URL parsing fails, use the original value
              searchTerm = sourceIssue[field];
            }
          }
          
          params[field] = `%${searchTerm}%`;
          ftsQuery += ` AND ${field} like @${field}`;
        }
      }
    });

    const matchConditions = [];
    _defaultSearchFields.forEach(field => {
      matchConditions.push(`${field} MATCH @keywords`);
    });
    
    ftsQuery += ` AND (${matchConditions.join(' OR ')})`;
    ftsQuery += ' ORDER BY rank DESC';
    ftsQuery += ' LIMIT @limit';
    
    try {
      const stmt = this.db.prepare(ftsQuery);
      const issues = stmt.all(params);
      
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
      return {
        content: [{
          type: 'text',
          text: `Error finding related issues: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async searchIssuesByKeywords(args) {
    const { keywords, search_fields, limit = 50 } = args;
    
    // Use FTS5 for efficient searching
    let ftsQuery = 'SELECT * FROM issues_fts WHERE ';
    const searchConditions = [];
    
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
      const issues = stmt.all({ keywords, limit });
      
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
      return {
        content: [{
          type: 'text',
          text: `Error searching for issues: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async getIssueDetails(args) {
    const { issue_key } = args;
    
    try {
      const issueStmt = this.db.prepare('SELECT * FROM issues WHERE key = ?');
      const issue = issueStmt.get(issue_key);
      
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
      const customFields = customFieldsStmt.all(issue_key);
      
      const customFieldsMap = {};
      customFields.forEach(field => {
        customFieldsMap[field.field_name] = field.field_value;
      });
      
      // Get comment count
      const commentCountStmt = this.db.prepare(
        'SELECT COUNT(*) as count FROM comments WHERE issue_key = ?'
      );
      const commentCount = commentCountStmt.get(issue_key).count;
      
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
      return {
        content: [{
          type: 'text',
          text: `Error getting issue details: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async getIssueComments(args) {
    const { issue_key } = args;
    
    try {
      const stmt = this.db.prepare(
        'SELECT * FROM comments WHERE issue_key = ? ORDER BY created_at DESC'
      );
      const comments = stmt.all(issue_key);
      
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
      return {
        content: [{
          type: 'text',
          text: `Error getting comments: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async listProjectKeys() {
    try {
      const stmt = this.db.prepare('SELECT DISTINCT project_key FROM issues ORDER BY project_key');
      const projects = stmt.all();
      
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
      return {
        content: [{
          type: 'text',
          text: `Error listing project keys: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async listWorkGroups() {
    try {
      const stmt = this.db.prepare(
        `SELECT DISTINCT(work_group) as work_group FROM issues_fts`
      );
      const workGroups = stmt.all();
      
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
      return {
        content: [{
          type: 'text',
          text: `Error listing work groups: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async run() {
    await this.init();
    
    // Always start stdio transport
    const stdioTransport = new StdioServerTransport();
    await this.server.connect(stdioTransport);
    console.error('FHIR JIRA MCP Server running on stdio');
    
    // Start HTTP server if port is specified
    if (options.port) {
      const app = express();
      
      // Configure CORS to be as permissive as possible
      app.use(cors({
        origin: '*',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: '*',
        exposedHeaders: ['Mcp-Session-Id'],
      }));
      
      app.use(express.json({ limit: '50mb' }));
      
      // Create HTTP transport in stateless mode
      const httpTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode - no session management
      });
      
      // Connect the HTTP transport to the server
      await this.server.connect(httpTransport);
      
      // Handle MCP requests at /mcp endpoint
      app.post('/mcp', async (req, res) => {
        try {
          await httpTransport.handleRequest(req, res, req.body);
        } catch (error) {
          console.error('Error handling MCP request:', error);
          res.status(500).json({ error: 'Internal server error' });
        }
      });
      
      // Health check endpoint
      app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'fhir-jira-mcp' });
      });
      
      // Start HTTP server
      app.listen(options.port, () => {
        console.error(`HTTP server listening on port ${options.port}`);
        console.error(`MCP endpoint: http://localhost:${options.port}/mcp`);
      });
    }
  }
}

const server = new JiraIssuesMCPServer();
server.run().catch(console.error);