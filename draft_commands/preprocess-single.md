---
name: preprocess
description: Process a FHIR Jira issue, performing preprocessing steps sequentially
args:
  issue_key:
    type: string
    description: Issue key to process
    required: true
  start_step:
    type: string
    description: Name of starting step (step_1, step_2, or step_3). Earlier steps will be skipped.
    required: false
    default: analyze_issue
---

# Preprocessing Pipeline for {{issue_key}}

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