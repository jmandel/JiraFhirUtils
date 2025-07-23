import path from 'path';
import { fileURLToPath } from 'url';
import { program } from 'commander';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename).replace(/\\/g, '/');

// Database search paths (same as MCP server)
const DB_PATHS: string[] = [
  path.join(process.cwd(), 'jira_issues.sqlite').replace(/\\/g, '/'),
  path.join(process.cwd(), '..', 'jira_issues.sqlite').replace(/\\/g, '/'),
  path.join(__dirname, 'jira_issues.sqlite').replace(/\\/g, '/'),
  path.join(__dirname, '..', 'jira_issues.sqlite').replace(/\\/g, '/'),
];

// Interface for command-line options
interface CommandOptions {
  dbPath?: string;
  dbCheck?: boolean;
  [key: string]: any;
}

// Interface for additional CLI option configuration
interface CliOptionConfig {
  description: string;
  defaultValue?: any;
}

interface AdditionalOptions {
  [flag: string]: CliOptionConfig;
}

/**
 * Find database path by searching through predefined locations
 * @returns Path to database file or null if not found
 */
export async function findDatabasePath(): Promise<string | null> {
  for (const dbPath of DB_PATHS) {
    try {
      //console.warn(`Checking for database at: ${dbPath}`);
      if (await Bun.file(dbPath).exists()) {
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
 * @param explicitPath - Optional explicit database path
 * @returns Path to database file
 * @throws Error if database file not found
 */
export async function getDatabasePath(explicitPath: string | null = null): Promise<string> {
  // Use explicit path if provided
  if (explicitPath) {
    const normalizedPath = explicitPath.replace(/\\/g, '/');
    if (!(await Bun.file(normalizedPath).exists())) {
      throw new Error(`Database file not found at specified path: ${explicitPath}`);
    }
    return normalizedPath;
  }

  // Check if command-line argument was provided
  const opts = program.opts() as CommandOptions;
  if (opts.dbPath) {
    const normalizedPath = opts.dbPath.replace(/\\/g, '/');
    if (!(await Bun.file(normalizedPath).exists())) {
      throw new Error(`Database file not found at specified path: ${opts.dbPath}`);
    }
    return normalizedPath;
  }

  const foundPath = await findDatabasePath();
  if (foundPath) {
    return foundPath;
  }

  // Fall back to searching standard locations
  throw new Error('Database not specified and jira_issues.sqlite not found in expected locations: ' + DB_PATHS.join(', '));
}

/**
 * Setup command-line argument parsing for database path
 * @param name - Program name
 * @param description - Program description
 * @param additionalOptions - Additional command-line options
 * @returns Parsed command-line options
 */
export async function setupDatabaseCliArgs(
  name: string, 
  description: string, 
  additionalOptions: AdditionalOptions = {}
): Promise<CommandOptions> {
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
  const opts = program.opts() as CommandOptions;

  // Handle database check mode
  if (opts.dbCheck) {
    try {
      const dbPath = await getDatabasePath();
      console.log(`✓ Database found at: ${dbPath}`);
      process.exit(0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`✗ Database not found: ${errorMessage}`);
      process.exit(1);
    }
  }

  return opts;
}

/**
 * Get database search paths array
 * @returns Array of database search paths
 */
export function getDbPaths(): string[] {
  return [...DB_PATHS];
}