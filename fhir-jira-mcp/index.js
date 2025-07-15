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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _defaultSearchFields = [
  'title', 
  'description', 
  'summary', 
  'resolution', 
  'resolution_description', 
  'related_url', 
  'related_artifacts', 
  'related_pages'
];


// Parse command line arguments
program
  .name('fhir-jira-mcp')
  .description('FHIR JIRA MCP Server')
  .option('-p, --port <port>', 'HTTP server port (optional)', parseInt)
  .parse();

const options = program.opts();

// Database path - assumes the database is in the parent directory
const DB_PATHS = [
  path.join(process.cwd(), 'jira_issues.sqlite'),
  path.join(process.cwd(), '..', 'jira_issues.sqlite'),
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
      try {
        if (fs.existsSync(dbPath)) {
          return dbPath;
        }
      } catch (error) { }
    }
    throw new Error('jira_issues.sqlite not found in expected locations.');
  }


  async init() {
    try {
      const dbPath = this.findDatabasePath();
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
          description: 'Search for tickets using SQLite FTS5 testing against issue fields',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query string', required: true },
              search_fields: {
                type: 'array',
                description: 'Fields to search in (default: all)',
                items: {
                  type: 'string',
                  enum: _defaultSearchFields,
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
              issue_key: { type: 'string', description: 'The issue key (e.g., FHIR-123)', required: true }
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
              issue_key: { type: 'string', description: 'The issue key (e.g., FHIR-123)', required: true }
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
    
    let query = 'SELECT * FROM issues_fts WHERE 1=1';
    const params = {};
    
    if (project_key) {
      query += ' AND project_key = @project_key';
      params.project_key = project_key;
    }
    
    if (work_group) {
      query += ` AND work_group = @work_group`;
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

  async searchIssues(args) {
    const { query, search_fields, limit = 50 } = args;
    
    // Use FTS5 for efficient searching
    let ftsQuery = 'SELECT * FROM issues_fts WHERE ';
    const searchConditions = [];
    
    const fieldsToSearch = search_fields && search_fields.length > 0 
      ? search_fields 
      : _defaultSearchFields;
    
    // Build the FTS query
    if (fieldsToSearch.length === 1) {
      searchConditions.push(`${fieldsToSearch[0]} MATCH @query`);
    } else {
      searchConditions.push(`issues_fts MATCH @query`);
    }
    
    ftsQuery += searchConditions.join(' OR ');
    ftsQuery += ' ORDER BY rank DESC';
    ftsQuery += ' LIMIT @limit';
    
    try {
      // console.log(`Executing query: ${ftsQuery} with params:`, { query, limit });
      const stmt = this.db.prepare(ftsQuery);
      const issues = stmt.all({ query, limit });
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: issues.length,
            query,
            search_fields: fieldsToSearch,
            issues: issues
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