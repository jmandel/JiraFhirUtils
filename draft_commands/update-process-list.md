---
name: update-process-list
description: Build or update a FHIR ticket processing list
args:
  ticket_list_file:
    type: string
    description: Path to markdown file containing list of tickets to process
    required: true
  project_key:
    type: string
    description: Value to filter issues by project_key
    required: false
    default: FHIR
  work_group:
    type: string
    description: Value to filter issues by work_group
    required: false
    default: 'FHIR Infrastructure'
  resolution:
    type: string
    description: Values to filter issues by resolution
    required: false
    default: ''
  status:
    type: string
    description: Values to filter issues by status
    required: false
    default: 'Resolved - change required'
  assignee:
    type: string
    description: Values to filter issues by assignee
    required: false
    default: ''
  limit:
    type: number
    description: 'Maximum number of results (default: 20)'
    required: false
    default: 20
  offset:
    type: number
    description: 'Offset for pagination (default: 0)'
    required: false
    default: 0
---

# FHIR Ticket List Updating Command

## Sample Ticket List file

```markdown
# FHIR Ticket Batch Processing

## Batch Configuration
- **Max Concurrent**: 2
- **Auto Retry**: true
- **Max Retries**: 3
- **Created**: 2024-01-15 10:00:00

## Batch Status
- **Last Updated**: 2025-07-18 19:10:00
- **Total Tickets**: 
- **Pending**: 
- **In Progress**: 
- **Completed**: 
- **Failed**: 

## Active Agents

## Processing Timeline

## Tickets

### FHIR-12345
- **Status**: Pending
- **Started**:
- **Completed**: 
- **Agent**: 
- **Current Step**: 
- **Error**:
- **Retry Count**: 
```

## Command Implementation

```javascript
// Get current timestamp for metadata
const now = new Date().toISOString().replace('T', ' ').split('.')[0];

// Process arguments with defaults
const ticketListFile = args.ticket_list_file;
const projectKey = args.project_key || 'FHIR';
const workGroup = args.work_group || 'FHIR Infrastructure';
const resolution = args.resolution || 'Persuasive, Persuasive with Modification, Not Persuasive with Modification';
const status = args.status || 'Resolved - change required';
const assignee = args.assignee || '';
const limit = args.limit || 20;
const offset = args.offset || 0;

// Validate required arguments
if (!ticketListFile) {
    throw new Error('ticket_list_file argument is required');
}

// Fetch tickets from FHIR Jira using MCP
const jiraParams = {
    project_key: projectKey,
    work_group: workGroup,
    resolution: resolution,
    status: status,
    limit: limit,
    offset: offset
};

// Only add assignee if not empty
if (assignee.trim()) {
    jiraParams.assignee = assignee;
}

const jiraResponse = await mcp__FhirJira__list_issues(jiraParams);

if (!jiraResponse || !jiraResponse.issues) {
    throw new Error('Failed to fetch issues from FHIR Jira');
}

const fetchedTickets = jiraResponse.issues;

// Check if file exists
let existingContent = '';
let existingTicketKeys = new Set();
let fileExists = false;

try {
    existingContent = await Read({ file_path: ticketListFile });
    fileExists = true;
    
    // Extract existing ticket keys to prevent duplicates
    const ticketMatches = existingContent.match(/^### (FHIR-\d+)$/gm);
    if (ticketMatches) {
        ticketMatches.forEach(match => {
            const key = match.replace('### ', '');
            existingTicketKeys.add(key);
        });
    }
} catch (error) {
    // File doesn't exist, will create new one
    fileExists = false;
}

// Filter out duplicate tickets
const newTickets = fetchedTickets.filter(ticket => !existingTicketKeys.has(ticket.key));

if (newTickets.length === 0) {
    console.log('No new tickets to add. All fetched tickets already exist in the file.');
    return;
}

// Format new tickets
const formattedTickets = newTickets.map(ticket => {
    return `### ${ticket.key}
- **Status**: Pending
- **Started**:
- **Completed**: 
- **Agent**: 
- **Current Step**: 
- **Error**:
- **Retry Count**: `;
}).join('\n\n');

let updatedContent;

if (fileExists) {
    // Update existing file
    // Find the "## Tickets" section and append new tickets
    const ticketsHeaderIndex = existingContent.indexOf('## Tickets');
    
    if (ticketsHeaderIndex === -1) {
        throw new Error('Could not find "## Tickets" section in existing file');
    }
    
    // Update "Last Updated" timestamp
    const lastUpdatedRegex = /- \*\*Last Updated\*\*: .*/;
    existingContent = existingContent.replace(lastUpdatedRegex, `- **Last Updated**: ${now}`);
    
    // Update Total Tickets count
    const totalTicketsCount = existingTicketKeys.size + newTickets.length;
    const totalTicketsRegex = /- \*\*Total Tickets\*\*: .*/;
    existingContent = existingContent.replace(totalTicketsRegex, `- **Total Tickets**: ${totalTicketsCount}`);
    
    // Append new tickets to the end
    updatedContent = existingContent + '\n\n' + formattedTickets;
    
} else {
    // Create new file using template
    updatedContent = `# FHIR Ticket Batch Processing

## Batch Configuration
- **Max Concurrent**: 2
- **Auto Retry**: true
- **Max Retries**: 3
- **Created**: ${now}

## Batch Status
- **Last Updated**: ${now}
- **Total Tickets**: ${newTickets.length}
- **Pending**: ${newTickets.length}
- **In Progress**: 0
- **Completed**: 0
- **Failed**: 0

## Active Agents

## Processing Timeline

## Tickets

${formattedTickets}`;
}

// Write updated content to file
await Write({
    file_path: ticketListFile,
    content: updatedContent
});

console.log(`Successfully updated ${ticketListFile} with ${newTickets.length} new tickets`);
```