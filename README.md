# 🔌 API Registry MCP Server

A Databricks app that helps you discover, register, and manage external API endpoints with an AI-powered chat interface.

## What is this?

An API discovery and management platform that runs on Databricks Apps:

- **🤖 AI Chat Interface**: Register APIs using natural language powered by Claude
- **📊 API Registry**: Database-backed catalog of external API endpoints
- **🔐 Secure Auth**: Support for public APIs, API keys, and bearer tokens
- **🛠️ MCP Server**: Programmatic API management tools
- **📚 Smart Discovery**: Automatic endpoint testing and documentation parsing

---

## Quick Start

### Prerequisites

**Workspace Requirements:**
- Databricks Apps enabled (Public Preview)
- Foundation Model API with a tool-enabled model endpoint
- At least one SQL Warehouse ([create one](https://docs.databricks.com/en/compute/sql-warehouse/create.html))
- Unity Catalog access

**Local Machine:**
- Python 3.12+ with `uv` package manager
- Databricks CLI v0.260.0+

📖 **Detailed requirements:** [WORKSPACE_REQUIREMENTS.md](WORKSPACE_REQUIREMENTS.md)

---

### Step 1: Clone and Setup

Run this on your **local machine** (not in Databricks):

```bash
git clone https://github.com/luca-milletti_data/mcp_api_registry_http.git
cd mcp_api_registry_http
./setup.sh  # Interactive - press Enter to use defaults
```

This installs dependencies, configures Databricks CLI, and creates `.env.local` with your settings.

---

### Step 2: Create the API Registry Table

```bash
uv run python setup_table.py your_catalog your_schema
```

Or manually run the SQL from `setup_api_registry_table.sql` in Databricks SQL Editor.

---

### Step 3: Setup Secret Scopes (For Authenticated APIs)

**Skip if you only use public APIs with no authentication.**

For APIs with API keys or bearer tokens, you need a **one-time admin setup**:

```bash
./setup_shared_secrets.sh
# When prompted, enter your app's service principal ID
```

**What this does:**
- Creates two shared scopes: `mcp_api_keys` and `mcp_bearer_tokens`
- Grants your app's service principal WRITE access
- That's it! Users can now register authenticated APIs through the app

**Where to find your service principal ID:**
1. Go to Databricks workspace → Compute → Apps
2. Click on your app → Look for "Service Principal ID"

**Why this works:**
- The app's service principal manages all secrets
- No per-user permissions needed
- Users interact through the app UI only

📖 **Detailed guide:** [SECRETS_WORKAROUND.md](SECRETS_WORKAROUND.md)

---

### Step 4: Deploy to Databricks

```bash
# First time:
./deploy.sh --create

# Updates:
./deploy.sh
```

Your app will be at: `https://your-app-name.databricksapps.com`

**App Naming:** Must start with `mcp-` (e.g., `mcp-api-registry`, `mcp-prod-registry`)

---

## API Authentication Types

The app supports three authentication types:

| Type | When to Use | Where Credential Goes | Example APIs |
|------|-------------|----------------------|--------------|
| **none** | Public APIs with no auth | N/A | Treasury, Public datasets |
| **api_key** | Key passed as query param | `?api_key=xxx` in URL | FRED, Alpha Vantage, NewsAPI |
| **bearer_token** | Token passed in header | `Authorization: Bearer xxx` | GitHub, Stripe, Shopify |

### Quick Examples

**Public API (no auth):**
```
"Register the Treasury Fiscal Data API at 
https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/rates_of_exchange"
```

**API Key Authentication:**
```
"Register the FRED API at https://api.stlouisfed.org/fred/series/observations
Use API key authentication with key: YOUR_API_KEY_HERE"
```

**Bearer Token Authentication:**
```
"Register the GitHub API at https://api.github.com/user/repos
Use bearer token authentication with token: ghp_YOUR_TOKEN_HERE"
```

### How It Works

**API Key Auth:**
- Key stored in `mcp_api_keys` scope
- HTTP connection has empty bearer_token
- Key retrieved from secrets and added to params at runtime

**Bearer Token Auth:**
- Token stored in `mcp_bearer_tokens` scope
- HTTP connection references the secret
- Databricks automatically adds `Authorization: Bearer <token>` header

📖 **Detailed auth mechanics:** See "API Authentication Types" section in [SECRETS_WORKAROUND.md](SECRETS_WORKAROUND.md)

---

## Using the App

### Web Interface

Open your app URL to access:

1. **Chat Playground** - Natural language API registration and queries
2. **API Registry** - View, edit, delete registered APIs
3. **Traces** - Debug AI agent execution
4. **MCP Info** - View available MCP tools

### Example Workflow

```
You: "Register the FRED economic data API with my API key: abc123"
AI: ✅ Successfully registered "fred" with API key authentication

You: "Get GDP data from FRED, series GDPC1"
AI: [Retrieves API key from secrets, makes request]
    Here's the GDP data from the last 10 observations...
```

---

## Configuration

### Environment Variables (`.env.local`)

Created automatically by `./setup.sh`:

```bash
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_TOKEN=your-personal-access-token  # For local dev
DATABRICKS_SQL_WAREHOUSE_ID=your-warehouse-id  # Optional

# Optional: Override default secret scope names
MCP_API_KEY_SCOPE=mcp_api_keys
MCP_BEARER_TOKEN_SCOPE=mcp_bearer_tokens
```

### Authentication

The app uses **On-Behalf-Of (OBO) authentication** by default:
- Users authenticate with Databricks OAuth
- All operations run with the user's permissions
- Proper access control and audit logging

📖 **OBO details:** See `app.yaml` configuration in the project root

---

## Development

### Local Development

```bash
# Start dev server with hot reload
./watch.sh

# Access at:
# - Frontend: http://localhost:5173
# - Backend: http://localhost:8000
# - API Docs: http://localhost:8000/docs
```

### Debugging

```bash
# Check app status
./app_status.sh

# Stream app logs
uv run python dba_logz.py https://your-app.databricksapps.com --duration 60

# Format code
./fix.sh
```

### Multiple Environments

Deploy separate instances for dev/staging/prod:

```bash
./deploy.sh --app-name mcp-dev-registry --create
./deploy.sh --app-name mcp-prod-registry --create
```

---

## Project Structure

```
├── server/                   # FastAPI backend
│   ├── app.py               # Main app + MCP server
│   ├── tools.py             # MCP tools implementation
│   └── routers/             # API endpoints
├── client/                  # React TypeScript frontend
│   └── src/pages/           # Chat, Registry, Traces pages
├── prompts/                 # Agent system prompts
├── setup_table.py           # DB table setup script
├── deploy.sh                # Deploy to Databricks Apps
├── setup.sh                 # Interactive setup
└── watch.sh                 # Local dev server
```

---

## Troubleshooting

**Authentication failures:**
- Run: `databricks current-user me` to verify CLI auth
- Check `.env.local` has correct `DATABRICKS_HOST`

**Table not found:**
- Run `setup_table.py` or manually create via SQL Editor

**Secret scope errors:**
```bash
# Verify scopes exist:
databricks secrets list-scopes | grep mcp_

# Verify service principal has access:
databricks secrets get-acl --scope mcp_api_keys --principal <service-principal-id>

# Check what secrets exist:
databricks secrets list-secrets --scope mcp_api_keys
```

**App not accessible:**
- Check deployment: `./app_status.sh`
- View logs: `https://your-app.databricksapps.com/logz`

**API calls failing after registration:**
- Verify secret exists: `databricks secrets list-secrets --scope mcp_api_keys`
- Check app logs for connection creation errors
- For API key auth: Ensure key is in `mcp_api_keys` scope
- For bearer token auth: Ensure token is in `mcp_bearer_tokens` scope

📖 **Detailed troubleshooting:**
- [WORKSPACE_REQUIREMENTS.md](WORKSPACE_REQUIREMENTS.md) - Workspace setup issues
- [SECRETS_WORKAROUND.md](SECRETS_WORKAROUND.md) - Secret scope issues

---

## Key Features

### MCP Tools Available

The app exposes these tools via its MCP server:

- `smart_register_api` - One-step API registration with auto-discovery
- `register_api_in_registry` - Manual API registration with full control
- `check_api_http_registry` - List and search registered APIs
- `discover_endpoints_from_docs` - Extract endpoints from documentation URLs
- `test_api_endpoint` - Validate endpoints before registration
- `execute_dbsql` - Run SQL queries against warehouses

### AI Agent Capabilities

The chat interface can:
- Parse API documentation to discover endpoints
- Test endpoints automatically
- Register APIs with proper authentication
- Call registered APIs to answer queries
- Combine multiple API calls for complex requests

---

## Documentation

- [WORKSPACE_REQUIREMENTS.md](WORKSPACE_REQUIREMENTS.md) - Prerequisites, setup, workspace configuration
- [SECRETS_WORKAROUND.md](SECRETS_WORKAROUND.md) - Secret management, auth types, troubleshooting
- [SECURITY.md](SECURITY.md) - Security policies
- [LICENSE.md](LICENSE.md) - License information

---

## License

See [LICENSE.md](LICENSE.md)

## Security

Report vulnerabilities: See [SECURITY.md](SECURITY.md)
