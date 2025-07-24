import { Database } from "bun:sqlite";
import { XMLParser } from "fast-xml-parser";
import path from "path";
import fs from "fs";
import { promises as fsPromises } from "fs";
import { getDatabasePath, setupDatabaseCliArgs, type CommandOptions } from "@jira-fhir-utils/database-utils";

// --- Configuration ---
const UPDATE_SUBDIRECTORY = "updates"; // The subdirectory containing your update XML files
const XML_GLOB_PATTERN = "*.xml";

// --- Type Definitions ---

interface XmlItem {
  key?: {
    "#text": string;
    "@_id": string;
  };
  title?: string;
  link?: string;
  project?: {
    "@_id": string;
    "@_key": string;
  };
  description?: string;
  summary?: string;
  type?: {
    "#text": string;
    "@_id": string;
  };
  priority?: {
    "#text": string;
    "@_id": string;
  };
  status?: {
    "#text": string;
    "@_id": string;
    statusCategory?: {
      "@_id": string;
      "@_key": string;
      "@_colorName": string;
    };
  };
  resolution?: {
    "#text": string;
    "@_id": string;
  };
  assignee?: {
    "@_username": string;
  };
  reporter?: {
    "@_username": string;
  };
  created?: string;
  updated?: string;
  resolved?: string;
  watches?: string | number;
  customfields?: {
    customfield: CustomField[];
  };
  comments?: {
    comment: Comment[];
  };
}

interface CustomField {
  "@_id": string;
  "@_key": string;
  customfieldname: string;
  customfieldvalues?: {
    customfieldvalue: any;
  };
}

interface Comment {
  "@_id": string;
  "@_author": string;
  "@_created": string;
  "#text": string;
}

interface ParsedXmlData {
  rss?: {
    channel?: {
      item?: XmlItem[];
    };
  };
}

interface IssueData {
  key: string;
  id: string;
  title?: string;
  link?: string;
  project_id?: string;
  project_key?: string;
  description?: string;
  summary?: string;
  type?: string;
  type_id?: string;
  priority?: string;
  priority_id?: string;
  status?: string;
  status_id?: string;
  status_category_id?: string;
  status_category_key?: string;
  status_category_color?: string;
  resolution?: string;
  resolution_id?: string;
  assignee?: string;
  reporter?: string;
  created_at?: string | null;
  updated_at?: string | null;
  resolved_at?: string | null;
  watches: number;
}

interface CustomFieldData {
  issue_key: string;
  field_id: string;
  field_key: string;
  field_name: string;
  field_value: any;
}

interface CommentData {
  comment_id: string;
  issue_key: string;
  author: string;
  created_at: string | null;
  body: string;
}

interface LoadUpdatesOptions extends CommandOptions {
  updateDir?: string;
}

// --- Helper Functions ---

/**
 * Parses a date string and returns it in ISO 8601 format.
 */
function toISO(dateString: string | undefined): string | null {
    if (!dateString) return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Processes a single XML update file and loads its data into the database.
 */
async function processUpdateFile(filePath: string, db: Database): Promise<void> {
  console.log(`\nProcessing update file: ${filePath}`);

  try {
    const fileContent = await fsPromises.readFile(filePath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      isArray: (name: string, jpath: string): boolean => {
          return jpath === "rss.channel.item" ||
                 jpath === "rss.channel.item.customfields.customfield" ||
                 jpath === "rss.channel.item.comments.comment";
      }
    });
    const data = parser.parse(fileContent) as ParsedXmlData;

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
    const deleteCustomFields = db.prepare("DELETE FROM custom_fields WHERE issue_key = $issue_key");
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
    const processItem = db.transaction((item: XmlItem) => {
          const issueKey = item?.key?.["#text"];
          if (!issueKey || typeof issueKey !== "string"){
              console.warn(`Skipping item with missing key in ${filePath}: ${item.title || "Unknown Title"}`);
              return;
          }

        // 1. Upsert the main issue
        const issueData: IssueData = {
            key: issueKey,
            id: item.key?.["@_id"] || "",
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
        };

        upsertIssue.run(issueData);

        // 2. Replace custom fields
        deleteCustomFields.run({ issue_key: issueKey });
        const customFields = item.customfields?.customfield;
        if (customFields) {
            for (const field of customFields) {
                const valueNode = field.customfieldvalues?.customfieldvalue;
                let value = typeof valueNode === 'object' && valueNode !== null
                    ? (valueNode['#text'] || JSON.stringify(valueNode))
                    : valueNode;

                const customFieldData: CustomFieldData = {
                    issue_key: issueKey,
                    field_id: field["@_id"],
                    field_key: field["@_key"],
                    field_name: field.customfieldname,
                    field_value: value,
                };

                insertCustomField.run(customFieldData);
            }
        }

        // 3. Add new comments
        const comments = item.comments?.comment;
        if (comments) {
            for(const comment of comments) {
                const commentData: CommentData = {
                    comment_id: comment["@_id"],
                    issue_key: issueKey,
                    author: comment["@_author"],
                    created_at: toISO(comment["@_created"]),
                    body: comment["#text"],
                };

                insertComment.run(commentData);
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
async function main(): Promise<void> {
  console.log("Starting JIRA XML update process...");

  // Setup CLI arguments
  const options = await setupDatabaseCliArgs('load-updates', 'Load JIRA XML updates into SQLite database', {
    '--update-dir <dir>': {
      description: 'Directory containing update XML files',
      defaultValue: UPDATE_SUBDIRECTORY
    }
  }) as LoadUpdatesOptions;

  const databasePath = await getDatabasePath();
  const updateDir = options.updateDir || UPDATE_SUBDIRECTORY;
  
  console.log(`Using database: ${databasePath}`);
  console.log(`Update directory: ${updateDir}`);

  // Guard: Check if database file exists
  if (!fs.existsSync(databasePath)) {
    console.error(`Error: Database file '${databasePath}' not found.`);
    console.error("Please run the initial import script first.");
    return;
  }

  // Guard: Check if update directory exists
  const updatePath = path.join(process.cwd(), updateDir).replace(/\\/g, '/');
  if (!fs.existsSync(updatePath)) {
    console.error(`Error: Update directory '${updateDir}' not found.`);
    return;
  }

  const db = new Database(databasePath, { strict: true });
  db.exec("PRAGMA journal_mode = WAL;");

  const pattern = path.join(updatePath, XML_GLOB_PATTERN).replace(/\\/g, '/');
  const glob = new Bun.Glob(XML_GLOB_PATTERN);
  const files = await Array.fromAsync(glob.scan({ cwd: updateDir, onlyFiles: true }))
    .then((results: string[]) => results.map((file: string) => path.join(updateDir, file)));

  if (files.length === 0) {
    console.log(`No XML files found in subdirectory '${updateDir}'.`);
    db.close();
    return;
  }

  console.log(`Found ${files.length} XML files to process in '${updateDir}'.`);

  for (const filePath of files) {
    await processUpdateFile(filePath.replace(/\\/g, '/'), db);
  }

  db.close();
  console.log("\nUpdate process finished.");
}

main();