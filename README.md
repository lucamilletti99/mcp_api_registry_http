# 🔌 API Registry MCP Server

A Databricks app that helps you discover, register, and manage external API endpoints with an AI-powered chat interface.

## What is this?

An API discovery and management platform that runs on Databricks Apps:

- **🤖 AI Chat Interface**: Register APIs using natural language powered by Claude
- **📊 API Registry**: Database-backed catalog of external API endpoints
- **🔐 Secure Auth**: Support for public APIs, API keys, and bearer tokens
- **🛠️ MCP Server**: Programmatic API management tools
- **📚 Smart Discovery**: Automatic endpoint testing and documentation parsing

**Architecture:** This app uses a hybrid MCP design - the internal AI agent calls MCP tools directly via Python (fast, in-process) while also exposing a standard MCP server at `/mcp` for external clients like Claude CLI. Both paths share the same tool registry, giving you flexibility in how you interact with the API registry.

---

## Quick Start

### Prerequisites

#### Required Tools (Install on your local machine)

**1. Python Package Manager - uv:**
```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Or with Homebrew
brew install uv

# Verify installation
uv --version
```
[uv documentation](https://docs.astral.sh/uv/)

**2. Databricks CLI:**
```bash
# With pip
pip install databricks-cli

# Or with Homebrew
brew tap databricks/tap
brew install databricks

# Verify installation  
databricks --version  # Should be v0.260.0+
```
[Databricks CLI documentation](https://docs.databricks.com/en/dev-tools/cli/index.html)

**3. Bun (Optional - only for frontend development):**
```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Or with Homebrew
brew install oven-sh/bun/bun
```
[Bun documentation](https://bun.sh/docs)

#### Databricks Workspace Requirements

Your workspace needs:
- **Databricks Apps** enabled (Public Preview)
- **Foundation Model API** with a tool-enabled model (Claude, Llama, etc.)
- **SQL Warehouse** - At least one warehouse ([create one](https://docs.databricks.com/en/compute/sql-warehouse/create.html))
- **Unity Catalog** - With a catalog and schema you can write to

📖 **Detailed requirements:** [WORKSPACE_REQUIREMENTS.md](WORKSPACE_REQUIREMENTS.md)

---

### Step 1: Clone and Setup

Run this on your **local machine** (not in Databricks):

```bash
git clone https://github.com/lucamilletti99/mcp_api_registry_http.git
cd mcp_api_registry_http
./setup.sh
```

**The setup script will prompt you for:**

| Prompt | What It's For | Default | Notes |
|--------|---------------|---------|-------|
| **Databricks Host** | Your workspace URL | (no default) | Format: `https://your-workspace.cloud.databricks.com` |
| **Authentication Method** | How to authenticate | `2` (PAT - **Recommended**) | Options: 1=OAuth, 2=PAT |
| **Personal Access Token** | Your Databricks PAT | (no default) | Required for PAT auth. [Get your PAT here](https://docs.databricks.com/en/dev-tools/auth/pat.html) |
| **SQL Warehouse ID** | Warehouse for queries | Auto-detects first warehouse | Press Enter to use default |
| **Unity Catalog** | Target catalog | `main` | Press Enter to use default |
| **Unity Schema** | Target schema | `default` | Press Enter to use default |

**⚠️ Important: Use Personal Access Token (PAT) authentication**
- PAT is the recommended method for local development
- OAuth is experimental and may have issues
- Get your PAT: Workspace → Settings → Developer → Access Tokens → Generate New Token
- [Full PAT documentation](https://docs.databricks.com/en/dev-tools/auth/pat.html)

**What this does:**
- Installs Python and JavaScript dependencies
- Configures Databricks CLI authentication  
- Creates `.env.local` with your configuration
- Validates your workspace connection

---

### Step 2: Create the API Registry Table

Create the Delta table that stores API metadata:

```bash
uv run python setup_table.py your_catalog your_schema
```

**Example:**
```bash
# Using the defaults from Step 1
uv run python setup_table.py main default
```

**What this does:**
- Creates `api_http_registry` table in your specified catalog.schema
- Table stores: API name, endpoints, auth type, HTTP connection details, parameters
- Required for the app to track registered APIs

**Alternative - Manual SQL:**
Run the SQL from `setup_api_http_registry_table.sql` in Databricks SQL Editor

**Note:** Ensure your catalog and schema exist first. Create them in Databricks SQL Editor if needed.

---

### Step 3: Deploy to Databricks Apps

Deploy your application code to Databricks:

```bash
# First time deployment (creates the app)
./deploy.sh --create

# Future updates (after code changes)
./deploy.sh
```

**During deployment, you'll be prompted for:**
- **App name**: Must start with `mcp-` (e.g., `mcp-api-registry`, `mcp-prod-api`)

**What happens during deployment:**

1. ✅ **Builds the frontend** - Compiles React TypeScript to static assets
2. ✅ **Packages the backend** - Prepares FastAPI server and MCP tools  
3. ✅ **Creates Databricks App** - Registers your app in the workspace
4. ✅ **Generates Service Principal** - Automatically creates a service principal for your app
5. ✅ **Deploys code to the app** - Uploads your code and automatically attaches it to the app compute
6. ✅ **Starts the application** - Your app is now running and accessible
7. ✅ **Enables OAuth (OBO)** - Configures On-Behalf-Of authentication automatically

**⚠️ Important: No manual attachment needed!**
The `deploy.sh` script handles the entire deployment pipeline. Your code is automatically:
- Packaged into a deployable artifact
- Uploaded to Databricks
- Attached to the app's compute environment  
- Started and made accessible at the app URL

You don't need to manually connect code to compute - it's all handled by the deployment process!

**Finding your deployed app:**

```bash
# Get app URL and status
./app_status.sh

# Expected output:
# App: mcp-api-registry
# Status: RUNNING  
# URL: https://adb-123456.10.azuredatabricks.net//apps/mcp-api-registry
# Service Principal ID: 00000000-0000-0000-0000-000000000000
```

**Or in Databricks UI:**
- Workspace → Compute → Apps → Click your app name

**🔐 On-Behalf-Of (OBO) Authentication:**

Databricks Apps automatically handles OAuth authentication:
- ✅ Users log in through Databricks UI - no separate auth setup
- ✅ All operations run with the user's permissions - proper access control
- ✅ Full audit logging - track who did what
- ✅ No manual OAuth configuration needed!

The app configuration (`app.yaml`) specifies required scopes. When users access the app, they automatically get an OAuth token with their Databricks permissions.

📖 **More details:** See `app.yaml` in the project root

---

### Step 4: Setup Secret Scopes (For Authenticated APIs)

**⚠️ Important: Do this AFTER Step 3** - You need the Service Principal ID from deployment first!

**Skip if you only use public APIs with no authentication.**

For APIs requiring API keys or bearer tokens:

```bash
./setup_shared_secrets.sh
```

**When prompted, enter your app's Service Principal ID from Step 3.**

**Where to find your Service Principal ID:**

1. **From terminal:** Run `./app_status.sh` (shown in output)
2. **From UI:** Databricks workspace → Compute → Apps → Click your app → "Service Principal ID"
3. **Format:** Looks like `00000000-0000-0000-0000-000000000000`

**What this script does:**

1. Creates `mcp_api_keys` scope - for API key authentication
2. Creates `mcp_bearer_tokens` scope - for bearer token authentication  
3. Grants your app's service principal **WRITE** access to both scopes
4. Verifies the permissions were set correctly

**Why this is needed:**

- API keys and bearer tokens must be stored securely
- Databricks Secrets provide encryption at rest
- The app's service principal manages secrets on behalf of all users
- Users never see or handle raw credentials - they're encrypted automatically

**Verification:**

```bash
# Check both scopes exist
databricks secrets list-scopes | grep mcp_

# Check service principal has WRITE access
databricks secrets get-acl mcp_api_keys --principal YOUR_SPN_ID
databricks secrets get-acl mcp_bearer_tokens --principal YOUR_SPN_ID

# Expected output: permission: WRITE
```

**Troubleshooting:**
- If scope creation fails: You may need admin permissions
- If permission grant fails: Your SPN ID may be incorrect (check `./app_status.sh`)

📖 **Detailed guide:** [SECRETS_WORKAROUND.md](SECRETS_WORKAROUND.md)

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

### Deployment Issues - App Created But Code Not Working

If `./deploy.sh` completes successfully but your app doesn't work properly, follow these steps:

**1. Check App Logs (MOST IMPORTANT):**
```bash
# View live logs
databricks apps logs <your-app-name> --follow

# Or visit in browser (requires OAuth):
# https://your-app.databricksapps.com/logz
```

**2. Verify App Status:**
```bash
./app_status.sh
# Should show: Status: RUNNING
# If status is FAILED or ERROR, check logs above
```

**3. Common Causes & Fixes:**

| Issue | Check | Fix |
|-------|-------|-----|
| **Frontend build failed** | `cd client && npm run build` | Fix TypeScript errors, ensure `client/node_modules` exists |
| **Missing Python dependencies** | `cat requirements.txt` | Run `uv run python scripts/generate_semver_requirements.py` |
| **app.yaml misconfigured** | `cat app.yaml` | Verify `command` and `scopes` are correct |
| **Code not uploaded** | `databricks workspace ls /Workspace/Users/your.email@company.com/` | Check if source path exists, redeploy with `--verbose` |
| **App won't start** | Check app logs | Look for Python import errors, missing env vars, port conflicts |

**4. Redeploy with Verbose Output:**
```bash
./deploy.sh --verbose
# Shows detailed build and deployment steps
```

**5. Manual Verification:**
```bash
# Check app exists and get details
databricks apps get <your-app-name>

# Verify service principal was created
databricks apps get <your-app-name> --output json | grep service_principal_id

# Try restarting
databricks apps restart <your-app-name>

# Last resort: Delete and recreate
databricks apps delete <your-app-name>
./deploy.sh --create
```

---

### Authentication failures:
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
