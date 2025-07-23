import { Database } from "bun:sqlite";
import { XMLParser } from "fast-xml-parser";
import path from "path";
import fs from "fs";
import { promises as fsPromises } from "fs";
import { getDatabasePath, setupDatabaseCliArgs } from "@jira-fhir-utils/database-utils";

// --- Configuration ---
const INITIAL_SUBDIRECTORY = "bulk"; // The subdirectory containing the initial XML files
const XML_GLOB_PATTERN = "*.xml";

// --- Database Setup ---

/**
 * Initializes the SQLite database and creates the necessary tables.
 * @param {Database} db - The database instance.
 */
function setupDatabase(db) {
  console.log(`Initializing database...`);
  db.exec("PRAGMA journal_mode = WAL;"); // for better performance and concurrency

  // Main table for JIRA issues
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      key TEXT PRIMARY KEY,
      id INTEGER,
      title TEXT,
      link TEXT,
      project_id INTEGER,
      project_key TEXT,
      description TEXT,
      summary TEXT,
      type TEXT,
      type_id INTEGER,
      priority TEXT,
      priority_id INTEGER,
      status TEXT,
      status_id INTEGER,
      status_category_id INTEGER,
      status_category_key TEXT,
      status_category_color TEXT,
      resolution TEXT,
      resolution_id INTEGER,
      assignee TEXT,
      reporter TEXT,
      created_at TEXT,
      updated_at TEXT,
      resolved_at TEXT,
      watches INTEGER
    );
  `);

  // Table for custom fields (one-to-many relationship with issues)
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key TEXT,
      field_id TEXT,
      field_key TEXT,
      field_name TEXT,
      field_value TEXT,
      FOREIGN KEY (issue_key) REFERENCES issues(key)
    );
  `);

    // Table for comments (one-to-many relationship with issues)
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id TEXT UNIQUE,
      issue_key TEXT,
      author TEXT,
      created_at TEXT,
      body TEXT,
      FOREIGN KEY (issue_key) REFERENCES issues(key)
    );
  `);

  console.log("Database schema is ready.");
}


/**
 * Parses a date string and returns it in ISO 8601 format.
 * Returns null if the date is invalid or not provided.
 * @param {string | undefined} dateString
 * @returns {string | null}
 */
function toISO(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date.toISOString();
}


/**
 * Processes a single XML file and loads its data into the database.
 * @param {string} filePath - The path to the XML file.
 * @param {Database} db - The database instance.
 */
async function processXmlFile(filePath, db) {
  console.log(`\nProcessing file: ${filePath}`);

  try {
    const fileContent = await fsPromises.readFile(filePath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      // Handle cases where a tag can be single or an array
      isArray: (name, jpath, isLeafNode, isAttribute) => {
          return jpath === "rss.channel.item" ||
                 jpath === "rss.channel.item.customfields.customfield" ||
                 jpath === "rss.channel.item.comments.comment";
      }
    });
    const data = parser.parse(fileContent);

    const items = data?.rss?.channel?.item;
    if (!items || items.length === 0) {
      console.log(`No items found in ${filePath}.`);
      return;
    }

    // Prepare insert statements for performance
    const insertIssue = db.prepare(
        `INSERT OR IGNORE INTO issues (key, id, title, link, project_id, project_key, description, summary, type, type_id, priority, priority_id, status, status_id, status_category_id, status_category_key, status_category_color, resolution, resolution_id, assignee, reporter, created_at, updated_at, resolved_at, watches)
         VALUES ($key, $id, $title, $link, $project_id, $project_key, $description, $summary, $type, $type_id, $priority, $priority_id, $status, $status_id, $status_category_id, $status_category_key, $status_category_color, $resolution, $resolution_id, $assignee, $reporter, $created_at, $updated_at, $resolved_at, $watches)`
    );

    const insertCustomField = db.prepare(
        `INSERT INTO custom_fields (issue_key, field_id, field_key, field_name, field_value)
         VALUES ($issue_key, $field_id, $field_key, $field_name, $field_value)`
    );

     const insertComment = db.prepare(
        `INSERT OR IGNORE INTO comments (comment_id, issue_key, author, created_at, body)
         VALUES ($comment_id, $issue_key, $author, $created_at, $body)`
    );

    // Use a transaction for bulk inserts from a single file
    const insertAll = db.transaction(items => {
        for (const item of items) {
            const issueKey = item?.key?.["#text"];
            if (!issueKey || typeof issueKey !== "string"){
                console.warn(`Skipping item with missing key in ${filePath}: ${item.title || "Unknown Title"}`);
                continue;
            }

            insertIssue.run({
                key: issueKey,
                id: item.key["@_id"],
                title: item.title,
                link: item.link,
                project_id: item.project?.["@_id"],
                project_key: item.project?.["@_key"],
                description: item.description,
                summary: item.summary,
                type: item.type?.["#text"],
                type_id: item.type?.["@_id"],
                priority: item.priority?.["#text"],
                priority_id: item.priority?.["@_id"],
                status: item.status?.["#text"],
                status_id: item.status?.["@_id"],
                status_category_id: item.status?.statusCategory?.["@_id"],
                status_category_key: item.status?.statusCategory?.["@_key"],
                status_category_color: item.status?.statusCategory?.["@_colorName"],
                resolution: item.resolution?.["#text"],
                resolution_id: item.resolution?.["@_id"],
                assignee: item.assignee?.["@_username"],
                reporter: item.reporter?.["@_username"],
                created_at: toISO(item.created),
                updated_at: toISO(item.updated),
                resolved_at: toISO(item.resolved),
                watches: Number(item.watches) || 0,
            });

            // Process custom fields
            const customFields = item.customfields?.customfield;
            if (customFields) {
                for (const field of customFields) {
                    const valueNode = field.customfieldvalues?.customfieldvalue;
                    let value = null;
                    if (typeof valueNode === 'object' && valueNode !== null) {
                        value = valueNode['#text'] || JSON.stringify(valueNode);
                    } else {
                        value = valueNode;
                    }

                    insertCustomField.run({
                        issue_key: item.key["#text"],
                        field_id: field["@_id"],
                        field_key: field["@_key"],
                        field_name: field.customfieldname,
                        field_value: value,
                    });
                }
            }

            // Process comments
            const comments = item.comments?.comment;
            if (comments) {
                for(const comment of comments) {
                    insertComment.run({
                        comment_id: comment["@_id"],
                        issue_key: item.key["#text"],
                        author: comment["@_author"],
                        created_at: toISO(comment["@_created"]),
                        body: comment["#text"],
                    });
                }
            }
        }
        return items.length;
    });

    const count = insertAll(items);
    console.log(`Successfully inserted or updated ${count} issues from ${filePath}.`);

  } catch (error) {
    console.error(`Failed to process file ${filePath}:`, error);
  }
}


// --- Main Execution ---
async function main() {
  console.log("Starting JIRA XML to SQLite import process...");

  // Setup CLI arguments
  const options = setupDatabaseCliArgs('load-initial', 'Load initial JIRA XML files into SQLite database', {
    '--initial-dir <dir>': {
      description: 'Directory containing initial XML files',
      defaultValue: INITIAL_SUBDIRECTORY
    }
  });

  let databasePath;
  try {
    databasePath = getDatabasePath();
  } catch (error) {
    databasePath = path.join(process.cwd(), 'jira_issues.sqlite').replace(/\\/g, '/');
  }
  
  const initialDir = options.initialDir || INITIAL_SUBDIRECTORY;
  
  console.log(`Using database: ${databasePath}`);
  console.log(`Initial directory: ${initialDir}`);

  const db = new Database(databasePath);
  setupDatabase(db);

  // Guard: Check if initial directory exists
  const initialPath = path.join(process.cwd(), initialDir).replace(/\\/g, '/');
  if (!fs.existsSync(initialPath)) {
    console.error(`Error: Initial content directory '${initialDir}' not found.`);
    return;
  }

  const pattern = path.join(initialPath, XML_GLOB_PATTERN).replace(/\\/g, '/');
  const glob = new Bun.Glob(pattern);
  const files = await Array.fromAsync(glob.scan({ cwd: initialDir, onlyFiles: true }))
    .then(results => results.map(file => path.join(initialDir, file)));

  if (files.length === 0) {
    console.log(`No XML files found matching pattern '${XML_GLOB_PATTERN}' in subdirectory '${initialDir}'.`);
    db.close();
    return;
  }

  console.log(`Found ${files.length} XML files to process.`);

  for (const filePath of files) {
    await processXmlFile(filePath.replace(/\\/g, '/'), db);
  }

  db.close();
  console.log("\nImport process finished.");
}

main();