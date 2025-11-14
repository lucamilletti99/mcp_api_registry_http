# How Was This App Built?

A development journey from concept to production for the API Registry MCP Server.

**For:** Developers building similar Databricks apps with MCP integration
**Focus:** Real decisions, challenges, and solutions - not just features

---

## The Problem

Organizations need to:
- Discover and test external APIs before integration
- Securely store API credentials without exposing them
- Call APIs dynamically without hardcoding endpoints
- Provide AI agents access to external data

**Solution:** A hybrid app with web UI, MCP server, Unity Catalog security, and AI agent integration.

---

## Key Architecture Decisions

### 1. Hybrid MCP Architecture

**Traditional MCP:** Host → MCP Client → MCP Server (separate processes, SSE/stdio protocol)

**Our Approach:** Hybrid architecture with two execution paths:
- **Internal:** Agent loop → Direct Python calls → MCP tools (in-process, fast)
- **External:** MCP clients → `/mcp` endpoint → MCP tools (standard protocol)

```python
# Internal execution (agent_chat.py)
from server.app import mcp_server
result = await mcp_server._tool_manager.call_tool(tool_name, args)  # Direct call

# External exposure (app.py)
mcp_asgi_app = mcp_server.http_app()  # Standard MCP at /mcp
combined_app = FastAPI(routes=[*mcp_asgi_app.routes, *app.routes])
```

**Why this works:**
- No MCP Client needed internally → Lower latency, simpler code
- Standard MCP Server exposed → External tools (Claude CLI) can connect
- Shared tool registry → Same tools for both paths

### 2. FastAPI + React Integration

**Why FastAPI?**
- Automatic OpenAPI spec → becomes the contract between frontend, backend, and MCP
- Native async support for concurrent operations
- Easy FastMCP integration

---

### 3. Unity Catalog HTTP Connections for Security

**The Choice:**
- ❌ Store credentials in database → No encryption, security risk
- ✅ Databricks Secrets + HTTP Connections → Encrypted, audited, native

**Implementation:**
```sql
CREATE CONNECTION github_api TYPE HTTP
OPTIONS (
    host 'https://api.github.com',
    bearer_token secret('mcp_bearer_tokens', 'github')
)
```

Users never see credentials, just connection names.

---

### 4. Two-Scope Secret Management

**The Evolution:**

**Initial (Broken):** One scope per API → Required admin for every registration
**Final (Working):** Two shared scopes → One-time admin setup

```bash
mcp_api_keys/          # For API key auth
  ├── fred
  └── alpha_vantage

mcp_bearer_tokens/     # For bearer token auth
  ├── github
  └── stripe
```

**Key Insight:** Optimize for the common case - users register multiple APIs, make that frictionless.

---

### 5. On-Behalf-Of Authentication

```python
def get_workspace_client() -> WorkspaceClient:
    user_token = get_http_headers().get('x-forwarded-access-token')

    if user_token:
        # Operations run as the user (with their permissions)
        return WorkspaceClient(token=user_token, auth_type='pat')
    else:
        # Fallback to service principal
        return WorkspaceClient(host=host)
```

**Why:** Proper audit trail + automatic permission management.

---

## Development Journey

### Phase 1: Foundation
- Basic FastAPI app with MCP server
- Combined ASGI app serving both HTTP and MCP
- Static React frontend

### Phase 2: Authentication
**Challenges:**
- OAuth/PAT conflict → Solution: Force `auth_type='pat'`
- Missing user token → Solution: Context variables
- Warehouse access → Solution: Service principal fallback

### Phase 3: API Registry Core
Built three authentication types:

**Public APIs:**
```python
register_api(api_name="treasury", auth_type="none")
```

**API Key (query param):**
```python
register_api(api_name="fred", auth_type="api_key", secret_value="KEY")
# Later: execute_api_call adds api_key automatically
```

**Bearer Token (header):**
```python
register_api(api_name="github", auth_type="bearer_token", secret_value="TOKEN")
# Connection stores token reference automatically
```

### Phase 4: Smart Discovery
- Documentation parser (regex patterns for URLs/paths/params)
- Endpoint discovery (test auth methods automatically)
- Smart registration workflow

