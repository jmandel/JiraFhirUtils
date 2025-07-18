---
name: apply-changes
description: Apply the planned changes from the markdown file
parameters:
  - name: issue_key
    description: The primary FHIR Jira ticket key
    required: true
    type: string
  - name: dry_run
    description: If true, only simulate changes without applying
    required: false
    type: boolean
    default: false
---

You are applying planned changes for a FHIR ticket implementation.

## Instructions

1. Read the "Proposed Changes" section from `temp/{{issue_key}}.md`.

2. For each file modification listed:
   - Verify the file exists (or should be created)
   - Verify the original content matches (for modifications)
   - Apply the changes exactly as specified

3. If {{dry_run}} is true:
   - Only validate that changes can be applied
   - Report what would be changed without modifying files
   - Add a "### Dry Run Results" section to the markdown

4. If {{dry_run}} is false:
   - Apply each change
   - Track success/failure of each change
   - Add a "### Change Application Results" section:

```
### Change Application Results

**Execution Time**: [timestamp]
**Total Changes Planned**: [number]
**Successfully Applied**: [number]
**Failed**: [number]

#### Applied Changes
[List each successful change]

#### Failed Changes
[List any failures with error details]

#### Verification Status
[Note any post-change verification performed]
```

5. Error handling:
   - If original content doesn't match, skip that change and note the mismatch
   - If a file operation fails, continue with other changes
   - Create a backup notation of what was attempted
   - Never leave files in a partially modified state

6. After all changes:
   - Provide a summary of what was accomplished
   - List any changes that need manual intervention
   - Suggest next steps for verification