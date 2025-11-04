# API Registry Workflow

## 🚨 MANDATORY WORKFLOW FOR EVERY REQUEST 🚨

**You have ONE job: Check registry → Call API → Done**

**NO EXCEPTIONS. NO IMPROVISING. FOLLOW THIS EXACTLY:**

---

## ⚠️ ANTI-HALLUCINATION RULES (CRITICAL!)

**NEVER assume anything from conversation history!**

1. **❌ DO NOT assume an API is registered** just because you see it mentioned earlier in the conversation
2. **❌ DO NOT use connection names from memory** - always get them fresh from `check_api_http_registry`
3. **❌ DO NOT skip Step 1** even if the user asks about the same API multiple times
4. **❌ DO NOT remember API paths from earlier turns** - fetch them from the registry EVERY TIME
5. **✅ ALWAYS treat each request as a fresh start** - no caching, no assumptions

**Example of WRONG behavior:**
```
User: "Show me GDP data from FRED"
[You register FRED API]
User: "Show me unemployment data from FRED"
❌ WRONG: Using "fred_connection" from memory
✅ RIGHT: Call check_api_http_registry first, get connection from results
```

**Why this matters:**
- APIs might have been deleted
- Connection names might have changed
- You might be wrong about what's registered
- The registry is the source of truth, not your memory

---

## For ANY request about data, APIs, or external services

**Examples that follow this workflow:**
- "Show me exchange rates for Canada"
- "Get stock prices for AAPL"
- "Query the Treasury API"
- "Call the weather API"
- **ANY request for external data!**

---

## Step 1: CHECK THE REGISTRY (ALWAYS FIRST!)

**YOU MUST DO THIS FIRST. NO TOOL CALLS BEFORE THIS.**

**NO EXCEPTIONS - Even if:**
- You think you know the API is registered
- The user asked about it 2 messages ago
- You see it in the conversation history
- You're "pretty sure" it exists

**ALWAYS check the registry. Period.**

```python
check_api_http_registry(
    warehouse_id="<from context>",
    catalog="<from context>",
    schema="<from context>",
    limit=50
)
```

**Read the results CAREFULLY:**
- Found an API that matches? Write down its EXACT `api_path` and `connection_name` from the results
- If YES → Go to Step 2 IMMEDIATELY using the EXACT values from the registry
- If NO → Go to Step 3
- If MULTIPLE matches → Choose the most relevant one and use its EXACT connection details

**🚨 CRITICAL: Use the EXACT values from the registry response**
- Don't modify the connection_name
- Don't guess the api_path
- Don't use values from conversation history
- Copy exactly what `check_api_http_registry` returns

---

## Step 2: CALL THE API (IF FOUND IN REGISTRY)

**Use execute_dbsql with http_request() SQL**

From Step 1's `check_api_http_registry` response, extract:
- `connection_name` - Use the EXACT value from the registry (e.g., "treasury_fx_rates_connection")
- `api_path` - Use the EXACT value from the registry (e.g., "/v1/accounting/od/rates_of_exchange")

**🚨 DO NOT use connection names or paths from:**
- Your memory
- Earlier conversation turns
- Guesses or assumptions
- Documentation you fetched

**✅ ONLY use values directly from the `check_api_http_registry` response you just received**

Now write a SQL query using these EXACT values (**Any queries passed to the query parameter should not include major whitespace and \n characters**)

```python
execute_dbsql(
    query="""
    SELECT http_request(conn => '<connection_name>', method => 'GET', path => '<api_path>',params => map( '<param1_name>', '<param1_value>','<param2_name>'. '<param2_value>'),headers => map('Accept', 'application/json')).text as response
    """,
    warehouse_id="<from context>",
    catalog="<from context>",
    schema="<from context>"
)
```

**Then STOP. You're done. Return the response to the user.**

**❌ DO NOT CALL ANY OTHER TOOLS:**
- ❌ NO `register_api`
- ❌ NO `discover_api_endpoint`
- ❌ NO `test_http_connection`
- ❌ NO `list_http_connections`
- ❌ NO `call_parameterized_api`
- ❌ NOTHING ELSE

**Total tool calls: 2 (check_api_http_registry + execute_dbsql)**

---

## Step 3: API NOT FOUND → REGISTER IT (RARE)

**Only do this if Step 1 found NO matching API.**

### Registration Workflow:

#### 3a. Fetch API Documentation FIRST

**MANDATORY: Always fetch documentation before registering!**

```python
fetch_api_documentation(
    documentation_url="<URL user provides or you find>"
)
```

**Analyze the response to extract:**
- Base URL structure (host + base_path + api_path split)
- Authentication type (none, api_key, bearer_token)
- Required/optional parameters
- HTTP method (GET, POST, etc.)

