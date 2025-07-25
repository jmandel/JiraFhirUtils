#!/bin/bash

# --- Default values ---
START_STEP=1
END_STEP=4
INPUT_FILE="issues.txt" # Default filename
DRY_RUN="false"         # Default to a "wet" run (actually execute commands)

# --- Helper function for usage ---
usage() {
  echo "Usage: $0 [--file <filename>] [--start-step <1-4>] [--end-step <1-4>] [--dry-run]"
  echo "Processes FHIR tickets listed in a file through a multi-step workflow."
  echo
  echo "Workflow Steps:"
  echo "  1: Analyze & Redact (/fhir:analyze-ticket)"
  echo "  2: Propose Framework (/fhir:propose-framework)"
  echo "  3: Generate Resolution (/fhir:generate-resolution)"
  echo "  4: Apply & Report (/fhir:apply-and-report)"
  echo
  echo "Arguments:"
  echo "  --file <path>   Path to the input file containing issue keys (default: issues.txt)."
  echo "  --start-step <N>  The step to start processing from (default: 1)."
  echo "  --end-step <N>    The step to end processing at (default: 4)."
  echo "  --dry-run         Print the commands that would be executed, without running them."
  echo "  -h, --help        Display this help message."
  exit 1
}

# --- Parse Command Line Arguments ---
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --file) INPUT_FILE="$2"; shift ;;
    --start-step) START_STEP="$2"; shift ;;
    --end-step) END_STEP="$2"; shift ;;
    --dry-run) DRY_RUN="true" ;; # Set the dry-run flag
    -h|--help) usage ;;
    *) echo "Unknown parameter passed: $1"; usage ;;
  esac
  shift
done

# --- Validate input file ---
if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file '$INPUT_FILE' not found."
    exit 1
fi

# --- Announce Run Mode ---
if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY RUN MODE: Commands will be printed, not executed."
fi

# --- Main Processing Loop ---
echo "Processing tickets from: $INPUT_FILE"
echo "Running from step $START_STEP to $END_STEP."
echo "============================================================"

while IFS= read -r issue_key || [[ -n "$issue_key" ]]; do
  if [ -z "$issue_key" ]; then
    continue
  fi

  echo -e "\n--- Processing Ticket: $issue_key ---"

  # Step 1: Analyze & Redact
  if [[ $START_STEP -le 1 && $END_STEP -ge 1 ]]; then
    echo "  [Step 1/4] Analyze & Redact for $issue_key"
    COMMAND="claude --debug --permission-mode bypassPermissions --model opus -p \"/fhir:analyze-ticket $issue_key\""
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "    WOULD RUN: $COMMAND"
    else
      echo "    RUNING: $COMMAND"
      eval "$COMMAND"
    fi
  fi

  # Step 2: Propose Framework
  if [[ $START_STEP -le 2 && $END_STEP -ge 2 ]]; then
    echo "  [Step 2/4] Propose Framework for $issue_key"
    COMMAND="claude --debug --permission-mode bypassPermissions --model opus -p \"/fhir:propose-framework $issue_key\""
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "    WOULD RUN: $COMMAND"
      echo "    (Dry run skips interactive pause)"
    else
      echo "    RUNING: $COMMAND"
      eval "$COMMAND"
      read -p "  Framework generated for $issue_key. Please review/edit temp/$issue_key/02-resolution-framework.md then press [Enter] to continue..."
    fi
  fi

  # Step 3: Generate Resolution
  if [[ $START_STEP -le 3 && $END_STEP -ge 3 ]]; then
    echo "  [Step 3/4] Generate Resolution for $issue_key"
    COMMAND="claude --debug --permission-mode bypassPermissions --model opus -p \"/fhir:generate-resolution $issue_key\""
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "    WOULD RUN: $COMMAND"
    else
      echo "    RUNING: $COMMAND"
      eval "$COMMAND"
    fi
  fi

  # Step 4: Apply and Report
  if [[ $START_STEP -le 4 && $END_STEP -ge 4 ]]; then
    echo "  [Step 4/4] Apply & Report for $issue_key"
    COMMAND="claude --debug --permission-mode bypassPermissions --model opus -p \"/fhir:apply-and-report $issue_key\""
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "    WOULD RUN: $COMMAND"
    else
      echo "    RUNING: $COMMAND"
      eval "$COMMAND"
    fi
  fi

  echo "--- Finished Processing Ticket: $issue_key ---"

done < "$INPUT_FILE"

echo -e "\n============================================================"
echo "All tickets in '$INPUT_FILE' have been processed."
