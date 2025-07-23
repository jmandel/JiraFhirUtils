import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { program } from 'commander';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename).replace(/\\/g, '/');

// Database search paths (same as MCP server)
const DB_PATHS = [
  path.join(process.cwd(), 'jira_issues.sqlite').replace(/\\/g, '/'),
  path.join(process.cwd(), '..', 'jira_issues.sqlite').replace(/\\/g, '/'),
  path.join(__dirname, 'jira_issues.sqlite').replace(/\\/g, '/'),
  path.join(__dirname, '..', 'jira_issues.sqlite').replace(/\\/g, '/'),
];

/**
 * Find database path by searching through predefined locations
 * @returns {string} Path to database file
 * @throws {Error} If database file not found in any location
 */
export function findDatabasePath() {
  for (const dbPath of DB_PATHS) {
    try {
      //console.warn(`Checking for database at: ${dbPath}`);
      if (fs.existsSync(dbPath)) {
        return dbPath;
      }
    } catch (error) {
      // Continue to next path if current one fails
    }
  }

  return null;
}

/**
 * Get database path from command-line argument or fallback to search
 * @param {string} [explicitPath] - Optional explicit database path
 * @returns {string} Path to database file
 */
export function getDatabasePath(explicitPath = null) {
  // Use explicit path if provided
  if (explicitPath) {
    if (!fs.existsSync(explicitPath.replace(/\\/g, '/'))) {
      throw new Error(`Database file not found at specified path: ${explicitPath}`);
    }
    return explicitPath.replace(/\\/g, '/');
  }

  // Check if command-line argument was provided
  const opts = program.opts();
  if (opts.dbPath) {
    if (!fs.existsSync(opts.dbPath.replace(/\\/g, '/'))) {
      throw new Error(`Database file not found at specified path: ${opts.dbPath}`);
    }
    return opts.dbPath.replace(/\\/g, '/');
  }

  const foundPath = findDatabasePath();
  if (foundPath) {
    return foundPath;
  }

  // Fall back to searching standard locations
  throw new Error('Database not specified and jira_issues.sqlite not found in expected locations: ' + DB_PATHS.join(', '));
}

/**
 * Setup command-line argument parsing for database path
 * @param {string} name - Program name
 * @param {string} description - Program description
 * @param {Object} additionalOptions - Additional command-line options
 * @returns {Object} Parsed command-line options
 */
export function setupDatabaseCliArgs(name, description, additionalOptions = {}) {
  program
    .name(name)
    .description(description)
    .option('--db-path <path>', 'Path to SQLite database file (default: auto-discover)')
    .option('--db-check', 'Check if database exists without running the program', false);

  // Add any additional options
  Object.entries(additionalOptions).forEach(([flag, config]) => {
    program.option(flag, config.description, config.defaultValue);
  });

  program.parse();
  const opts = program.opts();

  // Handle database check mode
  if (opts.dbCheck) {
    try {
      const dbPath = getDatabasePath();
      console.log(`✓ Database found at: ${dbPath}`);
      process.exit(0);
    } catch (error) {
      console.error(`✗ Database not found: ${error.message}`);
      process.exit(1);
    }
  }

  return opts;
}

/**
 * Get database search paths array
 * @returns {string[]} Array of database search paths
 */
export function getDbPaths() {
  return [...DB_PATHS];
}