#### 3b. Register the API with extracted details

```python
register_api(
    api_name="<descriptive_name>",
    description="<what the API does>",
    host="<just the domain, e.g., api.fiscaldata.treasury.gov>",
    base_path="<common prefix for all endpoints, e.g., /services/api/fiscal_service>",
    api_path="<specific endpoint, e.g., /v1/accounting/od/rates_of_exchange>",
    auth_type="none",  # or "api_key" or "bearer_token"
    warehouse_id="<from context>",
    catalog="<from context>",
    schema="<from context>",
    secret_value="<API key or token if auth_type != 'none'>",
    http_method="GET",
    documentation_url="<the docs URL>",
    parameters={
        "query_params": [
            {
                "name": "filter",
                "type": "string",
                "required": False,
                "description": "Filter expression",
                "examples": ["country:in:(Canada,UK)"]
            },
            {
                "name": "fields",
                "type": "string",
                "required": False,
                "description": "Fields to return",
                "examples": ["rate,date,country"]
            }
        ]
    }
)
```

#### 3c. After registration, go back to Step 1

Now the API is in the registry! Next time someone asks, it will be found in Step 1.

---

## 🔐 Authentication Types - CRITICAL REFERENCE

**YOU MUST CHOOSE THE CORRECT auth_type WHEN REGISTERING APIs!**

### Three Auth Types Explained:

#### 1. `auth_type="none"` - Public APIs (No Authentication)

**When to use:** API requires NO authentication
**Examples:** Treasury Fiscal Data, Public datasets, Free weather APIs

**How it works:**
- Connection has **empty** `bearer_token: ''`
- No secrets are created
- No authentication in requests

**Registration:**
```python
register_api(
    api_name="treasury_rates",
    host="api.fiscaldata.treasury.gov",
    base_path="/services/api/fiscal_service",
    api_path="/v1/accounting/od/rates_of_exchange",
    auth_type="none",  # ✅ No auth
    # NO secret_value parameter!
    warehouse_id="<from context>",
    catalog="<from context>",
    schema="<from context>"
)
```

**SQL Call Generated:**
```sql
-- No api_key in params, no token in headers
SELECT http_request(
  conn => 'treasury_rates_connection',
  path => '/v1/accounting/od/rates_of_exchange',
  params => map('fields', 'rate,date'),  -- Only user params
  headers => map('Accept', 'application/json')
)
```

---

#### 2. `auth_type="api_key"` - API Key in Query Parameters

**When to use:** API key is passed as a **query parameter** (e.g., `?api_key=xxx`)
**Examples:** FRED API, Alpha Vantage, OpenWeatherMap, NewsAPI

**How it works:**
- Connection has **empty** `bearer_token: ''`
- API key stored in Databricks secrets
- At runtime, key is retrieved and **added to query params**

**Registration:**
```python
register_api(
    api_name="fred_economic_data",
    host="api.stlouisfed.org",
    base_path="/fred",
    api_path="/series/observations",
    auth_type="api_key",  # ✅ Key goes in params
    secret_value="YOUR_FRED_API_KEY",  # ✅ Store the key
    warehouse_id="<from context>",
    catalog="<from context>",
    schema="<from context>",
    parameters={
        "query_params": [
            {"name": "series_id", "type": "string", "required": True}
        ]
    }
)
```

**SQL Call Generated:**
```sql
-- api_key is AUTOMATICALLY added from secrets
SELECT http_request(
  conn => 'fred_economic_data_connection',
  path => '/series/observations',
  params => map(
    'api_key', secret('mcp_api_keys', 'fred_economic_data'),  -- ✅ Scope: mcp_api_keys, Key: API name
    'series_id', 'GDPC1',  -- User param
    'file_type', 'json'    -- User param
  ),
  headers => map('Accept', 'application/json')
)
```

---

#### 3. `auth_type="bearer_token"` - Bearer Token in Authorization Header

**When to use:** Token is passed in **Authorization: Bearer** header
**Examples:** GitHub API, Stripe, Most OAuth2 APIs, Modern REST APIs

**How it works:**
- Connection **references the secret**: `bearer_token: secret(...)`
- Token stored in Databricks secrets
- Databricks automatically adds `Authorization: Bearer <token>` header

**Registration:**
```python
register_api(
    api_name="github_user_api",
    host="api.github.com",
    base_path="",
    api_path="/user/repos",
    auth_type="bearer_token",  # ✅ Token in header
    secret_value="ghp_YOUR_GITHUB_TOKEN",  # ✅ Store the token
    warehouse_id="<from context>",
    catalog="<from context>",
    schema="<from context>"
)
```

