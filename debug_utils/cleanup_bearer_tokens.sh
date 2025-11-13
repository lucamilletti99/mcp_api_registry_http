#!/bin/bash

# Cleanup script for mcp_bearer_tokens scope
# Removes old per-endpoint secrets, keeping only API-level secrets

set -e

echo "🧹 Cleaning up mcp_bearer_tokens scope..."
echo ""

# List current secrets
echo "📋 Current secrets in mcp_bearer_tokens:"
databricks secrets list-secrets mcp_bearer_tokens
echo ""

# Ask for confirmation
read -p "❓ Do you want to delete old per-endpoint GitHub secrets? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "❌ Cleanup cancelled"
    exit 0
fi

echo ""
echo "🗑️  Deleting old per-endpoint secrets..."

# Delete old GitHub per-endpoint secrets
OLD_SECRETS=(
    "github_repo_details"
    "github_repos_api"
    "github_user_repos"
)

for secret in "${OLD_SECRETS[@]}"; do
    echo "  - Deleting: $secret"
    if databricks secrets delete-secret --scope mcp_bearer_tokens --key "$secret" 2>/dev/null; then
        echo "    ✅ Deleted"
    else
        echo "    ⚠️  Not found or already deleted"
    fi
done

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📋 Remaining secrets in mcp_bearer_tokens:"
databricks secrets list-secrets mcp_bearer_tokens
echo ""
echo "💡 You should now have only API-level secrets (e.g., 'github_api', not 'github_repos_api')"

