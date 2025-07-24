import { program } from 'commander';
import path from 'path';

// Types
interface WeekRange {
  start: string;
  end: string;
}

interface CliOptions {
  specification?: string;
  cookie: string;
  outputDir: string;
  limit?: number;
}

interface DownloadResult {
  week: WeekRange;
  filename: string;
  error?: string;
}

interface DownloadResults {
  successful: DownloadResult[];
  failed: DownloadResult[];
  totalProcessed: number;
}

interface FetchHeaders {
  [key: string]: string;
}

function setupCliArgs(): CliOptions {
  program
    .name('build-download-script')
    .description('Download JIRA XML files by week starting from current week working backwards')
    .option('--specification <name>', 'Optional Jira specification to include as a filter')
    .requiredOption('--cookie <value>', 'Authentication cookie for JIRA access')
    .requiredOption('--output-dir <path>', 'Directory to save downloaded XML files')
    .option('--limit <number>', 'Maximum number of weeks to download (default: unlimited)', parseInt);

  program.parse();
  return program.opts() as CliOptions;
}

function generateWeekRanges(limit: number | null = null): WeekRange[] {
  const weeks: WeekRange[] = [];
  const today = new Date();
  
  // Find the most recent Sunday (start of current week)
  let current = new Date(today);
  while (current.getDay() !== 0) {
    current.setDate(current.getDate() - 1);
  }
  
  const earliestDate = new Date('2015-07-13');
  
  while (current >= earliestDate) {
    const weekStart = new Date(current);
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    // Format as YYYY-MM-DD
    const startStr = weekStart.toISOString().split('T')[0];
    const endStr = weekEnd.toISOString().split('T')[0];
    
    weeks.push({ start: startStr, end: endStr });
    
    // If we have a limit and reached it, stop
    if (limit && weeks.length >= limit) {
      break;
    }
    
    // Move to previous Sunday
    current.setDate(current.getDate() - 7);
  }
  
  return weeks;
}

function generateJqlQuery(week: WeekRange, specification?: string, upperBound?: string): string {
  const endDate = upperBound || week.end;
  const baseQuery = `project = "FHIR Specification Feedback" and updated <= '${endDate} 23:59:59' and updated >= '${week.start} 00:00:00' order by updated asc`;
  
  if (specification) {
    return `Specification = "${specification}" and ${baseQuery}`;
  } else {
    return baseQuery;
  }
}

function generateUrl(week: WeekRange, specification?: string, upperBound?: string): string {
  const jqlQuery = generateJqlQuery(week, specification, upperBound);
  const encodedJqlQuery = encodeURIComponent(jqlQuery);
  return `https://jira.hl7.org/sr/jira.issueviews:searchrequest-xml/temp/SearchRequest.xml?jqlQuery=${encodedJqlQuery}&tempMax=1000`;
}

function createFetchHeaders(cookie: string, jqlQuery: string): FetchHeaders {
  const refererUrl = `https://jira.hl7.org/issues/?jql=${encodeURIComponent(jqlQuery)}`;
  
  return {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "en-US,en;q=0.9",
    "priority": "u=0, i",
    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Microsoft Edge\";v=\"138\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
    "cookie": cookie,
    "referer": refererUrl
  };
}

async function fetchXmlContent(url: string, filename: string, headers: FetchHeaders, retries: number = 1): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`  Fetching ${filename} (attempt ${attempt}/${retries})`);
      const response = await fetch(url, {
        headers: headers,
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const xmlText = await response.text();
      console.log(`  ✓ Fetched ${filename} (${xmlText.length} chars)`);
      return xmlText;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`  ✗ Attempt ${attempt} failed for ${filename}:`, errorMessage);
      if (attempt === retries) {
        console.error(`  ✗ Failed to fetch ${filename} after ${retries} attempts`);
        return null;
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  return null;
}

async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    const file = Bun.file(dirPath);
    const exists = await file.exists();
    if (!exists) {
      console.log(`Creating directory: ${dirPath}`);
      await Bun.$`mkdir -p ${dirPath}`;
    }
  } catch (error) {
    console.log(`Creating directory: ${dirPath}`);
    await Bun.$`mkdir -p ${dirPath}`;
  }
}

async function saveXmlFile(xmlContent: string, filename: string, outputDir: string): Promise<void> {
  const filePath = path.join(outputDir, filename);
  const file = Bun.file(filePath);
  await Bun.write(file, xmlContent);
  console.log(`  ✓ Saved ${filename}`);
}

