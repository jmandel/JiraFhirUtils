---
allowed-tools: Read(*), Write(temp/*), Bash(mkdir, find, cat), Task,mcp__fhir-jira__get_issue_details, mcp__fhir-jira__search_by_keywords

description: Launch a sub-agent to create a decision framework for resolving a FHIR ticket
argument-hint: <issue_key>
---

You'll be workign with a temporary directory based on $ARGUMENTS for the ticket at temp/FHIR-#####/01-redacted-summary.md  (you should check that this file exists without reading it).

If this does not exist, instruct the user to run /fhir:analyze-ticket $ARGUMENTS first.

If it exists, launch the propose-framework agent to create a decision framework for issue $ARGUMENTS.

The agent should:
- Read the redacted summary from temp/<issue_key>/01-redacted-summary.md
- Review relevant source files in the input/ directory
- Create a structured framework with essential decisions and mutually exclusive options
- Save output to temp/<issue_key>/02-resolution-framework.md

After completion, confirm that a new resolution framework file exists in the temp directory.