### Phase 5: AI Agent Integration
```python
# Agent can call ANY MCP tool
response = await agent.run(
    model="databricks-meta-llama-3-1-70b-instruct",
    messages=messages,
    tools=mcp_tools  # register_api, execute_api_call, etc.
)
```

### Phase 6: Production Hardening
- 401/403/404 error handling with helpful hints
- Bearer token diagnostics
- Connection cleanup on auth type changes
- Extensive debug logging

### Phase 7: UI Polish
- Multi-page layout with tab navigation
- Dark/light theme
- Registry table with test/edit/delete actions
- AI trace visualization

---

## Key Technical Challenges

### Challenge: Secret Scope Permissions
**Problem:** Apps can't create secret scopes
**Solution:** Two shared scopes with one-time admin setup via `./setup_shared_secrets.sh`

### Challenge: Dynamic Path Routing
**Problem:** APIs have complex path structures (host + base_path + dynamic paths)
**Solution:** Store base_path in connection, pass dynamic path at call time

```sql
-- Connection
CREATE CONNECTION fred_connection
OPTIONS (host 'https://api.stlouisfed.org', base_path '/fred')

-- Call
SELECT http_request(conn => 'fred_connection', path => '/series/observations')
-- Result: https://api.stlouisfed.org/fred/series/observations
```

### Challenge: Credential Context for AI
**Problem:** AI shouldn't see credentials in messages
**Solution:** Context variables

```python
# Store separately
_credentials_context.set({"bearer_token": "TOKEN"})

# AI just passes API name
register_api(api_name="github", auth_type="bearer_token")

# Tool retrieves from context
creds = _credentials_context.get()
secret_value = creds.get("bearer_token")
```

---

## Lessons Learned

1. **Start with templates** - Don't reinvent authentication and deployment
2. **MCP tools are your API** - Everything else is just a different interface
3. **Error messages are documentation** - Include copy-paste commands to fix issues
4. **Secrets are hard** - Minimize scope proliferation, log extensively
5. **Documentation parsing is messy** - Extract patterns, let AI interpret

---

## Building Your Own

### Quick Start

```bash
# 1. Get template
git clone https://github.com/databricks/databricks-app-template
./setup.sh

# 2. Add MCP server
from fastmcp import FastMCP
mcp_server = FastMCP(name='my-server')

@mcp_server.tool
def my_tool(param: str) -> dict:
    return {"result": f"You said: {param}"}

# 3. Combine with FastAPI
combined_app = FastAPI(
    routes=[*mcp_server.http_app().routes, *app.routes],
    lifespan=mcp_server.http_app().lifespan
)

# 4. Deploy
./deploy.sh --create
```

### Core Pattern: SQL-Based API Calls

```python
# Register once
register_api(
    api_name="github",
    host="api.github.com",
    auth_type="bearer_token",
    secret_value="ghp_TOKEN"
)

# Call dynamically
execute_api_call(
    api_name="github",
    path="/repos/databricks/mlflow",  # Any path!
    params={"type": "public"}
)

# SQL execution
SELECT http_request(
    conn => 'github_connection',
    path => '/repos/databricks/mlflow',
    params => map('type', 'public')
)
```

---

## Project Structure

```
server/
  ├── app.py              # FastAPI + MCP combined
  ├── tools.py            # MCP tools (register_api, execute_api_call, etc.)
  └── routers/            # API endpoints
client/
  └── src/pages/          # React pages (Chat, Registry, Traces)
prompts/                  # Agent system prompts
debug_utils/              # Troubleshooting scripts
setup_table.py            # Create Delta table
deploy.sh                 # Deploy to Databricks Apps
```

---

## Resources

- [Databricks Apps Docs](https://docs.databricks.com/en/dev-tools/databricks-apps/)
- [MCP Protocol](https://modelcontextprotocol.io/)
- [FastMCP](https://github.com/jlowin/fastmcp)
- [Unity Catalog HTTP Connections](https://docs.databricks.com/sql/language-manual/sql-ref-syntax-ddl-create-connection.html)

---

*Built with Databricks Apps, FastAPI, React, and MCP*
