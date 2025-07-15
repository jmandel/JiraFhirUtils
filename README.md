
# HL7 / FHIR Jira Utilities

This repo contains some tools and utilities to ease Jira ticket processing for FHIR.

## extract-xml

This folder contains utilities to create a SQLite database based on Jira tickets and compressed files with FHIR Core ticket XML exports:
* `extract-archives.js` extracts the included tar.gz archives into their respective directories for processing
* `load-initial.js` loads the contents of the `bulk` directory, creates a database, and assumes no duplicates/conflicts
* `load-updates.js` loads the contents of the `updates` directory into the database, updating existing records if they exist or adding new records if they do not
* `create-fts.js` creates SQLite FTS5 full-text search tables for `issues` and `comments` from the database.
* `bulk.tar.gz` contains FHIR Core tickets FHIR-2839 through FHIR-51487, as of 2025.07.15
* `updates.tar.gz` contains FHIR Core tickets that have changes on 2025.07.15

- **extract-archives.js**
  Use this script to extract the tar.gz archives before processing. It will extract `bulk.tar.gz` to the `bulk` directory and `updates.tar.gz` to the `updates` directory. Any existing directories will be replaced.
  **Run with:**
  ```sh
  bun run extract-xml/extract-archives.js
  ```

- **load-initial.js**
  Use this script to create a new database from scratch using the XML files in the `bulk` directory. It assumes there are no duplicate or conflicting issues.
  **Run with:**
  ```sh
  bun run extract-xml/load-initial.js
  ```

- **load-updates.js**
  Use this script to apply updates to an existing database using XML files in the `updates` directory. It will insert new issues, update existing ones, and add new comments or custom fields as needed, without affecting unrelated records.
  **Run with:**
  ```sh
  bun run extract-xml/load-updates.js
  ```

- **create-fts.js**
  After loading or updating the database, run this script to (re)create the FTS5 (Full-Text Search) tables for issues and comments, and populate them with the latest data. This enables fast, flexible text searching across issues and comments.
  **Run with:**
  ```sh
  bun run extract-xml/create-fts.js
  ```
  The script will drop and recreate the FTS5 tables, then fill them with the current contents of the database.
  Example queries you can run after setup:
  - Search issues: `SELECT * FROM issues_fts WHERE issues_fts MATCH 'search term'`
  - Search comments: `SELECT * FROM comments_fts WHERE comments_fts MATCH 'search term'`
  - Phrase search: `SELECT * FROM issues_fts WHERE issues_fts MATCH '"exact phrase"'`
  - Field-specific: `SELECT * FROM issues_fts WHERE title MATCH 'search term'`

Scripts require [Bun](https://bun.sh/) and expect the relevant XML files to be present in their respective directories (`bulk` for initial load, `updates` for updates). The database file is named `jira_issues.sqlite` and will be created or updated in the current working directory.