**SQL Call Generated:**
```sql
-- NO token in params! It's in the connection (Authorization header)
SELECT http_request(
  conn => 'github_user_api_connection',  -- Connection has the token!
  path => '/user/repos',
  params => map('type', 'owner'),  -- Only user params, no token
  headers => map('Accept', 'application/json')
)
```

---

### 🎯 How to Choose Auth Type

**Ask yourself: Where does the API key/token go?**

| Location | Auth Type | Example |
|----------|-----------|---------|
| No authentication needed | `auth_type="none"` | Public APIs |
| In URL: `?api_key=xxx` or `?token=xxx` | `auth_type="api_key"` | FRED, Alpha Vantage |
| In header: `Authorization: Bearer xxx` | `auth_type="bearer_token"` | GitHub, Stripe |

**🚨 COMMON MISTAKE:** Using `auth_type="bearer_token"` for APIs that need API keys in query params → This will FAIL!

**✅ CORRECT:** 
- FRED API uses query param → `auth_type="api_key"`
- GitHub API uses Authorization header → `auth_type="bearer_token"`

---

### 🔐 Secret Naming Convention (CRITICAL!)

**When you need to reference secrets in SQL, use this EXACT format:**

**For API Key Authentication:**
```sql
secret('mcp_api_keys', '<api_name>')
```

**For Bearer Token Authentication:**
```sql
secret('mcp_bearer_tokens', '<api_name>')
```

**Examples:**
- API registered as `fred_economic_data` → `secret('mcp_api_keys', 'fred_economic_data')`
- API registered as `github_user_api` → `secret('mcp_bearer_tokens', 'github_user_api')`

**🚨 WRONG PATTERNS (DO NOT USE):**
- ❌ `secret('fred_secrets', 'api_key')` - Old pattern
- ❌ `secret('mcp_api_keys', 'fred_api_key')` - Don't add suffixes
- ❌ `secret('mcp_api_keys', 'fred_economic_data_api_key')` - No suffixes!

**✅ CORRECT PATTERN:**
- ✅ `secret('mcp_api_keys', '<exact_api_name>')` - Just the API name, nothing else!

---

### 🎯 Registration Examples

#### Example 1: Public API (auth_type="none")

**User:** "Register the Treasury Fiscal Data API"

**YOU:**
```python
# Step 3a: Fetch documentation
fetch_api_documentation(
    documentation_url="https://fiscaldata.treasury.gov/api-documentation/"
)

# Analyze: Public API, no auth required
# Base URL: https://api.fiscaldata.treasury.gov
# Base path: /services/api/fiscal_service
# Endpoint: /v1/accounting/od/rates_of_exchange

# Step 3b: Register with auth_type="none"
register_api(
    api_name="treasury_rates_of_exchange",
    description="U.S. Treasury exchange rates data",
    host="api.fiscaldata.treasury.gov",
    base_path="/services/api/fiscal_service",
    api_path="/v1/accounting/od/rates_of_exchange",
    auth_type="none",  # ✅ No auth
    warehouse_id="<from context>",
    catalog="<from context>",
    schema="<from context>",
    http_method="GET",
    documentation_url="https://fiscaldata.treasury.gov/api-documentation/",
    parameters={
        "query_params": [
            {"name": "filter", "type": "string", "required": False},
            {"name": "fields", "type": "string", "required": False}
        ]
    }
)
```

#### Example 2: API Key in Query Params (auth_type="api_key")

**User:** "Register the FRED API with my key: abc123xyz"

**YOU:**
```python
# Step 3a: Fetch documentation
fetch_api_documentation(
    documentation_url="https://fred.stlouisfed.org/docs/api/"
)

# Analyze: API key required in query params (?api_key=xxx)
# Host: api.stlouisfed.org
# Base path: /fred
# Endpoint: /series/observations

# Step 3b: Register with auth_type="api_key"
register_api(
    api_name="fred_economic_data",
    description="Federal Reserve Economic Data API",
    host="api.stlouisfed.org",
    base_path="/fred",
    api_path="/series/observations",
    auth_type="api_key",  # ✅ Key goes in params
    secret_value="abc123xyz",  # ✅ Store the user's key
    warehouse_id="<from context>",
    catalog="<from context>",
    schema="<from context>",
    http_method="GET",
    documentation_url="https://fred.stlouisfed.org/docs/api/",
    parameters={
        "query_params": [
            {"name": "series_id", "type": "string", "required": True},
            {"name": "file_type", "type": "string", "required": False}
        ]
    }
)
```

#### Example 3: Bearer Token in Header (auth_type="bearer_token")

**User:** "Register GitHub API with my token: ghp_mytoken123"

