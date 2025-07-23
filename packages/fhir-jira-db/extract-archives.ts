import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { $ } from "bun";

// --- Configuration ---
const BULK_ARCHIVE: string = "bulk.tar.gz";
const UPDATES_ARCHIVE: string = "updates.tar.gz";
const BULK_DIR: string = "bulk";
const UPDATES_DIR: string = "updates";

// --- Main extraction function ---
async function extractArchive(archivePath: string, targetDir: string): Promise<boolean> {
  const fullArchivePath: string = path.resolve(archivePath);
  const fullTargetDir: string = path.resolve(targetDir);
  
  if (!fs.existsSync(fullArchivePath)) {
    console.error(`Archive not found: ${fullArchivePath}`);
    return false;
  }
  
  console.log(`Extracting ${archivePath} to ${targetDir}...`);
  
  try {
    if (fs.existsSync(fullTargetDir)) {
      console.log(`Target directory ${targetDir} already exists. Removing...`);
      await $`rm -rf ${fullTargetDir}`;
    }
    
    await $`mkdir -p ${fullTargetDir}`;
    
    await $`tar -xzf ${fullArchivePath} -C ${fullTargetDir} --strip-components=1`;
    
    console.log(`✓ Successfully extracted ${archivePath}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to extract ${archivePath}:`, errorMessage);
    return false;
  }
}

// --- Main execution ---
async function main(): Promise<void> {
  console.log("JIRA Archive Extraction Utility");
  console.log("===============================\n");
  
  const __filename: string = fileURLToPath(import.meta.url);
  const scriptDir: string = path.dirname(__filename);
  process.chdir(scriptDir);
  
  console.log(`Working directory: ${process.cwd()}\n`);
  
  let success: boolean = true;
  
  success = await extractArchive(BULK_ARCHIVE, BULK_DIR) && success;
  
  success = await extractArchive(UPDATES_ARCHIVE, UPDATES_DIR) && success;
  
  if (success) {
    console.log("\n✓ All archives extracted successfully!");
  } else {
    console.log("\n✗ Some archives failed to extract. Check the errors above.");
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("Unexpected error:", errorMessage);
  process.exit(1);
});