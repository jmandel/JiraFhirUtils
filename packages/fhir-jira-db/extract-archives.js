import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { $ } from "bun";

// --- Configuration ---
const BULK_ARCHIVE = "bulk.tar.gz";
const UPDATES_ARCHIVE = "updates.tar.gz";
const BULK_DIR = "bulk";
const UPDATES_DIR = "updates";

// --- Main extraction function ---
async function extractArchive(archivePath, targetDir) {
  const fullArchivePath = path.resolve(archivePath);
  const fullTargetDir = path.resolve(targetDir);
  
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
    console.error(`✗ Failed to extract ${archivePath}:`, error.message);
    return false;
  }
}

// --- Main execution ---
async function main() {
  console.log("JIRA Archive Extraction Utility");
  console.log("===============================\n");
  
  const __filename = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(__filename);
  process.chdir(scriptDir);
  
  console.log(`Working directory: ${process.cwd()}\n`);
  
  let success = true;
  
  success = await extractArchive(BULK_ARCHIVE, BULK_DIR) && success;
  
  success = await extractArchive(UPDATES_ARCHIVE, UPDATES_DIR) && success;
  
  if (success) {
    console.log("\n✓ All archives extracted successfully!");
  } else {
    console.log("\n✗ Some archives failed to extract. Check the errors above.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});