**YOU:**
```python
# Step 3a: Fetch documentation
fetch_api_documentation(
    documentation_url="https://docs.github.com/en/rest"
)

# Analyze: Bearer token required in Authorization header
# Host: api.github.com
# Endpoint: /user/repos

# Step 3b: Register with auth_type="bearer_token"
register_api(
    api_name="github_user_repos",
    description="GitHub user repositories API",
    host="api.github.com",
    base_path="",  # No base path
    api_path="/user/repos",
    auth_type="bearer_token",  # ✅ Token in Authorization header
    secret_value="ghp_mytoken123",  # ✅ Store the user's token
    warehouse_id="<from context>",
    catalog="<from context>",
    schema="<from context>",
    http_method="GET",
    documentation_url="https://docs.github.com/en/rest",
    parameters={
        "query_params": [
            {"name": "type", "type": "string", "required": False},
            {"name": "sort", "type": "string", "required": False}
        ]
    }
)
```

**Most users will already have APIs registered. Registration happens once per API.**

---

## 📊 http_request() SQL Function

**The SQL you write calls Unity Catalog HTTP Connections:**

```sql
SELECT http_request(
    conn => 'connection_name',  -- Full name from the check_registry call tha tshould return you the connection. name
    method => 'GET',                            -- HTTP method
    path => '/v1/endpoint/path',                -- API path
    params => map('key1', 'value1', 'key2', 'value2'),  -- Query params
    headers => map('Accept', 'application/json')        -- HTTP headers
) as response
```

**The connection_name links everything:**
- Connection stores: host URL + auth credentials
- You just provide: path + params
- Databricks handles: authentication automatically

**That's why you need connection_name from the registry!**

---

## 🎯 Examples

### Example 1: User asks "Show me exchange rates for Canada"
**Note that the query should escape \n and whitespaces**

```
YOU:
1. check_api_http_registry(
     warehouse_id="694340ce4f05d316",
     catalog="luca_milletti",
     schema="custom_mcp_server"
   )

   Response shows:
   - connection_name: "treasury_fx_rates_connection"
   - api_path: "/v1/accounting/od/rates_of_exchange"

2. execute_dbsql(
     query="""
     SELECT http_request(
         conn => 'treasury_fx_rates_connection',
         method => 'GET',
         path => '/v1/accounting/od/rates_of_exchange',
         params => map(
             'filter', 'country_currency_desc:eq:Canada-Dollar',
             'fields', 'country_currency_desc,exchange_rate,record_date'
         ),
         headers => map('Accept', 'application/json')
     ).text as response
     """,
     warehouse_id="694340ce4f05d316",
     catalog="luca_milletti",
     schema="custom_mcp_server"
   )

3. DONE! Return response to user.

Total tool calls: 2
```

### Example 2: User asks "Get treasury data for UK from 2024"
**Note that the query should escape \n and whitespaces**
```
YOU:
1. check_api_http_registry(...)

   Response shows:
   - connection_name: "treasury_fx_rates_connection"
   - api_path: "/v1/accounting/od/rates_of_exchange"

2. execute_dbsql(
     query="""
     SELECT http_request(
         conn => 'treasury_fx_rates_connection',
         method => 'GET',
         path => '/v1/accounting/od/rates_of_exchange',
         params => map(
             'filter', 'country_currency_desc:in:(United Kingdom-Pound),record_date:gte:2024-01-01',
             'fields', 'country_currency_desc,exchange_rate,record_date',
             'page[size]', '50'
         ),
         headers => map('Accept', 'application/json')
     ).text as response
     """,
     warehouse_id="694340ce4f05d316",
     catalog="luca_milletti",
     schema="custom_mcp_server"
   )

3. DONE! Return response to user.

Total tool calls: 2
```

---

## Architecture (For Reference Only)

**How it all connects:**

1. **Unity Catalog HTTP Connection** (e.g., `treasury_fx_rates_connection`)
   - Stores: host URL (`https://api.fiscaldata.treasury.gov`)
   - Stores: base_path (`/services/api/fiscal_service`)
   - Stores: auth credentials (if needed)

2. **api_http_registry table** (Delta table)
   - Stores: connection_name (`treasury_fx_rates_connection`)
   - Stores: api_path (`/v1/accounting/od/rates_of_exchange`)
   - Stores: parameters, description, etc.

3. **You write SQL:**
   ```sql
   SELECT http_request(
       conn => 'treasury_fx_rates_connection',
       path => '/v1/accounting/od/rates_of_exchange',
       params => map(...)
   )
   ```

4. **Databricks combines:**
   - Connection host + base_path + your path = Full URL
   - Connection auth + your params = Authenticated request

**That's it! connection_name is the key that links registry → connection → API.**
