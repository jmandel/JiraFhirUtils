---
allowed-tools: Read(*), Write(./temp/**), Bash(mkdir, find, cat), Task,mcp__fhir-jira__get_issue_details, mcp__fhir-jira__search_by_keywords
description: Launch a sub-agent to generate a detailed resolution based on user decisions in the framework
argument-hint: <issue_key>
---

You'll be working with a temporary directory for the ticket at temp/<issue_key>/02-resolution-framework.md ; you should check that it exists and contains the user's decisions/selections.

If it does not exist, instruct the user to run /fhir:propose-framework $ARGUMENTS first.

Check if the framework document contains user decisions.

If no decisions are present, prompt the user to review and annotate the framework file.

If decisions are present, launch the generate-resolution agent for issue $ARGUMENTS.

The agent should:
- Read the background from temp/<issue_key>/01-redacted-summary.md and temp/<issue_key>/02-resolution-framework.md
- Extract user decisions from the framework document
- Develop specific technical changes required
- Create a detailed change plan with file modifications and validation approach
- Save output to temp/<issue_key>/03-detailed-resolution.md

After completion, confirm the detailed resolution file exists in the temp directory.
