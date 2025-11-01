# API Registry Workflow with Unity Catalog HTTP Connections

This workflow guides you through discovering, registering, and using external API endpoints with the MCP server using **Unity Catalog HTTP Connections** for secure credential management.

## Architecture Overview

**IMPORTANT:** This system uses Unity Catalog HTTP Connections for secure credential storage:

1. **Credentials stored in UC HTTP Connections** - API keys, bearer tokens, and other secrets are stored securely in Unity Catalog, NOT in Delta tables
2. **API metadata in api_http_registry table** - Only non-sensitive metadata (API name, description, connection reference, path) stored in Delta
3. **Connection references** - Each API entry references a UC HTTP Connection by name (e.g., `sec_api_connection`)
4. **Secure and compliant** - Unity Catalog manages access control, audit logging, and credential encryption

**Data Flow:**
```
User provides: API endpoint URL + API key
         ↓
System creates: UC HTTP Connection (stores host + credentials)
         ↓
System registers: API metadata (references connection by name)
         ↓
User calls API: System retrieves connection + appends path
```

## Quick Start (RECOMMENDED)

**🚀 Use `smart_register_with_connection` for one-step registration!**

This tool combines discovery, UC HTTP Connection creation, and API metadata registration into a single step:

```
smart_register_with_connection(
  api_name="sec_api",
  description="SEC API for financial filings",
  endpoint_url="https://api.sec-api.io/v1/filings",
  warehouse_id="<get from UI context>",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  api_key="your-api-key-here",  # Optional but recommended
  documentation_url="https://sec-api.io/docs"  # Optional
)
```

The tool automatically:
- **Parses the endpoint URL** into base host + path
- **Creates a UC HTTP Connection** (stores `https://api.sec-api.io` + Bearer token securely)
- **Fetches documentation** if URL provided
- **Tries common endpoint patterns** (/api, /v1, /search, /data, /query, etc.)
- **Tests multiple authentication methods** (Bearer header, API key header, query params)
- **Discovers the best working configuration**
- **Registers in the api_http_registry table** with connection reference
- **Validates the endpoint**

**This reduces the workflow from 5+ steps to just 1 step!**

**What gets created:**
- UC HTTP Connection: `sec_api_connection`
  - Host: `https://api.sec-api.io`
  - Port: `443`
  - Bearer token: `your-api-key-here` (encrypted in Unity Catalog)

- Registry entry in `api_http_registry` table:
  - `api_name`: "sec_api"
  - `connection_name`: "sec_api_connection"
  - `api_path`: "/v1/filings"
  - `documentation_url`: "https://sec-api.io/docs"
  - `user_who_requested`: "luca.milletti@databricks.com"

## Unity Catalog HTTP Connection Tools

### `create_http_connection`
Create a Unity Catalog HTTP Connection with secure credential storage.

```
create_http_connection(
  connection_name="alphavantage_connection",
  host="https://www.alphavantage.co",
  bearer_token="your-api-key-here",  # Optional
  port=443  # Default
)
```

**Parameters:**
- `connection_name` (required): Unique name for the connection
- `host` (required): Base URL of the API (e.g., "https://api.example.com")
- `bearer_token` (optional): Bearer token for authentication
- `port` (optional): Port number (default: 443)

**Returns:** Connection details with UC connection name

**When to use:** When you already know the API structure and want to manually create the UC connection before registering API metadata.

### `register_api_with_connection`
Register API metadata that references an existing UC HTTP Connection.

```
register_api_with_connection(
  api_name="alphavantage_stock",
  description="Alpha Vantage stock market time series data",
  connection_name="alphavantage_connection",
  api_path="/query?function=TIME_SERIES_INTRADAY",
  warehouse_id="your-warehouse-id",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  documentation_url="https://www.alphavantage.co/documentation"  # Optional
)
```

