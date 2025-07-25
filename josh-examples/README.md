# HL7 AUTODEV: Automated FHIR Ticket Resolution System

## Overview

HL7 AUTODEV is an intelligent workflow system designed to streamline the analysis and resolution of FHIR JIRA tickets. It uses AI-powered sub-agents to systematically process tickets through a structured 4-step workflow, from initial analysis to final implementation reporting.

## Use Cases

- **Batch Processing**: Handle multiple related FHIR tickets systematically
- **Consistent Analysis**: Ensure uniform analysis and documentation across all tickets
- **Decision Framework**: Create structured decision trees for complex specification issues
- **Implementation Tracking**: Generate detailed reports for work group review
- **Specification Maintenance**: Apply resolutions directly to specification files

## System Architecture

The system operates through four sequential phases:

1. **Analyze & Redact** - Extract core problems without resolution bias
2. **Propose Framework** - Create decision trees for resolution options
3. **Generate Resolution** - Develop detailed technical solutions
4. **Apply & Report** - Implement changes and generate reports

## Getting Started

### 1. Creating Issue Lists

You have several ways to create an `issues.txt` file for batch processing:

#### Method 1: Direct JIRA Query to Claude
1. Go to JIRA and run your query (e.g., `project = FHIR AND status = Triaged AND component = Terminology`)
2. Select all results (Ctrl+A) and copy (Ctrl+C)
3. Paste into Claude and ask:
   ```
   /fhir:create-issue-list <paste your copied JIRA results here>
   ```

#### Method 2: Search by Keywords
Ask Claude to search directly:
```
/fhir:create-issue-list find all issues related to Subscription channels
```

#### Method 3: Create from Meeting Notes or Email
If you have text containing issue keys:
```
/fhir:create-issue-list Please review FHIR-50350, FHIR-44219, and FHIR-45678 before our meeting
```

### 2. Finding Related Issue Clusters

After creating an initial issue list, you can ask Claude to identify related groups:

```
Claude, analyze the issues in issues.txt and group them by related themes. 
Create separate issue files for each cluster (e.g., issues-terminology.txt, 
issues-subscriptions.txt, issues-security.txt)
```

### 3. Running Batch Processing

Once you have your issue file(s), start batch processing:

```bash
# Process all steps for all issues
./batch.sh --file issues-terminology.txt

# Process specific steps
./batch.sh --file issues.txt --start-step 2 --end-step 3

# Dry run to see what would be executed
./batch.sh --file issues.txt --dry-run
```

## Detailed Workflow Example

### Step 1: Initial Query and Issue Collection

**JIRA Query Example:**
```
project = FHIR AND status IN (Triaged, "In Progress") AND component = Terminology AND created >= -90d
```

**Results in JIRA:**
```
FHIR-50084: Clarify CodeSystem supplement behavior
FHIR-49876: ValueSet expansion with inactive codes
FHIR-50123: ConceptMap equivalence semantics
...
```

**Copy results and create issue file:**
```
/fhir:create-issue-list FHIR-50084: Clarify CodeSystem supplement behavior
FHIR-49876: ValueSet expansion with inactive codes  
FHIR-50123: ConceptMap equivalence semantics
FHIR-49234: Terminology server capabilities
FHIR-50456: Code validation requirements
```

**Output:** Creates `issues.txt` with 5 unique issue keys.

### Step 2: Batch Processing Initiation

```bash
# Start processing all issues through all 4 steps
./batch.sh --file issues.txt
```

**What happens:**
- **Step 1**: Each issue gets analyzed, redacted summary created in `temp/FHIR-XXXXX/01-redacted-summary.md`
- **Step 2**: Decision frameworks created in `temp/FHIR-XXXXX/02-resolution-framework.md`
- **Pause**: System waits for manual review and decision selection
- **Step 3**: Detailed resolutions generated based on your decisions
- **Step 4**: Implementation reports created and changes applied

### Step 3: Manual Review and Decision Making

After Step 2 completes, you'll find files like:

