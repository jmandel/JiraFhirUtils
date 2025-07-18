#!/bin/bash

# Run npm install in the main directory
npm install

# Run the required npm scripts
npm run extract-archives
npm run load-initial
npm run load-updates
npm run create-fts
npm run create-tfidf

# Run npm install in the fhir-jira-mcp subdirectory
(
  cd fhir-jira-mcp
  npm install
)