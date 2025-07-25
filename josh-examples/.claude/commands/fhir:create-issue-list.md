---
allowed-tools: mcp__fhir-jira__search_issues_by_keywords, Write(issues.txt)
description: Creates issues.txt by either searching JIRA or parsing provided text for issue keys.
argument-hint: <search_query | text_with_issue_keys>
---

Your goal is to populate a file named `issues.txt` with a list of JIRA issue keys based on the user's input (`$ARGUMENTS`).

The user's input can represent one of two intentions. It is your responsibility to determine the intent and act accordingly.

**Intent 1: Search JIRA**
If the user's input appears to be a search query, a set of keywords, or a JQL string intended to find issues, you should:
1.  Use the `mcp__fhir-jira__search_issues_by_keywords` tool with the provided query.
2.  Extract the issue keys from the search results.

*Example of this intent:* `"status = Triaged and component = Terminology"`

**Intent 2: Extract from Provided Text**
If the user's input appears to be a direct data dump, meeting notes, an email, or any free-form text that already contains the specific `FHIR-` issue keys, you should:
1.  Parse the input text directly to find all strings that match the JIRA issue key format (e.g., `FHIR-12345`).
2.  **Do not** use the search tool in this case. The user has already provided the keys they want.

*Example of this intent:* `"Team, please review FHIR-50350 and the related ticket FHIR-44219 before our meeting."`

**Final Steps (for either intent):**
1.  Collect all unique issue keys you have found.
2.  Create a new file named `issues.txt`.
3.  Write the unique issue keys into `issues.txt`, one key per line.
4.  Report back to the user with the number of unique issues found and written to the file.
