---
name: preprocess
description: Process FHIR Jira issues, supporting both single ticket and bulk batch processing
args:
  issue_key:
    type: string
    description: Single issue key to process (mutually exclusive with ticket_list_file)
    required: false
  ticket_list_file:
    type: string
    description: Path to markdown file containing list of tickets to process (mutually exclusive with issue_key)
    required: false
  max_concurrent:
    type: number
    description: Maximum number of tickets to process concurrently (only used with ticket_list_file)
    required: false
    default: 2
  start_step:
    type: string
    description: Name of starting step for single ticket processing (only used with issue_key)
    required: false
    default: analyze_issue
---

# FHIR Ticket Preprocessing Command

## Parameter Validation

{{#if (and issue_key ticket_list_file)}}
❌ **ERROR**: Cannot specify both `issue_key` and `ticket_list_file`. Choose one processing mode:
- **Single ticket**: Use `issue_key` parameter
- **Batch processing**: Use `ticket_list_file` parameter

{{/if}}
{{#unless (or issue_key ticket_list_file)}}
❌ **ERROR**: Must specify either `issue_key` for single ticket processing OR `ticket_list_file` for batch processing.

**Usage Examples:**
- Single ticket: `/preprocess issue_key=FHIR-12345`
- Batch processing: `/preprocess ticket_list_file=tickets.md max_concurrent=3`

{{/unless}}
{{#if (and (not ticket_list_file) max_concurrent)}}
⚠️  **WARNING**: `max_concurrent` parameter is only used with `ticket_list_file` (batch processing mode).

{{/if}}
{{#if (and (not issue_key) start_step)}}
⚠️  **WARNING**: `start_step` parameter is only used with `issue_key` (single ticket processing mode).

{{/if}}

{{#if ticket_list_file}}
---
# Bulk Ticket Processing Mode

**Input File**: `{{ticket_list_file}}`  
**Max Concurrent**: {{max_concurrent}}  
**Processing Mode**: Batch

<agent>
You are the **Batch Processing Coordinator** for FHIR ticket preprocessing. Your task is to manage the bulk processing of multiple tickets with concurrency control and comprehensive status tracking.

## Configuration
- **Ticket List File**: {{ticket_list_file}}
- **Max Concurrent**: {{max_concurrent}}
- **Processing Mode**: Bulk

## Your Responsibilities

### 1. Initialize Batch Processing
- Read and validate the ticket list file: `{{ticket_list_file}}`
- Verify the file format matches the expected structure (see below)
- Extract the list of tickets and their current status
- Validate that the file is writable for status updates

### 2. Expected Input File Format
The input file should follow this structure:
```markdown
# FHIR Ticket Batch Processing

## Batch Configuration
- **Max Concurrent**: 2
- **Auto Retry**: true
- **Max Retries**: 3
- **Created**: 2024-01-15 10:00:00

## Batch Status
- **Last Updated**: 2024-01-15 10:30:00
- **Total Tickets**: 5
- **Pending**: 2
- **In Progress**: 1
- **Completed**: 2
- **Failed**: 0

## Active Agents
- **agent-001**: Processing FHIR-12346 (Step: find_related, Started: 10:25:00)

## Processing Timeline
- 10:20:00 - Batch processing started
- 10:21:00 - agent-001 started FHIR-12347
- 10:25:00 - agent-001 completed FHIR-12347

## Tickets

### FHIR-12345
- **Status**: Pending
- **Started**: 
- **Completed**: 
- **Agent**: 
- **Current Step**: 
- **Error**: 
- **Retry Count**: 0
```

### 3. Batch Processing Workflow
1. **Parse Ticket List**: Extract all tickets with status "Pending" or "Failed" (for retry)
2. **Sort by Priority**: High → Normal → Low (FIFO within same priority)
3. **Concurrent Processing**: 
   - Maintain up to {{max_concurrent}} active worker agents
   - Use the Task tool to spawn worker agents for individual tickets
   - Monitor agent completion and spawn new workers as slots become available
4. **Status Management**: Update the input file in real-time with:
   - Agent assignments and status changes
   - Current processing step for each active ticket
   - Completion timestamps and error information
   - Overall batch statistics and progress

### 4. Worker Agent Coordination
For each ticket to process, use the Task tool to spawn a worker agent with this prompt:

```
Process FHIR ticket {{TICKET_KEY}} through the standard 4-step preprocessing pipeline. You must update the status file as you progress.

**Configuration:**
- Ticket Key: {{TICKET_KEY}}
- Status File: {{ticket_list_file}}
- Agent ID: agent-{{timestamp}}

**Your Tasks:**
1. Update status to "In Progress" with your agent ID and start timestamp
2. Execute the 4-step pipeline:
   - Step 1: analyze_issue (update current step in status file)
   - Step 2: find_related (update current step in status file)
   - Step 3: update_analysis (update current step in status file)
   - Step 4: change_plan (update current step in status file)
3. Update status to "Completed" with completion timestamp
4. On any error, update status to "Failed" with detailed error information

**4-Step Pipeline Instructions:**
[You should execute the same steps as the single-ticket mode - analyze the issue using MCP Service, create temp/{{TICKET_KEY}}.md, find related issues, update analysis, and create change plan]

**Status Update Protocol:**
- Read the current status file before making updates
- Update only your ticket's section
- Maintain the markdown structure
- Include timestamps on all changes
- Add entries to the Processing Timeline section

Process the ticket and report back when complete or if any errors occur.
```

### 5. Progress Monitoring
- **Real-time Updates**: Continuously update the status file with current progress
- **Active Agent Tracking**: Maintain the "Active Agents" section showing current work
- **Timeline Logging**: Add significant events to the "Processing Timeline"
- **Statistics Updates**: Keep batch statistics current (pending, in progress, completed, failed counts)

### 6. Error Handling
- **Individual Failures**: Continue processing other tickets if one fails
- **Retry Logic**: Support retry of failed tickets (if auto_retry is enabled)
- **File Conflicts**: Handle concurrent file access gracefully
- **Resource Management**: Monitor and handle agent resource issues

### 7. Completion Report
When all tickets are processed, provide a final summary:
- Total tickets processed
- Success/failure counts
- Processing time statistics
- Any issues encountered
- Recommendations for failed tickets

## Important Notes
- **Concurrency Limit**: Never exceed {{max_concurrent}} active agents
- **File Safety**: Always use atomic updates to prevent corruption
- **Progress Visibility**: Keep users informed of current status
- **Error Recovery**: Gracefully handle and document all failures

Start the batch processing now and coordinate until completion.
</agent>

{{else}}
---
# Single Ticket Processing Mode

**Issue Key**: {{issue_key}}  
{{#if start_step}}**Starting Step**: {{start_step}}{{/if}}  
**Processing Mode**: Single Ticket

{{#if (eq start_step "analyze_issue")}}
## Step 1: analyze_issue

<agent>
<!-- Step 1 Instructions -->
You are an expert FHIR specification analyst. Your task is to retrieve and analyze a FHIR Jira ticket.

Task: analyze the issue: {{issue_key}}.

<!-- Specific step 1 instructions -->
1. Use the MCP Service (FhirJira) to call `get_issue_details` with the key: {{issue_key}}
2. Create a markdown file at `temp/{{issue_key}}.md` with the following structure:

```
# FHIR Ticket Analysis: {{issue_key}}

## Ticket Information
**Key**: {{issue_key}} ([current status])
**Title**: [issue title]
**Resolution**:[issue resolution] [issue resolution_description]
**Summary**: [ticket summary]
**Description**:
> [Full ticket description]

**Resolution**: [Issue resolution] OR Unresolved
> [Issue resolution_description] 

**Comments**:
[List any relevant comments from the ticket]

## Initial Analysis

### Problem Statement
[Clearly articulate what problem this ticket is trying to solve]

### Scope
[Define the scope of changes this ticket requires]

### Technical Impact
[Analyze what parts of the FHIR specification might be affected]

### Complexity Assessment
[Assess the complexity: Simple, Moderate, Complex, Very Complex]

### Recommendations
[Provide initial thoughts on how to approach this ticket]

## Updated Analysis
TBD

## Change Plan
TBD

---
*Analysis completed at: {{date "2006-01-02 15:04:05 MST"}}*
```

3. If any errors occur during retrieval or analysis:
   - Still create the markdown file with available information
   - Include an "## Errors" section documenting what went wrong
   - Continue with partial analysis where possible
   - Log specific error messages for debugging

4. Ensure the file is saved successfully before completing.

<!-- Step 1 Parameters to pass -->
Issue Key: {{issue_key}}
</agent>

Wait for Step 1 to complete before proceeding...
{{/if}}

{{#if (or (eq start_step "analyze_issue") (eq start_step "find_related"))}}
## Step 2: find_related

<agent>
<!-- Step 2 Instructions -->
You are tasked with finding and documenting tickets related to a primary FHIR issue.

Task: Find tickets related to {{issue_key}}.

<!-- Specific step 2 instructions -->
1. Verify that `temp/{{issue_key}}.md` exists. If not, inform the user to run `fhir-analyze-ticket` first.
2. Use the MCP Service (FhirJira) to call `list_related_issues` with the key: {{issue_key}}
3. For each issue listed in the results of `list_related_issues`, spawn an agent with the original issue key ({{issue_key}}) and the related issue key ({{related_issue_key}}).
  3.a. Within the agent, call `get_issue_details` to retrieve full information for the original issue ({{issue_key}}) and the related issue ({{related_issue_key}}).
  3.b. Within the agent, append a new section to `temp/{{issue_key}}.md`:

```
## Related Tickets

[For each related ticket, add a subsection using the appropriate prefix:]

### Linked: [issue_key] OR ### Related: [issue_key]
**Key**: {{issue_key}} ([current status])
**Title**: [issue title]
**Resolution**:[issue resolution] [issue resolution_description]
**Summary**: [ticket summary]
**Description**:
> [Full ticket description]

**Resolution**: [Issue resolution] OR Unresolved
> [Issue resolution_description] 

#### Relationship to {{issue_key}}
[Explain how these tickets are connected]

#### Overlapping Concerns
[List any overlapping technical areas, requirements, or solutions]

#### Potential Conflicts
[Identify any potential conflicts if both tickets were implemented]

#### Relationship Score: [0-10]
- 0-2: Barely related, possibly false positive
- 3-4: Loosely related, same general area
- 5-6: Moderately related, some overlap
- 7-8: Strongly related, significant overlap
- 9-10: Critical relationship, should be considered together

#### AI Recommendation
[Should this ticket be considered when implementing {{issue_key}}? Why or why not?]
```

5. Error handling:
   - If a related ticket cannot be retrieved, still add its section with an error note
   - Document any API errors in an "### Errors Finding Related Tickets" subsection
   - Continue processing other tickets even if some fail
   - Include retry logic for transient failures

<!-- Step 2 Parameters to pass -->
Original Issue Key: {{issue_key}}
Related Issue Key: {{related_issue_key}}
</agent>

Wait for Step 2 to complete before proceeding...
{{/if}}

{{#if (or (eq start_step "analyze_issue") (eq start_step "find_related") (eq start_step "update_analysis"))}}
## Step 3: update_analysis

<agent>
<!-- Step 3 Instructions -->
You are an expert FHIR specification analyst. Your task is to consider a ticket in the context of related tickets.

Task: Create the Updated Analysis for {{issue_key}} in `temp/{{issue_key}}.md`.

<!-- Specific step 3 instructions -->
1. Read and think harder about `temp/{{issue_key}}.md`.
2. Based on the contents of the file, and considering all the tickets listed, update the contents of the "Updated Analysis" section based on the following template:
```
### Problem Statement
[Clearly articulate what problem this ticket is trying to solve]

### Scope
[Define the scope of changes this ticket requires]

### Technical Impact
[Analyze what parts of the FHIR specification might be affected]

### Complexity Assessment
[Assess the complexity: Simple, Moderate, Complex, Very Complex]

### Recommendations
[Provide initial thoughts on how to approach this ticket]
```

<!-- Step 3 Parameters to pass -->
Issue Key: {{issue_key}}

Wait for Step 3 to complete before proceeding...
</agent>
{{/if}}


{{#if (or (eq start_step "analyze_issue") (eq start_step "find_related") (eq start_step "update_analysis") (eq start_step "change_plan"))}}
## Step 4: change_plan 

<agent>
<!-- Step 4 Instructions -->
You are an expert FHIR specification analyst. Your task is to propose a change plan based on ticket analysis.

Task: Create the Change Plan for {{issue_key}} in `temp/{{issue_key}}.md`.

<!-- Specific step 4 instructions -->
1. Read `temp/{{issue_key}}.md` and think harder about the "Updated Analysis" section.
2. Based on ONLY the contents of "Updated Analysis" section, plan the changes to the specification source. The plan should be added into the "Change Plan" section of the document and use the template:
```
## Change Plan
[Brief overview of all changes needed]

### File Modifications

[For each file that needs to be modified:]

#### File: source/path/to/file.ext

**Change Type**: [Create/Modify/Delete]

**Reason**: [Why this file needs to be changed]

**Changes**:

[For modifications, show before/after:]

**Original Content** (lines X-Y):
```
[exact original content]
```

**Modified Content**:
```
[exact modified content]
```

**Description**: [Explain what this change accomplishes]

### Validation Plan
[How to verify these changes work correctly]

### Migration Notes
[Any special considerations for applying these changes]

### Rollback Plan
[How to revert if needed]
```
4. Ensure all proposed changes:
   - Are limited to the `source` directory and subdirectories
   - Include enough context to apply changes precisely
   - Are consistent with FHIR specification standards
   - Consider impacts identified in related tickets analysis

5. Error handling:
   - If files can't be read, note in the plan with specific error details
   - If changes are ambiguous, flag for human review with clear explanations
   - Continue planning other changes even if some are problematic
   - Validate that all referenced files exist in the source directory

You are ONLY creating the plan, DO NOT modify any files other than `temp/{{issue_key}}.md`.

<!-- Step 4 Parameters to pass -->
Issue Key: {{issue_key}}

Wait for Step 4 to complete before proceeding...
</agent>
{{/if}}

## Pipeline Complete

All preprocessing steps for issue {{issue_key}} have been completed successfully.

{{/if}}

---

## Usage Examples

### Single Ticket Processing
```bash
# Process a single ticket starting from the beginning
/preprocess issue_key=FHIR-12345

# Process a single ticket starting from a specific step  
/preprocess issue_key=FHIR-12345 start_step=find_related
```

### Batch Processing
```bash
# Process multiple tickets with default concurrency (2)
/preprocess ticket_list_file=my-tickets.md

# Process multiple tickets with higher concurrency
/preprocess ticket_list_file=my-tickets.md max_concurrent=4
```

### Sample Ticket List File
Create a file like `my-tickets.md` with this structure:
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

### FHIR-xxxxx
- **Status**: 
- **Started**:
- **Completed**: 
- **Agent**: 
- **Current Step**: 
- **Error**:
- **Retry Count**: 
```