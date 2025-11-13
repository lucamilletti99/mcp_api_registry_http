# How Was This App Built? A Development Journey

## Overview

This document explains the **complete development journey** of the API Registry MCP Server - from concept to production. It's not just a feature list, but a story of how we built a production-ready Databricks app with MCP integration, authentication, and real-world API management capabilities.

**Target Audience:** Developers who want to understand how to build similar Databricks apps with MCP servers, or anyone curious about the evolution of this project.

---

## Table of Contents

1. [The Problem We Solved](#the-problem-we-solved)
2. [Architecture Decisions](#architecture-decisions)
3. [Development Phases](#development-phases)
4. [Key Technical Challenges](#key-technical-challenges)
5. [Lessons Learned](#lessons-learned)
6. [Building Your Own: A Guide](#building-your-own-a-guide)

---

## The Problem We Solved

### The Challenge

Organizations need to:
- **Discover and catalog** external APIs for use in data pipelines
- **Test API endpoints** before committing to integration
- **Securely store** API credentials without exposing them to end users
- **Call APIs dynamically** without hardcoding endpoints everywhere
- **Provide AI access** to external data sources through natural language

### The Solution

We built a **hybrid application** that combines:
- **Web UI** for interactive API discovery and management
- **MCP Server** for programmatic API access through AI agents
- **Unity Catalog** for secure credential storage
- **Databricks SQL** for metadata persistence and API execution

The result: Users can register an API once, then call it from anywhere - web UI, Python notebooks, or AI agents - with automatic authentication and centralized management.

---

## Architecture Decisions

### 1. FastAPI + React Architecture

**Why FastAPI?**
- Native async support for concurrent API calls
- Automatic OpenAPI spec generation (critical for MCP)
- Easy integration with FastMCP library
- Python ecosystem compatibility with Databricks SDK

**Why React + TypeScript?**
- Type-safe frontend development
- Auto-generated TypeScript client from OpenAPI spec
- Modern component architecture with shadcn/ui
- Fast development with Vite hot reloading

**Key Insight:** The OpenAPI spec becomes the "contract" between frontend, backend, and MCP server. Generate it once, use it everywhere.

---

### 2. Unity Catalog HTTP Connections

**The Big Decision:** How to store and use API credentials securely?

**Option A: Store credentials in database (❌)**
- Simple, but credentials are exposed in Delta tables
- No encryption at rest
- Violates security best practices

**Option B: Databricks Secrets + HTTP Connections (✅)**
- Credentials stored in encrypted secret scopes
- Unity Catalog HTTP Connections reference secrets
- Native Databricks authentication flow
- Audit logging built-in

**Implementation:**
```sql
-- Create connection with secret reference
CREATE CONNECTION github_api
TYPE HTTP
OPTIONS (
    host 'https://api.github.com',
    bearer_token secret('mcp_bearer_tokens', 'github')
)
```

**Key Insight:** Unity Catalog HTTP Connections act as "secure proxies" - users never see credentials, just connection names.

---

### 3. Dual-Mode Authentication

**Challenge:** Support both development and production authentication.

**Solution: On-Behalf-Of (OBO) + Service Principal Fallback**

```python
def get_workspace_client() -> WorkspaceClient:
    # Try user token first (for OBO authentication)
    user_token = get_http_headers().get('x-forwarded-access-token')

    if user_token:
        # Operations run as the user
        return WorkspaceClient(token=user_token, auth_type='pat')
    else:
        # Fallback to service principal (auto-configured in Databricks Apps)
        return WorkspaceClient(host=host)
```

**Why This Matters:**
- **In production:** Users authenticate with Databricks OAuth, operations run with their permissions
- **In development:** Service principal handles operations when user token unavailable
- **Security:** Proper audit trail of who did what

---

### 4. Two-Scope Secret Management

**The Evolution:**

**Initial Approach (Broken):**
- One secret scope per API: `fred_secrets`, `github_secrets`, etc.
- Problem: Creating scopes requires admin permissions
- Result: Users couldn't self-service register APIs

**Final Approach (Working):**
- Two shared scopes: `mcp_api_keys` and `mcp_bearer_tokens`
- Simple naming: Secret key = API name (e.g., `fred`, `github`)
- One-time admin setup, then users can register freely

```bash
# Setup once by admin
databricks secrets create-scope mcp_api_keys
databricks secrets create-scope mcp_bearer_tokens
databricks secrets put-acl mcp_api_keys <service-principal-id> WRITE
databricks secrets put-acl mcp_bearer_tokens <service-principal-id> WRITE
```

**Key Insight:** Optimize for user experience. Two scopes with admin setup beats 50 scopes with constant admin requests.

---

## Development Phases

### Phase 1: Foundation (Commits 1-10)

**Goal:** Get a working Databricks app with MCP server running.

**What We Built:**
1. **Basic FastAPI app** with health check endpoints
2. **MCP server integration** using FastMCP library
3. **Static React frontend** served from `/client/build`
4. **Combined ASGI app** that serves both HTTP and MCP

**Technical Milestone:**
```python
# server/app.py - The key insight
mcp_server = FastMCP(name='databricks-mcp')
mcp_asgi_app = mcp_server.http_app()

# FastAPI app
app = FastAPI(lifespan=mcp_asgi_app.lifespan)

# Combine routes
combined_app = FastAPI(
    routes=[
        *mcp_asgi_app.routes,  # MCP at /mcp
        *app.routes,           # API at /api
    ],
    lifespan=mcp_asgi_app.lifespan
)
```

**Key Learning:** MCP and regular HTTP can coexist. Use path routing (`/mcp` vs `/api`) to separate concerns.

---

### Phase 2: Authentication & Security (Commits 11-20)

**Goal:** Implement proper authentication and fix OAuth conflicts.

**Challenges We Faced:**

1. **OAuth/PAT Conflict:**
   ```python
   # Problem: WorkspaceClient auto-detects OAuth AND uses user token
   # This caused "multiple auth methods" errors

   # Solution: Force token-only auth
   config = Config(host=host, token=user_token, auth_type='pat')
   ```

2. **Missing User Token:**
   - MCP tools didn't receive `x-forwarded-access-token` header
   - Solution: Pass token through context variables
   ```python
   _user_token_context: ContextVar[str | None] = ContextVar('user_token', default=None)
   ```

3. **Warehouse Access:**
   - Some users couldn't list SQL warehouses
   - Solution: Fallback to service principal for warehouse operations
   ```python
   if has_warehouse_access:
       return user_client  # OBO
   else:
       return WorkspaceClient(host=host)  # Service principal
   ```

**Key Learning:** Authentication is never simple. Build fallback mechanisms and log extensively.

---

### Phase 3: API Registry Core (Commits 21-35)

**Goal:** Build the actual API registration and calling functionality.

**What We Built:**

1. **Delta Table for Metadata:**
```sql
CREATE TABLE api_http_registry (
    api_id STRING,
    api_name STRING,
    connection_name STRING,
    auth_type STRING,  -- 'none', 'api_key', 'bearer_token'
    secret_scope STRING,
    available_endpoints STRING,  -- JSON array of endpoints
    -- ...
)
```

2. **Three Authentication Types:**

**Type 1: Public APIs (no auth)**
```python
register_api(
    api_name="treasury_data",
    host="api.fiscaldata.treasury.gov",
    auth_type="none",
    # No secret_value needed
)
```

**Type 2: API Key (query parameter)**
```python
register_api(
    api_name="fred",
    host="api.stlouisfed.org",
    auth_type="api_key",
    secret_value="YOUR_KEY"
)

# Later, call with dynamic params
execute_api_call(
    api_name="fred",
    path="/series/GDPC1",
    params={"format": "json"}
)

# SQL adds api_key automatically:
# SELECT http_request(
#     params => map('api_key', secret('mcp_api_keys', 'fred'), 'format', 'json')
# )
```

**Type 3: Bearer Token (header)**
```python
register_api(
    api_name="github",
    host="api.github.com",
    auth_type="bearer_token",
    secret_value="ghp_TOKEN"
)

# Connection stores token reference
# CREATE CONNECTION github_connection
#     bearer_token secret('mcp_bearer_tokens', 'github')
```

**Key Learning:** Support multiple auth patterns. Each API ecosystem has its own conventions.

---

### Phase 4: Smart Registration & Discovery (Commits 36-50)

**Goal:** Make API registration intelligent - parse docs, test endpoints, suggest parameters.

**What We Built:**

1. **Documentation Fetcher:**
```python
def fetch_api_documentation(documentation_url: str) -> dict:
    # Fetch HTML
    response = requests.get(documentation_url)

    # Extract patterns
    found_urls = re.findall(r'https?://[^\s<>"\']+', content)
    found_paths = re.findall(r'/api/[^\s<>"\']+', content)
    found_params = extract_common_params(content)

    return {
        'found_urls': found_urls,
        'found_paths': found_paths,
        'found_params': found_params
    }
```

2. **Endpoint Discovery:**
```python
def discover_api_endpoint(endpoint_url: str, api_key: str = None):
    # Try without auth
    response = requests.get(endpoint_url)

    if response.status_code == 401:
        # Requires auth - try different patterns
        for pattern in ['api_key', 'apikey', 'Bearer']:
            # Test each auth method
            ...

    return {
        'is_accessible': True,
        'requires_auth': True,
        'auth_method': 'api_key',
        'sample_data': response.json()
    }
```

3. **Smart Registration Workflow:**
```
User: "Register the FRED API"
  ↓
fetch_api_documentation(fred_docs)
  ↓
Extract: base_path="/fred", params=[series_id, api_key]
  ↓
discover_api_endpoint(test_url)
  ↓
Validate: ✅ Works with api_key auth
  ↓
register_api(parsed_params)
  ↓
✅ API registered and ready to call
```

**Key Learning:** Users don't know API internals. Parse documentation, test automatically, provide smart defaults.

---

### Phase 5: Chat Interface & AI Agent (Commits 51-70)

**Goal:** Build a natural language interface powered by Databricks Foundation Models.

**What We Built:**

1. **Agent Chat Endpoint:**
```python
@router.post('/chat')
async def agent_chat(request: ChatRequest):
    # 1. Get user message
    messages = [{"role": "user", "content": request.message}]

    # 2. Call Databricks Foundation Model with MCP tools
    response = await agent.run(
        model="databricks-meta-llama-3-1-70b-instruct",
        messages=messages,
        tools=mcp_tools,  # MCP server tools available to AI
        max_turns=10
    )

    # 3. Execute tool calls if AI requests them
    for tool_call in response.tool_calls:
        result = await execute_mcp_tool(tool_call.name, tool_call.args)
        messages.append({"role": "tool", "content": result})

    return response
```

2. **MCP Tool Integration:**
The AI agent can call ANY MCP tool:
- `register_api()` - Register new APIs
- `execute_api_call()` - Call registered APIs
- `check_api_http_registry()` - List available APIs
- `execute_dbsql()` - Query the registry database

3. **Trace Visualization:**
```typescript
// Show AI reasoning
{traces.map(trace => (
    <TraceStep>
        <ThinkingBubble>{trace.thinking}</ThinkingBubble>
        <ToolCall>
            {trace.tool_name}({trace.tool_args})
        </ToolCall>
        <Result>{trace.result}</Result>
    </TraceStep>
))}
```

**Example Conversation:**
```
User: "Register the Treasury fiscal data API at api.fiscaldata.treasury.gov"

AI: I'll register the Treasury API for you.
    [Calls register_api() with auth_type="none"]
    ✅ Registered: treasury_fiscal_data

User: "Get the latest exchange rates"

AI: I'll call the Treasury API to get exchange rates.
    [Calls execute_api_call(api_name="treasury_fiscal_data", path="/v1/accounting/od/rates_of_exchange")]
    Here are the latest exchange rates: ...
```

**Key Learning:** MCP tools + AI agents = powerful combination. The AI figures out which tools to call and how to chain them.

---

### Phase 6: Error Handling & Production Hardening (Commits 71-90)

**Goal:** Make the app production-ready with proper error handling.

**What We Fixed:**

1. **401/403 Error Handling:**
```python
# Detect auth failures
if status_code == 401:
    return {
        'success': False,
        'error': '401 Unauthorized - Check your credentials',
        'hint': f'Verify secret exists: databricks secrets list --scope {secret_scope}'
    }
```

2. **404 Path Validation:**
```python
# Before calling, check available_endpoints
if api_path not in available_endpoints:
    return {
        'error': f'Path {api_path} not in available_endpoints',
        'available': available_endpoints,
        'hint': 'Use one of the documented paths'
    }
```

3. **Bearer Token Diagnostics:**
```python
# Debug secret issues
print(f"🔍 Attempting to retrieve secret:")
print(f"   Scope: {secret_scope}")
print(f"   Key: {secret_key}")

try:
    secrets = list(w.secrets.list_secrets(scope=secret_scope))
    print(f"   Available secrets: {[s.key for s in secrets]}")
except Exception as e:
    print(f"   ❌ Cannot list secrets: {e}")
```

4. **Connection Cleanup:**
```python
# Drop and recreate connections when auth type changes
def register_api(...):
    # Drop existing connection
    drop_sql = f"DROP CONNECTION IF EXISTS {connection_name}"
    w.statement_execution.execute_statement(drop_sql)

    # Create fresh connection with new auth
    create_sql = _create_http_connection_sql(...)
    w.statement_execution.execute_statement(create_sql)
```

**Key Learning:** Production apps need extensive error handling. Log everything, provide helpful hints, anticipate failure modes.

---

### Phase 7: Frontend Polish & UX (Commits 91-110)

**Goal:** Create an intuitive, beautiful user interface.

**What We Built:**

1. **Multi-Page Layout:**
```
┌─────────────────────────────────────┐
│  [Chat] [Registry] [Traces] [MCP]  │  ← Tab navigation
├─────────────────────────────────────┤
│                                     │
│  Chat Playground                    │  ← Active page
│  "Register the GitHub API..."       │
│                                     │
│  AI: ✅ Registered successfully!    │
│                                     │
└─────────────────────────────────────┘
```

2. **Dark/Light Theme:**
```typescript
// System-aware theming
const theme = useTheme()
<div className={theme === 'dark' ? 'bg-gray-900' : 'bg-white'}>
```

3. **Registry Table with Actions:**
```typescript
<Table>
  {apis.map(api => (
    <TableRow>
      <TableCell>{api.api_name}</TableCell>
      <TableCell>{api.auth_type}</TableCell>
      <TableCell>
        <Button onClick={() => callApi(api)}>Test</Button>
        <Button onClick={() => editApi(api)}>Edit</Button>
        <Button onClick={() => deleteApi(api)}>Delete</Button>
      </TableCell>
    </TableRow>
  ))}
</Table>
```

4. **Trace Visualization:**
Shows AI's step-by-step reasoning:
```
1. 🤔 User wants to register GitHub API
2. 🔍 Checking if API already exists...
3. 🛠️  Calling register_api(api_name="github", ...)
4. ✅ Registration successful!
5. 💬 Informing user about next steps
```

**Key Learning:** Good UX makes or breaks adoption. Invest in polish - it's worth it.

---

## Key Technical Challenges

### Challenge 1: MCP + FastAPI Integration

**Problem:** MCP servers and FastAPI both want to control the ASGI app lifecycle.

**Solution:** Use FastMCP's HTTP mode and combine route lists:
```python
mcp_asgi_app = mcp_server.http_app()  # MCP's ASGI app

combined_app = FastAPI(
    routes=[*mcp_asgi_app.routes, *app.routes],
    lifespan=mcp_asgi_app.lifespan  # Use MCP's lifespan
)
```

**Why This Works:** Both apps are just ASGI apps. Combine their routes into a single FastAPI instance.

---

### Challenge 2: Secret Scope Permissions

**Problem:** Apps don't have permissions to create secret scopes.

**Evolution:**

**Attempt 1: Create scope per API (❌)**
```python
# This fails - apps can't create scopes
w.secrets.create_scope(f"{api_name}_secrets")
```

**Attempt 2: Ask user to create scopes (❌)**
- Bad UX, too much friction

**Final Solution: Two shared scopes with admin setup (✅)**
```bash
# One-time setup by admin
./setup_shared_secrets.sh
```

**Key Insight:** Optimize for the common case. Most users register multiple APIs - make that flow frictionless.

---

### Challenge 3: Dynamic Path Routing

**Problem:** APIs have complex path structures. How to split host, base_path, and dynamic paths?

**Examples:**
```
GitHub API:
  host: api.github.com
  base_path: (empty)
  paths: /repos/owner/repo, /user/repos, /orgs/databricks

FRED API:
  host: api.stlouisfed.org
  base_path: /fred
  paths: /series/observations, /series/search, /releases

Treasury API:
  host: api.fiscaldata.treasury.gov
  base_path: /services/api/fiscal_service/v1
  paths: /accounting/od/rates_of_exchange
```

**Solution: Base path in connection, dynamic path in call:**
```sql
-- Connection has base_path
CREATE CONNECTION fred_connection
OPTIONS (
    host 'https://api.stlouisfed.org',
    base_path '/fred'  -- Common prefix
)

-- Dynamic path in call
SELECT http_request(
    conn => 'fred_connection',
    path => '/series/observations'  -- Just the endpoint-specific part
)
-- Actual request: https://api.stlouisfed.org/fred/series/observations
```

**Key Insight:** Register base structure once, call dynamically later. Don't pre-register every endpoint.

---

### Challenge 4: Credential Context for AI

**Problem:** AI agent needs to pass credentials without exposing them in messages.

**Bad Approach (❌):**
```python
# AI sees credentials in messages
messages = [{
    "role": "user",
    "content": "Register API with key: sk_1234567890abcdef"
}]
```

**Good Approach (✅):**
```python
# Store credentials in context variable
_credentials_context.set({
    "api_key": "sk_1234567890abcdef",
    "bearer_token": "ghp_token123"
})

# AI just passes API name
register_api(
    api_name="github",
    auth_type="bearer_token"
    # No secret_value parameter needed!
)

# Tool retrieves from context
def register_api(...):
    creds = _credentials_context.get()
    secret_value = creds.get("bearer_token")
```

**Key Insight:** Separate credential flow from AI reasoning. Use context variables, not message content.

---

## Lessons Learned

### 1. Start with Databricks App Template

**What We Did:**
- Used official Databricks app template as foundation
- Got FastAPI + React + deployment scripts for free
- Focused on business logic, not boilerplate

**Recommendation:** Always start with a template. Don't reinvent authentication, deployment, or project structure.

---

### 2. MCP Tools Are Your API

**What We Learned:**
The MCP tools define your app's capabilities. Everything else (UI, CLI, notebooks) is just a different interface to those tools.

**Design Pattern:**
```
Core Logic (MCP Tools)
    ↓
    ├─→ Web UI (React)
    ├─→ AI Agent (Databricks FM)
    ├─→ Python Client (dba_client.py)
    └─→ Direct HTTP (curl /mcp)
```

**Recommendation:** Design your MCP tools first. Make them composable. Build UIs later.

---

### 3. Error Messages Are Documentation

**Bad Error:**
```
Error: Failed to store secret
```

**Good Error:**
```
Error: Failed to store secret in scope 'mcp_api_keys'

The app's service principal doesn't have WRITE permission.

Fix:
1. Get your service principal ID: ./app_status.sh
2. Run: databricks secrets put-acl mcp_api_keys <SPN_ID> WRITE
3. Redeploy: ./deploy.sh

Or run the setup script: ./setup_shared_secrets.sh
```

**Recommendation:** Every error should tell users exactly how to fix it. Include commands they can copy-paste.

---

### 4. Secrets Are Hard

**What We Learned:**
- Secret management is always more complex than expected
- Permissions, scopes, and access patterns matter
- Users will have permission issues - plan for it

**Recommendation:**
- Minimize secret scope proliferation (use shared scopes)
- Provide clear setup scripts with verification steps
- Log extensively during secret operations

---

### 5. Documentation Parsing Is Messy

**What We Learned:**
API documentation has no standard format:
- Some use OpenAPI/Swagger
- Some use custom HTML
- Some have no structured docs at all

**Our Approach:**
```python
# Extract common patterns with regex
found_urls = re.findall(r'https?://[^\s<>"\']+', content)
found_paths = re.findall(r'/api/[^\s<>"\']+', content)

# Provide to AI to interpret
return {
    'found_urls': found_urls,
    'found_paths': found_paths,
    'content_preview': content[:1000],
    'hint': 'Analyze these patterns to determine base_path'
}
```

**Recommendation:** Don't try to perfectly parse docs. Extract patterns, let AI interpret them, provide smart defaults.

---

## Building Your Own: A Guide

### Step 1: Start with Template

```bash
# Get Databricks app template
git clone https://github.com/databricks/databricks-app-template
cd databricks-app-template
./setup.sh
```

### Step 2: Add MCP Server

```python
# server/app.py
from fastmcp import FastMCP

# Create MCP server
mcp_server = FastMCP(name='my-server')

@mcp_server.tool
def my_tool(param: str) -> dict:
    return {"result": f"You said: {param}"}

# Create ASGI apps
mcp_asgi_app = mcp_server.http_app()
app = FastAPI()

# Combine
combined_app = FastAPI(
    routes=[*mcp_asgi_app.routes, *app.routes],
    lifespan=mcp_asgi_app.lifespan
)
```

### Step 3: Add Authentication

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.core import Config
from fastmcp.server.dependencies import get_http_headers

def get_workspace_client() -> WorkspaceClient:
    headers = get_http_headers()
    user_token = headers.get('x-forwarded-access-token')

    if user_token:
        config = Config(
            host=os.environ.get('DATABRICKS_HOST'),
            token=user_token,
            auth_type='pat'
        )
        return WorkspaceClient(config=config)
    else:
        return WorkspaceClient(host=os.environ.get('DATABRICKS_HOST'))
```

### Step 4: Add Database Operations

```python
@mcp_server.tool
def query_data(query: str) -> dict:
    w = get_workspace_client()
    warehouse_id = os.environ.get('DATABRICKS_SQL_WAREHOUSE_ID')

    result = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=query,
        wait_timeout='30s'
    )

    # Process results
    rows = []
    for row in result.result.data_array:
        rows.append(row)

    return {'rows': rows}
```

### Step 5: Add Secret Management

```python
@mcp_server.tool
def register_api(api_name: str, api_key: str) -> dict:
    w = get_workspace_client()

    # Store secret
    scope_name = 'my_secrets'
    w.secrets.put_secret(
        scope=scope_name,
        key=api_name,
        string_value=api_key
    )

    # Create UC HTTP connection
    sql = f"""
    CREATE CONNECTION {api_name}_connection
    TYPE HTTP
    OPTIONS (
        host 'https://api.example.com',
        bearer_token secret('{scope_name}', '{api_name}')
    )
    """
    w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=sql
    )

    return {'success': True}
```

### Step 6: Build Frontend

```typescript
// client/src/pages/ChatPage.tsx
export function ChatPage() {
    const [message, setMessage] = useState('')
    const [response, setResponse] = useState('')

    const handleSend = async () => {
        const res = await fetch('/api/agent/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message})
        })
        const data = await res.json()
        setResponse(data.content)
    }

    return (
        <div>
            <input value={message} onChange={e => setMessage(e.target.value)} />
            <button onClick={handleSend}>Send</button>
            <div>{response}</div>
        </div>
    )
}
```

### Step 7: Deploy

```bash
./deploy.sh --create
```

---

## Conclusion

Building this app taught us:

1. **MCP + Databricks is powerful** - Combining AI agents with secure data infrastructure unlocks new possibilities
2. **Security is complex** - Plan for secret management, permissions, and authentication from day one
3. **UX matters** - A good UI makes powerful tools accessible
4. **Error handling is documentation** - Every error should teach users how to fix it
5. **Templates accelerate development** - Start with proven patterns, customize from there

The result is a production-ready application that demonstrates best practices for:
- MCP server integration
- Databricks authentication (OBO + service principal)
- Unity Catalog secret management
- AI agent orchestration
- Full-stack TypeScript/Python development

**Want to build something similar?** Follow the steps in "Building Your Own: A Guide" above, and refer to this project's code for detailed examples.

---

## Next Steps & Future Enhancements

### Potential Additions

1. **API Versioning** - Track multiple versions of the same API
2. **Usage Metrics** - Monitor which APIs are called most frequently
3. **Rate Limiting** - Respect API rate limits and implement backoff
4. **Batch Operations** - Register multiple APIs from a CSV or JSON
5. **OpenAPI Import** - Automatically import from Swagger/OpenAPI specs
6. **Testing Framework** - Automated testing of registered APIs
7. **Webhook Support** - Register webhook callbacks for real-time events

### How to Contribute

This is an open-source template. To extend it:

1. Fork the repository
2. Add your feature following existing patterns
3. Update documentation
4. Submit a pull request

**Key Files to Modify:**
- `server/tools.py` - Add new MCP tools
- `server/routers/` - Add new API endpoints
- `client/src/pages/` - Add new UI pages
- `prompts/` - Add new MCP prompts for AI agents

---

## Resources

- **Databricks Apps Documentation:** https://docs.databricks.com/en/dev-tools/databricks-apps/
- **MCP Protocol:** https://modelcontextprotocol.io/
- **FastMCP Library:** https://github.com/jlowin/fastmcp
- **Unity Catalog HTTP Connections:** https://docs.databricks.com/sql/language-manual/sql-ref-syntax-ddl-create-connection.html
- **Databricks SDK Python:** https://docs.databricks.com/dev-tools/sdk-python.html

---

*Built with ❤️ using Databricks Apps, FastAPI, React, and MCP*
