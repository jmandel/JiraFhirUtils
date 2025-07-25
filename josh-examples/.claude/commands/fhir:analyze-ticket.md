---
allowed-tools: Read(*), Write(temp/*), Bash(mkdir, find, cat), Task,mcp__fhir-jira__get_issue_details, mcp__fhir-jira__search_by_keywords

description: Launch a sub-agent to analyze a FHIR ticket with redaction of proposed resolutions
argument-hint: <issue_key>
---

Create a temporary directory for the ticket from "$ARGUMENTS", like "temp/<issue_key>".

Launch the redact-and-summarize agent to analyze the FHIR ticket $ARGUMENTS.

The agent should:
- Retrieve full ticket details using the issue key $ARGUMENTS
- Create a neutral, redacted summary without proposed solutions
- Enrich with context from local FHIR specification files
- Find highly related tickets
- Save output to temp/<issue_key>/01-redacted-summary.md

After completion, confirm the redacted summary file exists in the temp directory.