**Parameters:**
- `api_name` (required): Descriptive name for the API
- `description` (required): What this API does
- `connection_name` (required): Name of the UC HTTP Connection to use
- `api_path` (optional): Path to append to connection base URL
- `warehouse_id` (required): SQL warehouse ID for validation
- `catalog` (required): Catalog name for api_http_registry table
- `schema` (required): Schema name for api_http_registry table
- `documentation_url` (optional): API documentation URL

**Returns:** Registration confirmation with api_id

**When to use:** When you've already created a UC HTTP Connection and want to register API metadata separately.

### `list_http_connections`
List available Unity Catalog HTTP Connections.

```
list_http_connections()
```

**Returns:** List of all HTTP connections with their names and details

**When to use:** To see existing connections before registering a new API, or to verify a connection was created successfully.

### `test_http_connection`
Test if a UC HTTP Connection is working correctly.

```
test_http_connection(
  connection_name="sec_api_connection",
  test_path="/v1/status"  # Optional path to test
)
```

**Parameters:**
- `connection_name` (required): Name of the connection to test
- `test_path` (optional): Path to append for testing (default: "/")

**Returns:** Test result with status code and response preview

**When to use:** To verify a connection is working before or after registration.

### `delete_http_connection`
Delete a Unity Catalog HTTP Connection.

```
delete_http_connection(
  connection_name="old_api_connection"
)
```

**Parameters:**
- `connection_name` (required): Name of the connection to delete

**Returns:** Deletion confirmation

**When to use:** To clean up unused connections or remove connections with incorrect credentials.

## Other Smart Helper Tools

### `fetch_api_documentation`
Automatically fetch and parse API documentation from URLs.

```
fetch_api_documentation(
  documentation_url="https://sec-api.io/docs"
)
```

**Returns:**
- Extracted API URLs found in documentation
- Common endpoint paths (/api, /v1, etc.)
- Parameter names (apikey, token, etc.)
- Code examples count
- Content preview

**When to use:** User provides a documentation link but you need to extract endpoint details before registration.

### `try_common_api_patterns`
Automatically test common API endpoint patterns with multiple auth methods.

```
try_common_api_patterns(
  base_url="https://api.example.com",
  api_key="your-api-key-here"  # Optional
)
```

**Tests these patterns automatically:**
- Base URL itself
- `/api`, `/api/v1`, `/api/v2`
- `/v1`, `/v2`
- `/search`, `/query`, `/data`
- `/status`, `/health`, `/docs`, `/swagger`

**With these auth methods:**
- No authentication
- Bearer token header
- X-API-Key header
- apikey query parameter
- api_key query parameter

**Returns:** List of successful endpoints found with their auth methods.

**When to use:** You have a base URL but don't know the exact endpoint path or auth method.

### `discover_api_endpoint`
Manually discover a specific API endpoint with authentication.

```
discover_api_endpoint(
  endpoint_url="https://api.example.com/v1/data",
  api_key="your-api-key-here",  # Optional
  timeout=10  # Optional
)
```

**Returns:** Discovery results including auth requirements, data capabilities, and next steps

**When to use:** You want to analyze a specific endpoint before creating a UC connection.

---

## Manual Workflow (Use only if smart tools fail)

The manual API registry workflow consists of four main steps:

1. **Discover** - Analyze the API endpoint to understand authentication and data capabilities
2. **Create UC Connection** - Store credentials securely in Unity Catalog
3. **Register API Metadata** - Store API configuration in the api_http_registry table
4. **Validate** - Confirm the API is working correctly
5. **Use** - Execute SQL queries or retrieve data from the registered API

## Step 1: Discover API Endpoint

**When to use:** You have an API URL and need to understand how to authenticate and what data it provides.

### Tool: `discover_api_endpoint`

**Parameters:**
- `endpoint_url` (required): The full API URL to discover
- `api_key` (optional): API key if you already know authentication is required
- `timeout` (optional): Request timeout in seconds (default: 10)

### Example: Discovering Alpha Vantage API

```
discover_api_endpoint(
  endpoint_url="https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min&apikey=demo"
)
```

