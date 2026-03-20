#!/bin/bash
# Auto-bump cache version and deploy

FILE="web/index.html"
TIMESTAMP=$(date +%s)

# Replace version query params with current timestamp
sed -i '' "s/styles\.css?v=[0-9]*/styles.css?v=$TIMESTAMP/" "$FILE"
sed -i '' "s/app\.js?v=[0-9]*/app.js?v=$TIMESTAMP/" "$FILE"

echo "Cache version bumped to $TIMESTAMP"
firebase deploy --only hosting
