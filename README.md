
# HL7 / FHIR Jira Utilities

This repo contains some tools and utilities to ease Jira ticket processing for FHIR.

## Project Structure

This project uses a monorepo structure with workspaces:

- `packages/fhir-jira-db/` - Database utilities and processing scripts
- `packages/fhir-jira-mcp/` - Model Context Protocol server
- `packages/database-utils/` - Shared database utilities
- `packages/jira-fhir-utils/` - Main utilities package

## Database Processing (`packages/fhir-jira-db`)

This package contains utilities to create a SQLite database based on Jira tickets and compressed files with FHIR Core ticket XML exports:
* `extract-archives.ts` extracts the included tar.gz archives into their respective directories for processing
* `load-initial.ts` loads the contents of the `bulk` directory, creates a database, and assumes no duplicates/conflicts
* `load-updates.ts` loads the contents of the `updates` directory into the database, updating existing records if they exist or adding new records if they do not
* `create-fts.ts` creates SQLite FTS5 full-text search tables for `issues` and `comments` from the database
* `create-tfidf.ts` extracts TF-IDF data from Jira issues
* `download-issues.ts` downloads issues directly from Jira using the REST API
* `bulk.tar.gz` contains FHIR Core tickets FHIR-2839 through FHIR-51487, as of 2025.07.15
* `updates.tar.gz` contains FHIR Core tickets that have changes on 2025.07.15

- **extract-archives.ts**
  Use this script to extract the tar.gz archives before processing. It will extract `bulk.tar.gz` to the `bulk` directory and `updates.tar.gz` to the `updates` directory. Any existing directories will be replaced.
  **Run with:**
  ```sh
  bun run extract-archives
  # or
  bun packages/fhir-jira-db/extract-archives.ts
  ```

- **load-initial.ts**
  Use this script to create a new database from scratch using the XML files in the `bulk` directory. It assumes there are no duplicate or conflicting issues.
  **Run with:**
  ```sh
  bun run load-initial
  # or
  bun packages/fhir-jira-db/load-initial.ts
  ```

- **load-updates.ts**
  Use this script to apply updates to an existing database using XML files in the `updates` directory. It will insert new issues, update existing ones, and add new comments or custom fields as needed, without affecting unrelated records.
  **Run with:**
  ```sh
  bun run load-updates
  # or
  bun packages/fhir-jira-db/load-updates.ts
  ```

- **create-fts.ts**
  After loading or updating the database, run this script to (re)create the FTS5 (Full-Text Search) tables for issues and comments, and populate them with the latest data. This enables fast, flexible text searching across issues and comments.
  **Run with:**
  ```sh
  bun run create-fts
  # or
  bun packages/fhir-jira-db/create-fts.ts
  ```
  The script will drop and recreate the FTS5 tables, then fill them with the current contents of the database.
  Example queries you can run after setup:
  - Search issues: `SELECT * FROM issues_fts WHERE issues_fts MATCH 'search term'`
  - Search comments: `SELECT * FROM comments_fts WHERE comments_fts MATCH 'search term'`
  - Phrase search: `SELECT * FROM issues_fts WHERE issues_fts MATCH '"exact phrase"'`
  - Field-specific: `SELECT * FROM issues_fts WHERE title MATCH 'search term'`

- **create-tfidf.ts**
  This script implements TF-IDF (Term Frequency-Inverse Document Frequency) keyword extraction from JIRA issues. It analyzes text content from issue titles, descriptions, summaries, and custom fields to identify the most relevant keywords for each issue. The implementation includes FHIR-specific processing to preserve domain terminology.
  **Run with:**
  ```sh
  bun run create-tfidf
  # or
  bun packages/fhir-jira-db/create-tfidf.ts
  ```
  The script will:
  - Create new database tables (`tfidf_keywords` and `tfidf_corpus_stats`)
  - Process all issues in batches to extract keywords
  - Calculate TF-IDF scores for each keyword per issue
  - Store results for fast keyword-based search and similarity analysis
  
  Features:
  - Extracts top 15 keywords per issue by default
  - Preserves FHIR resource names (Patient, Observation, etc.)
  - Recognizes version identifiers (R4, R5, STU3)
  - Filters common stopwords while keeping technical terms
  - Enables finding similar issues based on keyword overlap
  
  Example uses after setup:
  - Find keywords for an issue: Query `tfidf_keywords` table
  - Search issues by keywords: Use keyword matching queries
  - Find similar issues: Compare keyword vectors
  - Analyze keyword trends: Group by time periods

Scripts require Bun (v1.0 or higher). First install dependencies:
```sh
bun install
```

The scripts expect the relevant XML files to be present in their respective directories (`bulk` for initial load, `updates` for updates). The database file is named `jira_issues.sqlite` and will be created or updated in the current working directory.

