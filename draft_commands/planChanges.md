**FHIR JIRA TICKET PLAN COMMAND**

Think deeply about this planning task.

**Variables:**
issue_key: $ARGUMENTS

**ARGUMENTS PARSING:**
Parse the following arguments from "$ARGUMENTS":
1. `issue_key` - FHIR Jira ticket issue key

**PHASE 1: Ticket analysis**

Retrieve the details of the FHIR Jira ticket `issue_key`

Looking at FHIR-50622, think harder about what changes should be made. Limit changes to the contents of the src folder. Plan the changes and describe them to me, with reasoning for each change. Please describe exactly the changes you plan to make to any files, including both the original contents, the result of the changes, and a description of what was changed. Save the plans in a Markdown file, temp/wip.md.


-- need to search for related issues, then ask the user if they want to actually include the ticket as part of the workflow

Can you please find tickets relevant to FHIR-50622? Please provide a list with the key and title, a summary of the description and resolution, and why the ticket would be relevant to FHIR-50622. Only use the tools: get_issue_details and find_related_issues.