#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path - assumes the database is in the parent directory
const DB_PATHS = [
  path.join(process.cwd(), 'jira_issues.sqlite'),
  path.join(__dirname, 'jira_issues.sqlite'),
  path.join(__dirname, '..', 'jira_issues.sqlite'),
];

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

  
  findDatabasePath() {
    for (const dbPath of DB_PATHS) {
      if (fs.existsSync(dbPath)) {
        return dbPath;
      }
    }
    throw new Error('jira_issues.sqlite not found in expected locations.');
  }


  async init() {
    try {
      const dbPath = findDatabasePath();
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
          name: 'search_issues',
          description: 'Search for tickets matching against related_url, related_artifacts, related_pages, title, and/or summary',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query string', required: true },
              search_fields: {
                type: 'array',
                description: 'Fields to search in (default: all)',
                items: {
                  type: 'string',
                  enum: ['related_url', 'related_artifacts', 'related_pages', 'title', 'summary']
                }
              },
              limit: { type: 'number', description: 'Maximum number of results (default: 50)', default: 50 }
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
              issue_key: { type: 'string', description: 'The issue key (e.g., PROJ-123)', required: true }
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
              issue_key: { type: 'string', description: 'The issue key (e.g., PROJ-123)', required: true }
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
        case 'search_issues':
          return await this.searchIssues(args);
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
    
    let query = 'SELECT * FROM issues WHERE 1=1';
    const params = {};
    
    if (project_key) {
      query += ' AND project_key = @project_key';
      params.project_key = project_key;
    }
    
    if (work_group) {
      query += ' AND key IN (SELECT issue_key FROM custom_fields WHERE field_name = "Work Group" AND field_value = @work_group)';
      params.work_group = work_group;
    }
    
    if (resolution) {
      query += ' AND resolution = @resolution';
      params.resolution = resolution;
    }
    
    if (status) {
      query += ' AND status = @status';
      params.status = status;
    }
    
    if (assignee) {
      query += ' AND assignee = @assignee';
      params.assignee = assignee;
    }
    
    // query += ' ORDER BY updated_at DESC LIMIT @limit OFFSET @offset';
    query += ' ORDER BY issue_key DESC LIMIT @limit OFFSET @offset';
    params.limit = limit;
    params.offset = offset;
    
    try {
      const stmt = this.db.prepare(query);
      const issues = stmt.all(params);
      
      // Get work groups for each issue
      const issuesWithWorkGroups = issues.map(issue => {
        const workGroupStmt = this.db.prepare(
          'SELECT field_value FROM custom_fields WHERE issue_key = ? AND field_name = "Work Group"'
        );
        const workGroupResult = workGroupStmt.get(issue.key);
        return {
          ...issue,
          work_group: workGroupResult?.field_value || null
        };
      });
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: issuesWithWorkGroups.length,
            offset,
            issues: issuesWithWorkGroups
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

  async searchIssues(args) {
    const { query, search_fields, limit = 50 } = args;
    
    // Use FTS5 for efficient searching
    let ftsQuery = 'SELECT DISTINCT i.* FROM issues i JOIN issues_fts fts ON i.key = fts.issue_key WHERE ';
    const searchConditions = [];
    
    const fieldsToSearch = search_fields && search_fields.length > 0 
      ? search_fields 
      : ['related_url', 'related_artifacts', 'related_pages', 'title', 'summary'];
    
    // Build the FTS query
    if (fieldsToSearch.length === 1) {
      searchConditions.push(`fts.${fieldsToSearch[0]} MATCH @query`);
    } else {
      searchConditions.push(`fts MATCH @query`);
    }
    
    ftsQuery += searchConditions.join(' OR ');
    ftsQuery += ' ORDER BY fts.rank DESC';
    ftsQuery += ' LIMIT @limit';
    
    try {
      const stmt = this.db.prepare(ftsQuery);
      const issues = stmt.all({ query, limit });
      
      // Get custom fields including work group
      const issuesWithDetails = issues.map(issue => {
        const customFieldsStmt = this.db.prepare(
          'SELECT field_name, field_value FROM custom_fields WHERE issue_key = ?'
        );
        const customFields = customFieldsStmt.all(issue.key);
        
        const customFieldsMap = {};
        customFields.forEach(field => {
          customFieldsMap[field.field_name] = field.field_value;
        });
        
        return {
          ...issue,
          work_group: customFieldsMap['Work Group'] || null,
          related_url: customFieldsMap['Related URL'] || null,
          related_artifacts: customFieldsMap['Related Artifacts'] || null,
          related_pages: customFieldsMap['Related Pages'] || null,
        };
      });
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: issuesWithDetails.length,
            query,
            search_fields: fieldsToSearch,
            issues: issuesWithDetails
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error searching related tickets: ${error.message}`
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
        'SELECT DISTINCT field_value as work_group FROM custom_fields WHERE field_name = "Work Group" AND field_value IS NOT NULL ORDER BY field_value'
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
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('FHIR JIRA MCP Server running on stdio');
  }
}

const server = new JiraIssuesMCPServer();
server.run().catch(console.error);