## Database Path Configuration

All database scripts now use a unified database path resolution system that supports:

1. **Explicit database path** via `--db-path` command-line option
2. **Automatic discovery** in these locations (in order):
   - Current working directory: `./jira_issues.sqlite`
   - Parent directory: `../jira_issues.sqlite`
   - Script directory: `<script-dir>/jira_issues.sqlite`
   - Script parent directory: `<script-dir>/../jira_issues.sqlite`

### Command-Line Options

All scripts support these common options:

```sh
# Use explicit database path
bun packages/fhir-jira-db/load-initial.ts --db-path /path/to/custom/database.sqlite

# Check if database exists without running the script
bun packages/fhir-jira-db/load-initial.ts --db-check

# Show help
bun packages/fhir-jira-db/load-initial.ts --help
```

### Script-Specific Options

- **load-initial.ts**: `--initial-dir <dir>` - Custom initial XML directory (default: `bulk`)
- **load-updates.ts**: `--update-dir <dir>` - Custom update XML directory (default: `updates`)
- **create-tfidf.ts**: 
  - `--batch-size <size>` - Processing batch size (default: 1000)
  - `--top-keywords <count>` - Keywords per issue (default: 15)

### Examples

```sh
# Load initial data from custom directory with custom database
bun packages/fhir-jira-db/load-initial.ts --db-path ./custom.sqlite --initial-dir ./my-bulk-data

# Create TF-IDF with custom settings
bun packages/fhir-jira-db/create-tfidf.ts --db-path ./prod.sqlite --batch-size 500 --top-keywords 20

# Check if database exists before processing
bun packages/fhir-jira-db/create-fts.ts --db-check
```

## MCP Server (`packages/fhir-jira-mcp`)

This package contains a Model Context Protocol (MCP) server that provides read-only access to the JIRA issues SQLite database. The server enables browsing work queues and searching for related tickets through various tools.

### Features
- Browse work queues with filtering by project, work group, resolution, status, and assignee
- Full-text search across issues, URLs, artifacts, pages, titles, and summaries
- Retrieve detailed issue information including custom fields and comments
- List all project keys and work groups in the database

### Installation & Usage

First, install dependencies:
```sh
cd packages/fhir-jira-mcp
bun install
```

#### STDIO Mode (For Claude Desktop and MCP clients)
```sh
bun start
# or
bun packages/fhir-jira-mcp/index.ts
```

STDIO mode is the default and recommended mode for MCP clients like Claude Desktop. The server communicates via standard input/output using JSON-RPC messages.

#### HTTP Mode (For testing and web integration)
```sh
bun packages/fhir-jira-mcp/mcp-http.ts
# or
bun packages/fhir-jira-mcp/mcp-http.ts --port 3000
```

HTTP mode starts a web server that wraps the STDIO MCP server and exposes it via HTTP endpoints. This is useful for testing, debugging, or integrating with web applications. The server runs on port 3000 by default, or you can specify a custom port with `--port <number>`. The HTTP wrapper spawns the main MCP server as a subprocess and handles JSON-RPC message routing between HTTP clients and the MCP server.

The MCP server now uses the same unified database path resolution system as the database scripts:

```sh
# Use explicit database path
bun packages/fhir-jira-mcp/index.ts --db-path /path/to/custom/database.sqlite

# Start HTTP server on custom port with custom database
bun packages/fhir-jira-mcp/mcp-http.ts --port 8080 --mcp-command "bun packages/fhir-jira-mcp/index.ts --db-path ./prod.sqlite"

# Check database connectivity
bun packages/fhir-jira-mcp/index.ts --db-check
```

The server operates in read-only mode for database safety and will automatically discover the database file using the same fallback locations as the database scripts. See the [fhir-jira-mcp README](packages/fhir-jira-mcp/README.md) for detailed configuration and usage instructions, including Claude Desktop integration and HTTP API documentation.

### Claude Code Integration

To use the MCP server with Claude Code, add it using the `claude mcp add` command:

```sh
claude mcp add FhirJira "bun" "packages/fhir-jira-mcp/index.ts"
```

This configures Claude Code to run the MCP server in stdio mode using Bun. The server will automatically discover your database file or you can specify a custom path by modifying the command to include `--db-path`:

```sh
claude mcp add FhirJira "bun" "packages/fhir-jira-mcp/index.ts" "--db-path" "/path/to/custom/database.sqlite"
```

## Quick Start

1. Install dependencies:
   ```sh
   bun install
   ```

2. Extract archives and load initial data:
   ```sh
   bun run extract-archives
   bun run load-initial
   bun run create-fts
   ```

3. (Optional) Download latest issues from Jira:
   ```sh
   bun run download-issues
   ```

4. Start the MCP server:
   ```sh
   cd packages/fhir-jira-mcp
   bun start
   ```