**`temp/FHIR-50084/02-resolution-framework.md`:**
```markdown
# Resolution Framework: FHIR-50084

## Decision 1: How should CodeSystem supplements handle inactive codes?

* **Option 1A: Explicitly inherit status from base CodeSystem.**
  * *Implications: Clear behavior but requires tooling updates for status checking.*
* **Option 1B: Allow supplements to override status independently.**
  * *Implications: More flexible but could create confusion about code validity.*
* **Option 1C: Prohibit status modifications in supplements.**
  * *Implications: Simplest approach but limits supplement utility.*

**Selected Option:** 1A

---

## Decision 2: Should this be a breaking change or backward compatible?

* **Option 2A: Implement as breaking change in next major version.**
  * *Implications: Clean solution but affects existing implementations.*
* **Option 2B: Maintain backward compatibility with deprecation warnings.**
  * *Implications: Smoother transition but technical debt.*

**Selected Option:** 2B
```

**Edit the file to select options (1A, 2B) as shown above.**

### Step 4: Resume Processing

After making your decisions in all framework files:

```bash
# Resume from step 3 to generate resolutions based on your decisions
./batch.sh --file issues.txt --start-step 3 --end-step 3
```

Review the generated resolutions in `temp/FHIR-XXXXX/03-detailed-resolution.md`, then:

```bash
# Run final step to apply changes and generate reports
./batch.sh --file issues.txt --start-step 4 --end-step 4
```

## File Structure

```
project/
├── batch.sh                          # Main batch processing script
├── issues.txt                        # Your issue list
├── temp/                             # Working directory
│   └── FHIR-XXXXX/                   # Per-ticket workspace
│       ├── 01-redacted-summary.md    # Neutral problem analysis
│       ├── 02-resolution-framework.md # Decision tree (you edit this)
│       ├── 03-detailed-resolution.md # Technical implementation
│       └── 04-implementation-report.md # Final report
├── input/                            # FHIR specification source files
│   ├── fsh/                          # FSH definitions
│   ├── resources/                    # FHIR resources
│   └── ...
└── output/                           # Generated outputs
    └── FHIR-XXXXX/                   # Per-ticket outputs
```

## Advanced Usage

### Processing Subsets of Issues

```bash
# Create targeted issue lists
/fhir:create-issue-list component = Security AND priority = High
mv issues.txt issues-security-high.txt

/fhir:create-issue-list component = Terminology AND assignee = john.doe
mv issues.txt issues-terminology-johndoe.txt

# Process each subset
./batch.sh --file issues-security-high.txt
./batch.sh --file issues-terminology-johndoe.txt
```

### Resuming Failed Processes

If processing fails at any step:

```bash
# Resume from where it failed
./batch.sh --file issues.txt --start-step 3
```

### Testing Before Execution

```bash
# See what would be executed without running
./batch.sh --file issues.txt --dry-run
```

## Best Practices

1. **Start Small**: Begin with 3-5 related issues to get familiar with the workflow
2. **Review Carefully**: Always review framework decisions before proceeding to resolution
3. **Group Logically**: Create issue lists around coherent themes or work groups
4. **Backup Work**: The temp/ directory contains all working files - back it up regularly
5. **Iterate**: Use partial step processing to refine approaches before full execution

## Common Patterns

### Pattern 1: Work Group Preparation
```bash
# Get all triaged issues for a specific work group
/fhir:create-issue-list assignee = "FHIR-Infrastructure" AND status = Triaged
./batch.sh --file issues.txt --end-step 2  # Generate frameworks for review
# Review and edit frameworks, then continue
./batch.sh --file issues.txt --start-step 3
```

### Pattern 2: Priority Issue Resolution  
```bash
# Focus on high-priority items
/fhir:create-issue-list priority = Highest AND created >= -30d
./batch.sh --file issues.txt  # Full processing
```

### Pattern 3: Specification Area Cleanup
```bash
# Target specific components
/fhir:create-issue-list component IN ("Patient Administration", "Workflow") 
# Process in chunks for manageable review
./batch.sh --file issues.txt --end-step 2
```

This system transforms ad-hoc ticket resolution into a systematic, traceable, and efficient process while maintaining the quality and rigor required for FHIR specification development.