**Expected Output:**
```json
{
  "success": true,
  "endpoint_url": "https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min&apikey=demo",
  "status_code": 200,
  "requires_auth": true,
  "auth_detection": {
    "detected": true,
    "method": "URL parameter (apikey)",
    "confidence": "high"
  },
  "data_capabilities": {
    "detected_fields": ["Meta Data", "Time Series (5min)", "symbol", "interval"],
    "structure": "object",
    "summary": "API provides stock market time series data with meta information"
  },
  "next_steps": [
    "API is functional with authentication",
    "Create UC HTTP Connection with bearer_token",
    "Register API metadata with connection reference"
  ]
}
```

## Step 2: Create Unity Catalog HTTP Connection

**When to use:** After discovering an API, you want to store its credentials securely.

### Tool: `create_http_connection`

**Example: Creating Connection for Alpha Vantage**

```
create_http_connection(
  connection_name="alphavantage_connection",
  host="https://www.alphavantage.co",
  bearer_token="your-actual-api-key-here",
  port=443
)
```

**Expected Output:**
```json
{
  "success": true,
  "connection_name": "alphavantage_connection",
  "host": "https://www.alphavantage.co",
  "port": 443,
  "message": "HTTP connection created successfully in Unity Catalog"
}
```

**What this does:**
1. Creates a Unity Catalog HTTP Connection
2. Stores the base host URL
3. Encrypts and stores the bearer token securely
4. Makes the connection available for API registrations

## Step 3: Register API Metadata

**When to use:** After creating a UC HTTP Connection, you want to register API metadata.

### Tool: `register_api_with_connection`

**Example: Registering Alpha Vantage API**

```
register_api_with_connection(
  api_name="Alpha Vantage - IBM Stock 5min Intervals",
  description="Stock market time series data for IBM with 5-minute intervals. Provides OHLC (Open, High, Low, Close) prices and trading volume.",
  connection_name="alphavantage_connection",
  api_path="/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min",
  warehouse_id="your-warehouse-id-here",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  documentation_url="https://www.alphavantage.co/documentation"
)
```

**Expected Output:**
```json
{
  "success": true,
  "message": "API 'Alpha Vantage - IBM Stock 5min Intervals' registered successfully",
  "api_id": "api-a1b2c3d4",
  "status": "valid",
  "registry_entry": {
    "api_id": "api-a1b2c3d4",
    "api_name": "Alpha Vantage - IBM Stock 5min Intervals",
    "connection_name": "alphavantage_connection",
    "api_path": "/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min",
    "user_who_requested": "luca.milletti@databricks.com",
    "created_at": "2025-11-01T10:30:00"
  }
}
```

**What Registration Does:**
1. Generates unique API ID (e.g., `api-a1b2c3d4`)
2. Captures user context via on-behalf-of authentication
3. Stores metadata in `api_http_registry` table
4. References the UC HTTP Connection by name
5. NO credentials stored in Delta table - only connection reference

**Registry Fields:**
- `api_id`: Auto-generated unique identifier
- `api_name`: Human-readable name
- `description`: What the API does
- `connection_name`: Reference to UC HTTP Connection (stores credentials)
- `api_path`: Path to append to connection base URL
- `documentation_url`: API documentation link
- `user_who_requested`: Your email (auto-captured)
- `created_at`: Registration timestamp
- `status`: "valid" or "pending"

## Step 4: Validate Registered API

**When to use:** You want to check if a registered API is still working correctly.

### Tool: `test_http_connection`

**Example: Testing a Registered Connection**

```
test_http_connection(
  connection_name="alphavantage_connection",
  test_path="/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min"
)
```

**Expected Output:**
```json
{
  "success": true,
  "status_code": 200,
  "is_healthy": true,
  "response_preview": "{\n  \"Meta Data\": {\n    \"1. Information\": \"Intraday (5min)...",
  "message": "Connection test successful"
}
```

## Step 5: Use Registered APIs

**When to use:** Query the registry to find APIs or manage connections.

### Tool: `check_api_http_registry`

**Retrieve All Registered APIs:**
```
check_api_http_registry(
  warehouse_id="your-warehouse-id",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  limit=100
)
```

