import Database from "better-sqlite3";
import { glob } from "glob";
import { XMLParser } from "fast-xml-parser";
import path from "path";
import fs from "fs";
import { promises as fsPromises } from "fs";

// --- Configuration ---
const DATABASE_FILE = "jira_issues.sqlite";
const UPDATE_SUBDIRECTORY = "updates"; // The subdirectory containing your update XML files
const XML_GLOB_PATTERN = "*.xml";

// --- Helper Functions ---

/**
 * Parses a date string and returns it in ISO 8601 format.
 * @param {string | undefined} dateString
 * @returns {string | null}
 */
function toISO(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Processes a single XML update file and loads its data into the database.
 * @param {string} filePath - The path to the XML file.
 * @param {Database} db - The database instance.
 */
async function processUpdateFile(filePath, db) {
  console.log(`\nProcessing update file: ${filePath}`);

  try {
    const fileContent = await fsPromises.readFile(filePath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      isArray: (name, jpath) => {
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

    // --- Prepare SQL statements for upserting and managing related data ---

    // For the 'issues' table, we use ON CONFLICT to perform an "upsert".
    // If a record with the same 'key' exists, it updates it. Otherwise, it inserts.
    const upsertIssue = db.prepare(
      `INSERT INTO issues (key, id, title, link, project_id, project_key, description, summary, type, type_id, priority, priority_id, status, status_id, status_category_id, status_category_key, status_category_color, resolution, resolution_id, assignee, reporter, created_at, updated_at, resolved_at, watches)
       VALUES ($key, $id, $title, $link, $project_id, $project_key, $description, $summary, $type, $type_id, $priority, $priority_id, $status, $status_id, $status_category_id, $status_category_key, $status_category_color, $resolution, $resolution_id, $assignee, $reporter, $created_at, $updated_at, $resolved_at, $watches)
       ON CONFLICT(key) DO UPDATE SET
         title = excluded.title,
         link = excluded.link,
         project_id = excluded.project_id,
         project_key = excluded.project_key,
         description = excluded.description,
         summary = excluded.summary,
         type = excluded.type,
         type_id = excluded.type_id,
         priority = excluded.priority,
         priority_id = excluded.priority_id,
         status = excluded.status,
         status_id = excluded.status_id,
         status_category_id = excluded.status_category_id,
         status_category_key = excluded.status_category_key,
         status_category_color = excluded.status_category_color,
         resolution = excluded.resolution,
         resolution_id = excluded.resolution_id,
         assignee = excluded.assignee,
         reporter = excluded.reporter,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         resolved_at = excluded.resolved_at,
         watches = excluded.watches;`
    );

    // For custom fields, we delete all existing ones for the issue and re-insert them.
    // This is the simplest way to handle additions, updates, and deletions.
    const deleteCustomFields = db.prepare("DELETE FROM custom_fields WHERE issue_key = ?");
    const insertCustomField = db.prepare(
        `INSERT INTO custom_fields (issue_key, field_id, field_key, field_name, field_value)
         VALUES ($issue_key, $field_id, $field_key, $field_name, $field_value)`
    );

    // For comments, we can simply ignore duplicates based on their unique ID.
    const insertComment = db.prepare(
        `INSERT OR IGNORE INTO comments (comment_id, issue_key, author, created_at, body)
         VALUES ($comment_id, $issue_key, $author, $created_at, $body)`
    );

    // Create a transaction function to process each item atomically
    const processItem = db.transaction(item => {
        if (!item.key || !item.key["#text"]) return;
        const issueKey = item.key["#text"];

        // 1. Upsert the main issue
        upsertIssue.run({
            $key: issueKey,
            $id: item.key["@_id"],
            $title: item.title,
            $link: item.link,
            $project_id: item.project?.["@_id"],
            $project_key: item.project?.["@_key"],
            $description: item.description,
            $summary: item.summary,
            $type: item.type?.["#text"],
            $type_id: item.type?.["@_id"],
            $priority: item.priority?.["#text"],
            $priority_id: item.priority?.["@_id"],
            $status: item.status?.["#text"],
            $status_id: item.status?.["@_id"],
            $status_category_id: item.status?.statusCategory?.["@_id"],
            $status_category_key: item.status?.statusCategory?.["@_key"],
            $status_category_color: item.status?.statusCategory?.["@_colorName"],
            $resolution: item.resolution?.["#text"],
            $resolution_id: item.resolution?.["@_id"],
            $assignee: item.assignee?.["@_username"],
            $reporter: item.reporter?.["@_username"],
            $created_at: toISO(item.created),
            $updated_at: toISO(item.updated),
            $resolved_at: toISO(item.resolved),
            $watches: Number(item.watches) || 0,
        });

        // 2. Replace custom fields
        deleteCustomFields.run(issueKey);
        const customFields = item.customfields?.customfield;
        if (customFields) {
            for (const field of customFields) {
                const valueNode = field.customfieldvalues?.customfieldvalue;
                let value = typeof valueNode === 'object' && valueNode !== null
                    ? (valueNode['#text'] || JSON.stringify(valueNode))
                    : valueNode;

                insertCustomField.run({
                    $issue_key: issueKey,
                    $field_id: field["@_id"],
                    $field_key: field["@_key"],
                    $field_name: field.customfieldname,
                    $field_value: value,
                });
            }
        }

        // 3. Add new comments
        const comments = item.comments?.comment;
        if (comments) {
            for(const comment of comments) {
                insertComment.run({
                    $comment_id: comment["@_id"],
                    $issue_key: issueKey,
                    $author: comment["@_author"],
                    $created_at: toISO(comment["@_created"]),
                    $body: comment["#text"],
                });
            }
        }
    });

    // Run the transaction for each item in the file
    let successCount = 0;
    for (const item of items) {
        processItem(item);
        successCount++;
    }
    console.log(`Successfully processed ${successCount} items from ${filePath}.`);

  } catch (error) {
    console.error(`Failed to process file ${filePath}:`, error);
  }
}

// --- Main Execution ---
async function main() {
  console.log("Starting JIRA XML update process...");

  // Guard: Check if database file exists
  if (!fs.existsSync(DATABASE_FILE)) {
    console.error(`Error: Database file '${DATABASE_FILE}' not found.`);
    console.error("Please run the initial import script first.");
    return;
  }

  // Guard: Check if update directory exists
  const updatePath = path.join(process.cwd(), UPDATE_SUBDIRECTORY);
  if (!fs.existsSync(updatePath)) {
    console.error(`Error: Update directory '${UPDATE_SUBDIRECTORY}' not found.`);
    return;
  }

  const db = new Database(DATABASE_FILE);
  db.exec("PRAGMA journal_mode = WAL;");

  const pattern = path.join(updatePath, XML_GLOB_PATTERN);
  const files = await glob(pattern, { nodir: true });

  if (files.length === 0) {
    console.log(`No XML files found in subdirectory '${UPDATE_SUBDIRECTORY}'.`);
    db.close();
    return;
  }

  console.log(`Found ${files.length} XML files to process in '${UPDATE_SUBDIRECTORY}'.`);

  for (const filePath of files) {
    await processUpdateFile(filePath, db);
  }

  db.close();
  console.log("\nUpdate process finished.");
}

main();