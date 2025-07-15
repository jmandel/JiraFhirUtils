# FHIR JIRA MCP Server

A Model Context Protocol (MCP) server for read-only access to the JIRA issues SQLite database. This server provides tools to browse work queues and search for related tickets.

## Features

- **Browse Work Queue**: Filter issues by project key, work group, resolution, status, and/or assignee
- **Search Related Tickets**: Full-text search across issues matching related URLs, artifacts, pages, titles, and summaries
- **Get Issue Details**: Retrieve detailed information about specific issues including custom fields
- **Get Issue Comments**: Retrieve all comments for a specific issue
- **List Project Keys**: Get all unique project keys in the database
- **List Work Groups**: Get all unique work groups in the database

## Installation

1. Navigate to the `fhir-jira-mcp` directory:
   ```bash
   cd fhir-jira-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   bun install
   ```

## Usage

### Running the Server

Start the MCP server:
```bash
npm start
# or
bun run index.js
```

### Configuring with Claude Desktop

Add the following to your Claude Desktop configuration file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "fhir-jira": {
      "command": "node",
      "args": ["/path/to/fhir-jira-mcp/index.js"],
      "env": {}
    }
  }
}
```

Or if using Bun:
```json
{
  "mcpServers": {
    "fhir-jira": {
      "command": "bun",
      "args": ["run", "/path/to/fhir-jira-mcp/index.js"],
      "env": {}
    }
  }
}
```

## Available Tools

### 1. list_issues
List issues with filtering options.

**Parameters:**
- `project_key` (optional): Filter by project key
- `work_group` (optional): Filter by work group
- `resolution` (optional): Filter by resolution
- `status` (optional): Filter by status
- `assignee` (optional): Filter by assignee
- `limit` (optional): Maximum number of results (default: 50)
- `offset` (optional): Offset for pagination (default: 0)

**Example:**
```json
{
  "tool": "list_issues",
  "arguments": {
    "project_key": "FHIR",
    "status": "In Progress",
    "limit": 20
  }
}
```

### 2. search_issues
Search for tickets using full-text search.

**Parameters:**
- `query` (required): Search query string
- `search_fields` (optional): Array of fields to search in. Options: `related_url`, `related_artifacts`, `related_pages`, `title`, `summary`. Defaults to all fields.
- `limit` (optional): Maximum number of results (default: 50)

**Example:**
```json
{
  "tool": "search_issues",
  "arguments": {
    "query": "patient resource",
    "search_fields": ["title", "summary"],
    "limit": 10
  }
}
```

### 3. get_issue_details
Get detailed information about a specific issue.

**Parameters:**
- `issue_key` (required): The issue key (e.g., "FHIR-123")

**Example:**
```json
{
  "tool": "get_issue_details",
  "arguments": {
    "issue_key": "FHIR-123"
  }
}
```

### 4. get_issue_comments
Get all comments for a specific issue.

**Parameters:**
- `issue_key` (required): The issue key (e.g., "FHIR-123")

**Example:**
```json
{
  "tool": "get_issue_comments",
  "arguments": {
    "issue_key": "FHIR-123"
  }
}
```

### 5. list_project_keys
List all unique project keys in the database.

**Parameters:** None

**Example:**
```json
{
  "tool": "list_project_keys",
  "arguments": {}
}
```

### 6. list_work_groups
List all unique work groups in the database.

**Parameters:** None

**Example:**
```json
{
  "tool": "list_work_groups",
  "arguments": {}
}
```

## Database Schema

The server expects a SQLite database (`jira_issues.sqlite`) in the parent directory with the following main tables:

- `issues`: Main issue data including key, title, summary, status, resolution, assignee, etc.
- `comments`: Comments associated with issues
- `custom_fields`: Custom field values for issues (including work_group, related_url, etc.)
- `issues_fts`: Full-text search index for efficient searching

## Notes

- The server operates in read-only mode for database safety
- Full-text search uses SQLite's FTS5 extension for efficient querying
- All responses are returned as JSON-formatted text
- The database path is hardcoded to `../jira_issues.sqlite` relative to the server location

## Troubleshooting

If you encounter connection issues:
1. Ensure the `jira_issues.sqlite` file exists in the parent directory
2. Check that the database file has read permissions
3. Verify that all dependencies are installed correctly
4. Check the console output for error messages

## License

This MCP server is part of the JiraFhirUtils project.