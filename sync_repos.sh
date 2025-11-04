#!/bin/bash

# Script to push changes to both repositories
# Usage: ./sync_repos.sh [commit message]

set -e

echo "🔄 Syncing repositories..."
echo ""

# Check if there are changes to commit
if [ -z "$(git status --porcelain)" ]; then
    echo "✅ No changes to commit"
else
    # Stage all changes
    echo "📦 Staging changes..."
    git add -A
    
    # Commit with provided message or default
    COMMIT_MSG="${1:-Update repository}"
    echo "💾 Committing: $COMMIT_MSG"
    git commit -m "$COMMIT_MSG"
fi

# Push to both remotes
echo ""
echo "🚀 Pushing to luca-milletti_data/mcp_api_registry_http (origin)..."
git push origin main

echo ""
echo "🚀 Pushing to lucamilletti99/mcp_api_registry (mirror)..."
git push mirror main

echo ""
echo "✅ Both repositories synced successfully!"
echo ""
echo "📍 Repositories:"
echo "   - https://github.com/luca-milletti_data/mcp_api_registry_http"
echo "   - https://github.com/lucamilletti99/mcp_api_registry"