async function downloadWeeklyXmlFiles(weeks: WeekRange[], options: CliOptions): Promise<DownloadResults> {
  const { cookie, outputDir, specification } = options;
  
  await ensureDirectoryExists(outputDir);
  
  const results: DownloadResults = {
    successful: [],
    failed: [],
    totalProcessed: 0
  };
  
  // Get today's date in YYYY-MM-DD format for the current week
  const today = new Date().toISOString().split('T')[0];
  
  console.log(`\nStarting download of ${weeks.length} weekly XML files...`);
  console.log(`Output directory: ${outputDir}`);
  
  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    const filename = `WeekOf_${week.start}.xml`;
    
    // For the first week (current week), use today as upper bound to exclude future dates
    const upperBound = i === 0 ? today : undefined;
    const jqlQuery = generateJqlQuery(week, specification, upperBound);
    const url = generateUrl(week, specification, upperBound);
    const headers = createFetchHeaders(cookie, jqlQuery);
    
    console.log(`\nProcessing week ${i + 1}/${weeks.length}: ${week.start} to ${week.end}`);
    
    const xmlContent = await fetchXmlContent(url, filename, headers);
    if (xmlContent) {
      try {
        await saveXmlFile(xmlContent, filename, outputDir);
        results.successful.push({ week, filename });
      } catch (saveError) {
        const errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
        console.error(`  ✗ Failed to save ${filename}:`, errorMessage);
        results.failed.push({ week, filename, error: errorMessage });
      }
    } else {
      results.failed.push({ week, filename, error: 'Failed to fetch' });
    }
    
    results.totalProcessed++;
    
    // Small delay between requests
    if (i < weeks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return results;
}

async function main(): Promise<void> {
  const options = setupCliArgs();
  
  console.log('Starting JIRA XML download...');
  if (options.specification) {
    console.log(`Specification filter: ${options.specification}`);
  }
  console.log(`Output directory: ${options.outputDir}`);
  if (options.limit) {
    console.log(`Download limit: ${options.limit} weeks`);
  }
  
  const weeks = generateWeekRanges(options.limit);
  
  console.log(`\nGenerated ${weeks.length} week ranges (working backwards from current week)`);
  if (weeks.length > 0) {
    console.log(`Date range: ${weeks[weeks.length - 1].start} to ${weeks[0].end}`);
  }
  
  try {
    const results = await downloadWeeklyXmlFiles(weeks, options);
    
    // Create summary report
    console.log('\n=== DOWNLOAD SUMMARY ===');
    console.log(`Total processed: ${results.totalProcessed}`);
    console.log(`Successful downloads: ${results.successful.length}`);
    console.log(`Failed downloads: ${results.failed.length}`);
    
    if (results.failed.length > 0) {
      console.log('\nFailed downloads:');
      results.failed.forEach(({ filename, error }) => {
        console.log(`  ✗ ${filename}: ${error}`);
      });
    }
    
    // Save manifest file
    const manifestPath = path.join(options.outputDir, 'download_manifest.txt');
    let manifest = `JIRA FHIR XML Download Report\n`;
    manifest += `Generated: ${new Date().toISOString()}\n`;
    manifest += `Specification: ${options.specification || 'All'}\n`;
    manifest += `Total weeks processed: ${results.totalProcessed}\n`;
    manifest += `Successful downloads: ${results.successful.length}\n`;
    manifest += `Failed downloads: ${results.failed.length}\n\n`;
    
    manifest += `Successful files:\n`;
    results.successful.forEach(({ filename, week }) => {
      manifest += `✓ ${filename} (${week.start} to ${week.end})\n`;
    });
    
    if (results.failed.length > 0) {
      manifest += `\nFailed files:\n`;
      results.failed.forEach(({ filename, week, error }) => {
        manifest += `✗ ${filename} (${week.start} to ${week.end}): ${error}\n`;
      });
    }
    
    const manifestFile = Bun.file(manifestPath);
    await Bun.write(manifestFile, manifest);
    console.log(`\n✓ Download manifest saved to: ${manifestPath}`);
    
    console.log('\nDownload completed!');
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Fatal error during download:', errorMessage);
    process.exit(1);
  }
}

main().catch(error => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('Error:', errorMessage);
  process.exit(1);
});