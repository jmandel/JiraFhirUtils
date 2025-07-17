
# HL7 / FHIR Jira Utilities

This repo contains some tools and utilities to ease Jira ticket processing for FHIR.

## extract-xml

This folder contains utilities to create a SQLite database based on Jira tickets and compressed files with FHIR Core ticket XML exports:
* `extract-archives.js` extracts the included tar.gz archives into their respective directories for processing
* `load-initial.js` loads the contents of the `bulk` directory, creates a database, and assumes no duplicates/conflicts
* `load-updates.js` loads the contents of the `updates` directory into the database, updating existing records if they exist or adding new records if they do not
* `create-fts.js` creates SQLite FTS5 full-text search tables for `issues` and `comments` from the database.
* `create-tfidf.js` extracts TF-IDF data from Jira issues.
* `bulk.tar.gz` contains FHIR Core tickets FHIR-2839 through FHIR-51487, as of 2025.07.15
* `updates.tar.gz` contains FHIR Core tickets that have changes on 2025.07.15

- **extract-archives.js**
  Use this script to extract the tar.gz archives before processing. It will extract `bulk.tar.gz` to the `bulk` directory and `updates.tar.gz` to the `updates` directory. Any existing directories will be replaced.
  **Run with:**
  ```sh
  npm run extract-archives
  # or
  node extract-xml/extract-archives.js
  ```

- **load-initial.js**
  Use this script to create a new database from scratch using the XML files in the `bulk` directory. It assumes there are no duplicate or conflicting issues.
  **Run with:**
  ```sh
  npm run load-initial
  # or
  node extract-xml/load-initial.js
  ```

- **load-updates.js**
  Use this script to apply updates to an existing database using XML files in the `updates` directory. It will insert new issues, update existing ones, and add new comments or custom fields as needed, without affecting unrelated records.
  **Run with:**
  ```sh
  npm run load-updates
  # or
  node extract-xml/load-updates.js
  ```

- **create-fts.js**
  After loading or updating the database, run this script to (re)create the FTS5 (Full-Text Search) tables for issues and comments, and populate them with the latest data. This enables fast, flexible text searching across issues and comments.
  **Run with:**
  ```sh
  npm run create-fts
  # or
  node extract-xml/create-fts.js
  ```
  The script will drop and recreate the FTS5 tables, then fill them with the current contents of the database.
  Example queries you can run after setup:
  - Search issues: `SELECT * FROM issues_fts WHERE issues_fts MATCH 'search term'`
  - Search comments: `SELECT * FROM comments_fts WHERE comments_fts MATCH 'search term'`
  - Phrase search: `SELECT * FROM issues_fts WHERE issues_fts MATCH '"exact phrase"'`
  - Field-specific: `SELECT * FROM issues_fts WHERE title MATCH 'search term'`

- **create-tfidf.js**
  This script implements TF-IDF (Term Frequency-Inverse Document Frequency) keyword extraction from JIRA issues. It analyzes text content from issue titles, descriptions, summaries, and custom fields to identify the most relevant keywords for each issue. The implementation includes FHIR-specific processing to preserve domain terminology.
  **Run with:**
  ```sh
  npm run create-tfidf
  # or
  node extract-xml/create-tfidf.js
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

Scripts require Node.js (v14 or higher) and npm. First install dependencies:
```sh
npm install
```

The scripts expect the relevant XML files to be present in their respective directories (`bulk` for initial load, `updates` for updates). The database file is named `jira_issues.sqlite` and will be created or updated in the current working directory.

## Database Path Configuration

All extract-xml scripts now use a unified database path resolution system that supports:

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
node extract-xml/load-initial.js --db-path /path/to/custom/database.sqlite

# Check if database exists without running the script
node extract-xml/load-initial.js --db-check

# Show help
node extract-xml/load-initial.js --help
```

### Script-Specific Options

- **load-initial.js**: `--initial-dir <dir>` - Custom initial XML directory (default: `bulk`)
- **load-updates.js**: `--update-dir <dir>` - Custom update XML directory (default: `updates`)
- **create-tfidf.js**: 
  - `--batch-size <size>` - Processing batch size (default: 1000)
  - `--top-keywords <count>` - Keywords per issue (default: 15)

### Examples

```sh
# Load initial data from custom directory with custom database
node extract-xml/load-initial.js --db-path ./custom.sqlite --initial-dir ./my-bulk-data

# Create TF-IDF with custom settings
node extract-xml/create-tfidf.js --db-path ./prod.sqlite --batch-size 500 --top-keywords 20

# Check if database exists before processing
node extract-xml/create-fts.js --db-check
```

## fhir-jira-mcp

This folder contains a Model Context Protocol (MCP) server that provides read-only access to the JIRA issues SQLite database. The server enables browsing work queues and searching for related tickets through various tools.

### Features
- Browse work queues with filtering by project, work group, resolution, status, and assignee
- Full-text search across issues, URLs, artifacts, pages, titles, and summaries
- Retrieve detailed issue information including custom fields and comments
- List all project keys and work groups in the database

### Installation & Usage
```sh
cd fhir-jira-mcp
npm install
npm start  # For stdio mode (Claude Desktop)
npm run start:http  # For HTTP mode on port 3000
```

The MCP server now uses the same unified database path resolution system as the extract-xml scripts:

```sh
# Use explicit database path
node fhir-jira-mcp/index.js --db-path /path/to/custom/database.sqlite

# Start HTTP server on custom port with custom database
node fhir-jira-mcp/index.js --db-path ./prod.sqlite --port 8080

# Check database connectivity
node fhir-jira-mcp/index.js --db-check
```

The server operates in read-only mode for database safety and will automatically discover the database file using the same fallback locations as the extract-xml scripts. See the [fhir-jira-mcp README](fhir-jira-mcp/README.md) for detailed configuration and usage instructions, including Claude Desktop integration and HTTP API documentation.