**Alternative: Use SQL directly:**
```
execute_dbsql(
  warehouse_id="your-warehouse-id",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  query="SELECT * FROM api_http_registry ORDER BY created_at DESC"
)
```

**Find APIs by Name:**
```
execute_dbsql(
  warehouse_id="your-warehouse-id",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  query="SELECT * FROM api_http_registry WHERE api_name LIKE '%Alpha Vantage%'"
)
```

**Get API Details by Connection:**
```
execute_dbsql(
  warehouse_id="your-warehouse-id",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  query="SELECT * FROM api_http_registry WHERE connection_name = 'alphavantage_connection'"
)
```

## Complete Workflow Example

**User Request:** "I want to use the Alpha Vantage API to get IBM stock data, my API key is ABC123"

### Using Smart Registration (RECOMMENDED):

```
User: "I want to use the Alpha Vantage API to get IBM stock data, my API key is ABC123"

Claude calls:
smart_register_with_connection(
  api_name="alphavantage_stock",
  description="Real-time and historical stock data for IBM with 5-minute intervals",
  endpoint_url="https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min",
  warehouse_id="abc123warehouse",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  api_key="ABC123",
  documentation_url="https://www.alphavantage.co/documentation"
)

Result:
- UC HTTP Connection created: alphavantage_stock_connection
- API registered in api_http_registry
- Status: valid
- Credentials securely stored in Unity Catalog
```

### Using Manual Steps (if smart tool fails):

**1. Discover the API:**
```
discover_api_endpoint(
  endpoint_url="https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min&apikey=demo"
)

Result:
- Requires authentication: Yes (Bearer token)
- Data available: Stock time series with OHLC prices
- Next step: Create UC HTTP Connection
```

**2. Create UC HTTP Connection:**
```
create_http_connection(
  connection_name="alphavantage_connection",
  host="https://www.alphavantage.co",
  bearer_token="ABC123",
  port=443
)

Result:
- Connection created successfully
- Credentials stored securely in Unity Catalog
```

**3. Register API Metadata:**
```
register_api_with_connection(
  api_name="Alpha Vantage - IBM Stock Data",
  description="Real-time and historical stock data for IBM",
  connection_name="alphavantage_connection",
  api_path="/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min",
  warehouse_id="abc123warehouse",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  documentation_url="https://www.alphavantage.co/documentation"
)

Result:
- API ID: api-a1b2c3d4
- Status: valid
- Successfully registered
```

**4. Validate the API:**
```
test_http_connection(
  connection_name="alphavantage_connection",
  test_path="/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min"
)

Result:
- Status: 200 OK
- Healthy: Yes
- Data returned with latest stock prices
```

**5. Use the Registered API:**
```
check_api_http_registry(
  warehouse_id="abc123warehouse",
  catalog="luca_milletti",
  schema="custom_mcp_server"
)

Result:
- Shows all registered APIs
- Includes the newly registered Alpha Vantage API
```

## Common Patterns

### Pattern 1: API with Bearer Token Authentication

**Smart Registration:**
```
smart_register_with_connection(
  api_name="example_api",
  description="Data from example.com API",
  endpoint_url="https://api.example.com/v1/data",
  warehouse_id="your-warehouse-id",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  api_key="your-bearer-token-here"
)
```

**Manual Registration:**
```
# Step 1: Create connection
create_http_connection(
  connection_name="example_connection",
  host="https://api.example.com",
  bearer_token="your-bearer-token-here"
)

# Step 2: Register metadata
register_api_with_connection(
  api_name="example_api",
  description="Data from example.com API",
  connection_name="example_connection",
  api_path="/v1/data",
  warehouse_id="your-warehouse-id",
  catalog="luca_milletti",
  schema="custom_mcp_server"
)
```

### Pattern 2: Public API (No Authentication)

```
smart_register_with_connection(
  api_name="public_data_api",
  description="Public data endpoint with no authentication required",
  endpoint_url="https://api.publicdata.com/v1/info",
  warehouse_id="your-warehouse-id",
  catalog="luca_milletti",
  schema="custom_mcp_server"
  # No api_key parameter - connection created without credentials
)
```

