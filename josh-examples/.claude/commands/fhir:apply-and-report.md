allowed-tools: Read(*), Write(./input/*), Write(./temp/*), Bash(*), Task, mcp__fhir-jira__get_issue_details, mcp__fhir-jira__get_issue_comments, mcp__fhir-jira__search_issues_by_keywords
description: Launch a sub-agent to apply the resolution and generate a final implementation report
argument-hint: <issue_key>
---

You'll be working with the temporary directory for the ticket at temp/<issue_key>/.

Before proceeding:
1. Verify that the following files exist (don't read, just check for existence):
   - temp/<issue_key>/01-redacted-summary.md
   - temp/<issue_key>/02-resolution-framework.md
   - temp/<issue_key>/03-detailed-resolution.md

If any of these are missing, instruct the user to complete the prior steps using:
- /fhir:analyze-ticket $ARGUMENTS
- /fhir:propose-framework $ARGUMENTS
- /fhir:generate-resolution $ARGUMENTS

Once all prerequisites are met:

1. Create an output directory for this ticket under `output/<issue_key>/` if it doesn't already exist.
2. Launch the apply-and-resolve agent for issue $ARGUMENTS.

The agent should:
- Read all prerequisite files from temp/<issue_key>/
- Parse the detailed resolution and extract proposed file modifications
- Apply changes to files in the local repo using available tools
- Generate a comprehensive implementation report with change log, impact analysis, and traceability
- Save the final report to temp/<issue_key>/04-implementation-report.md

After completion, confirm that the file `temp/<issue_key>/04-implementation-report.md` exists and summarize its key contents for the user.
