# FHIR JIRA MCP Server

A Model Context Protocol (MCP) server for read-only access to the JIRA issues SQLite database. This server provides tools to browse work queues and search for related tickets.

The server uses STDIO transport for integration with MCP clients like Claude Desktop.

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
   ```

## Usage

### Running the Server

Start the MCP server for use with Claude Desktop or other STDIO-based MCP clients:
```bash
bun start
```

For development with auto-reload:
```bash
bun run dev
```

### HTTP Wrapper

The package includes an MCP HTTP wrapper that implements the [Streamable HTTP transport](mcp-transports.md) for STDIO-based MCP servers.

#### Usage

```bash
# Start with default settings (port 3000, default MCP server)
bun mcp-http.ts

# Specify custom port and MCP command
bun mcp-http.ts --port 8080 --mcp-command "node my-mcp-server.js"
```

#### Options

- `--port, -p <number>`: HTTP listen port (default: 3000)
- `--mcp-command, -c <string>`: MCP server command to execute (default: `bun index.ts`)

#### Features

- ✅ **Full Streamable HTTP Transport**: Implements the complete MCP Streamable HTTP specification
- ✅ **Session Management**: Handles client sessions with unique session IDs
- ✅ **Bidirectional Communication**: Supports both client-to-server and server-to-client messages
- ✅ **SSE Streaming**: Server-Sent Events for real-time communication
- ✅ **Auto-restart**: Automatically restarts the MCP subprocess if it crashes
- ✅ **Graceful Shutdown**: Proper cleanup of resources and sessions
- ✅ **Error Handling**: Robust error handling and recovery

#### Endpoints

- `POST /mcp`: Send JSON-RPC messages to the MCP server
- `GET /mcp`: Open SSE stream for server-initiated messages  
- `DELETE /mcp`: Terminate a client session
- `OPTIONS /mcp`: CORS preflight support

#### Testing HTTP Wrapper

A test script is included to verify functionality:

```bash
# Start the wrapper
bun mcp-http.ts --port 3001 &

# Run tests
bun test-http.ts

# Stop the wrapper
pkill -f mcp-http.ts
```

#### Protocol Compliance

This wrapper implements the MCP Streamable HTTP transport specification including:

- Session ID management via `Mcp-Session-Id` headers
- Support for both JSON and SSE response modes
- Proper handling of requests, responses, and notifications
- Message correlation and routing
- Connection resumability via `Last-Event-ID` headers
- CORS support for web clients

#### Architecture

The wrapper consists of several key components:

- **MCPSubprocess**: Manages the lifecycle of the STDIO MCP server process
- **SessionManager**: Tracks client sessions and correlates requests/responses
- **MCPHttpWrapper**: Main HTTP server that bridges HTTP clients to the STDIO server

The wrapper maintains one long-running subprocess and multiplexes HTTP client connections to it, handling the protocol conversion between HTTP and STDIO transparently.

### Configuring with Claude Desktop

Add the following to your Claude Desktop configuration file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "fhir-jira": {
      "command": "bun",
      "args": ["/path/to/fhir-jira-mcp/index.ts"],
      "env": {}
    }
  }
}
```


## Available MCP Tools

The FHIR JIRA MCP server provides the following tools for interacting with the JIRA issues database:

### 1. `list_issues`
**Description:** List issues filtered by project_key, work_group, resolution, status, and/or assignee

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

### 2. `search_issues_by_keywords`
**Description:** Search for tickets using SQLite FTS5 testing for keywords in multiple fields

**Parameters:**
- `keywords` (required): Keywords to search for in issues
- `search_fields` (optional): Array of fields to search in. Options: `title`, `description`, `summary`, `resolution_description`. Defaults to all fields.
- `limit` (optional): Maximum number of results (default: 20)

**Example:**
```json
{
  "tool": "search_issues_by_keywords",
  "arguments": {
    "keywords": "patient resource",
    "search_fields": ["title", "summary"],
    "limit": 10
  }
}
```

### 3. `list_related_issues`
**Description:** List issues related to a specific issue by key

**Parameters:**
- `issue_key` (required): The issue key to find related issues for
- `limit` (optional): Maximum number of results (default: 10)

**Example:**
```json
{
  "tool": "list_related_issues",
  "arguments": {
    "issue_key": "FHIR-123",
    "limit": 10
  }
}
```

### 4. `find_related_issues`
**Description:** Find issues related to a specific issue by key

**Parameters:**
- `issue_key` (required): The issue key to find related issues for
- `limit` (optional): Maximum number of results (default: 10)

**Example:**
```json
{
  "tool": "find_related_issues",
  "arguments": {
    "issue_key": "FHIR-123",
    "limit": 10
  }
}
```

### 5. `get_issue_details`
**Description:** Get detailed information about a specific issue by key

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

### 6. `get_issue_comments`
**Description:** Get comments for a specific issue

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

### 7. `list_project_keys`
**Description:** List all unique project keys in the database

**Parameters:** None

**Example:**
```json
{
  "tool": "list_project_keys",
  "arguments": {}
}
```

### 8. `list_work_groups`
**Description:** List all unique work groups in the database

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

## Testing

### Running Tests

The project includes database connectivity tests:

```bash
# Run database connectivity test
bun run test:db
```

### Test Coverage

The tests cover:
- ✅ **Database connectivity**: Verifies connection to SQLite database
- ✅ **Basic queries**: Tests issue counts, project keys, and work groups
- ✅ **FTS5 functionality**: Validates full-text search index

### Manual Testing

For manual testing of the MCP protocol, use the MCP Inspector:
```sh
npx @modelcontextprotocol/inspector
```

Or test directly with Claude Desktop by adding the server to your configuration.

## Notes

- The server operates in read-only mode for database safety
- Uses STDIO transport for communication with MCP clients
- Full-text search uses SQLite's FTS5 extension for efficient querying
- All responses are returned as JSON-formatted text
- The database path can be specified with `--db-path` or auto-discovered from standard locations

## Troubleshooting

If you encounter connection issues:
1. Ensure the `jira_issues.sqlite` file exists in the parent directory
2. Check that the database file has read permissions
3. Verify that all dependencies are installed correctly
4. Check the console output for error messages

## License

This MCP server is part of the JiraFhirUtils project.