### Pattern 3: API with Documentation

```
smart_register_with_connection(
  api_name="sec_api",
  description="SEC API for financial filings",
  endpoint_url="https://api.sec-api.io/v1/filings",
  warehouse_id="your-warehouse-id",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  api_key="your-sec-api-key",
  documentation_url="https://sec-api.io/docs"
)

# Later, discover more endpoints from the same API
review_api_documentation_for_endpoints(
  api_id="<api_id from registry>",
  warehouse_id="your-warehouse-id",
  catalog="luca_milletti",
  schema="custom_mcp_server",
  api_key="your-sec-api-key"
)
```

## Troubleshooting

### Issue: "Connection already exists with this name"

**Solution:** Either use a different connection name or delete the existing connection:
```
delete_http_connection(connection_name="old_connection")
```

### Issue: "Cannot find connection"

**Solution:** List available connections to verify the name:
```
list_http_connections()
```

### Issue: "Connection test failed with status 401"

**Possible causes:**
1. Wrong bearer token
2. Invalid or expired API key
3. Token format incorrect

**Solution:** Delete and recreate the connection with correct credentials:
```
delete_http_connection(connection_name="failing_connection")
create_http_connection(
  connection_name="new_connection",
  host="https://api.example.com",
  bearer_token="correct-token-here"
)
```

### Issue: "Connection test failed with status 404"

**Possible causes:**
1. Incorrect api_path
2. API endpoint changed
3. Host URL incorrect

**Solution:** Verify the full URL structure and update the api_path in the registry

### Issue: "Timeout error"

**Solution:** Increase timeout parameter:
```
test_http_connection(
  connection_name="slow_api",
  test_path="/v1/data",
  timeout=30  # Increase from default
)
```

### Issue: "Cannot find warehouse_id"

**Solution:** List available warehouses:
```
list_warehouses()
```

## Best Practices

1. **Always use smart_register_with_connection** - Reduces workflow from 5+ steps to 1 step
2. **Use descriptive connection names** - Include API name and purpose (e.g., `sec_api_production_connection`)
3. **Include documentation_url** - Enables endpoint discovery later
4. **Test after registration** - Use `test_http_connection` to verify it works
5. **Never expose credentials** - Credentials are encrypted in Unity Catalog, never in Delta tables
6. **Use catalog/schema parameters** - Always specify catalog and schema for multi-tenancy
7. **Clean up unused connections** - Use `delete_http_connection` to remove old connections
8. **Query the registry** - Use SQL to find and manage your registered APIs
9. **Monitor connection health** - Periodically test connections to detect issues
10. **Document your APIs** - Use descriptive names and detailed descriptions

## Security Considerations

- **Credentials encrypted in Unity Catalog** - API keys stored securely with UC encryption
- **No credentials in Delta tables** - Only connection references stored in api_http_registry
- **On-behalf-of authentication** - Each user only sees their own registered APIs
- **Access control via Unity Catalog** - Manage who can create/use connections
- **Audit logging** - UC tracks all connection access and modifications
- **Token validation** - System validates credentials before creating connections
- **NEVER share API keys** - Only pass keys to `api_key` parameter, never in descriptions

## Summary

The UC HTTP Connections workflow follows this pattern:

1. **Discover** → Understand authentication and capabilities
2. **Create UC Connection** → Store credentials securely in Unity Catalog
3. **Register Metadata** → Store API configuration in api_http_registry table
4. **Validate** → Confirm the connection works
5. **Use** → Query registry and call APIs as needed

**Key advantages of UC HTTP Connections:**
- ✅ Credentials encrypted and secured by Unity Catalog
- ✅ No sensitive data in Delta tables
- ✅ Centralized credential management
- ✅ Audit logging and access control
- ✅ Credential rotation without updating Delta tables
- ✅ Compliance with security best practices

Each step is supported by specific MCP tools that handle the complexity of API integration, authentication, and secure credential management.
