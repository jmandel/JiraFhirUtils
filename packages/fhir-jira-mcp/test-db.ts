import { Database } from 'bun:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

// Define types for database query results
interface CountResult {
  count: number;
}

interface ProjectKeyResult {
  project_key: string;
}

interface WorkGroupResult {
  field_value: string | null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH: string = path.join(__dirname, '..', 'jira_issues.sqlite');

console.log('Testing database connection...');
console.log(`Database path: ${DB_PATH}`);

try {
  const db = new Database(DB_PATH, { readonly: true });
  
  // Test basic query
  const issueCount = db.prepare('SELECT COUNT(*) as count FROM issues').get() as CountResult;
  console.log(`✓ Connected successfully`);
  console.log(`  Total issues: ${issueCount.count}`);
  
  // Test project keys
  const projects = db.prepare('SELECT DISTINCT project_key FROM issues LIMIT 5').all() as ProjectKeyResult[];
  console.log(`  Sample project keys: ${projects.map(p => p.project_key).join(', ')}`);
  
  // Test work groups
  const workGroups = db.prepare(
    'SELECT DISTINCT field_value FROM custom_fields WHERE field_name = "Work Group" LIMIT 5'
  ).all() as WorkGroupResult[];
  console.log(`  Sample work groups: ${workGroups.map(w => w.field_value).filter((v): v is string => v !== null).join(', ')}`);
  
  // Test FTS
  const ftsTest = db.prepare('SELECT COUNT(*) as count FROM issues_fts').get() as CountResult;
  console.log(`  FTS index entries: ${ftsTest.count}`);
  
  db.close();
  console.log('\n✓ All tests passed!');
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`✗ Error: ${errorMessage}`);
  process.exit(1);
}