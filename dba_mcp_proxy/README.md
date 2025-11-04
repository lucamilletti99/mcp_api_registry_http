# API Registry MCP Proxy

MCP proxy client for the API Registry Databricks App. This proxy enables Claude CLI to interact with the API Registry MCP server running on Databricks Apps.

## Usage

### Adding to Claude CLI

```bash
# Set your configuration
export DATABRICKS_HOST="https://your-workspace.cloud.databricks.com"
export DATABRICKS_APP_URL="https://your-app.databricksapps.com"  # From ./app_status.sh

# Add to Claude (user-scoped)
claude mcp add api-registry --scope user -- \
  uvx --refresh --from git+ssh://git@github.com/luca-milletti_data/mcp_api_registry_http.git dba-mcp-proxy \
  --databricks-host $DATABRICKS_HOST \
  --databricks-app-url $DATABRICKS_APP_URL
```

### Local Development

For testing against your local development server:

```bash
# Start local dev server first
./watch.sh

# Add local MCP server to Claude
export DATABRICKS_HOST="https://your-workspace.cloud.databricks.com"
export DATABRICKS_APP_URL="http://localhost:8000"

claude mcp add api-registry-local --scope local -- \
  uvx --refresh --from git+ssh://git@github.com/lucamilletti99/mcp_server_api_registry.git dba-mcp-proxy \
  --databricks-host $DATABRICKS_HOST \
  --databricks-app-url $DATABRICKS_APP_URL
```

## What It Does

The proxy:
- Connects to the API Registry MCP server at `/mcp/` endpoint
- Handles Databricks OAuth authentication automatically
- Translates between Claude's stdio protocol and HTTP/SSE
- Provides access to all API Registry tools

## Available Tools

Once added, Claude can use these tools:

- `smart_register_api` - One-step API registration with discovery
- `register_api_in_registry` - Manual API registration
- `check_api_registry` - List registered APIs
- `review_api_documentation_for_endpoints` - Discover new endpoints from docs
- `call_api_endpoint` - Test API endpoints
- `execute_dbsql` - Run SQL queries
- `discover_api_endpoint` - Validate endpoints
- `fetch_api_documentation` - Parse API docs
- `list_warehouses` - List SQL warehouses

## Authentication

- **Local**: No authentication required (`http://localhost:8000`)
- **Deployed**: OAuth via Databricks CLI (`databricks auth login`)

## Testing Connection

```bash
# Verify it works
echo "What MCP tools are available from api-registry?" | claude
```
