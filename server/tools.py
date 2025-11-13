"""MCP Tools for Databricks operations with Unity Catalog HTTP Connections."""

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Dict
from urllib.parse import urlparse

from databricks.sdk import WorkspaceClient
from databricks.sdk.core import Config
from databricks.sdk.service.catalog import ConnectionType
from databricks.sdk.service.serving import ExternalFunctionRequestHttpMethod
from fastmcp.server.dependencies import get_http_headers
from contextvars import ContextVar

# Context variable to store user token for OBO authentication
# This is set by execute_mcp_tool() before calling tools
_user_token_context: ContextVar[str | None] = ContextVar('user_token', default=None)

# Context variable to store credentials securely (NOT in messages!)
# This is set by execute_mcp_tool() before calling tools
# Format: {"api_key": "xxx", "bearer_token": "yyy"}
_credentials_context: ContextVar[dict | None] = ContextVar('credentials', default=None)


def get_workspace_client() -> WorkspaceClient:
  """Get a WorkspaceClient with on-behalf-of user authentication.

  Falls back to OAuth service principal authentication if:
  - User token is not available
  - User has no access to SQL warehouses

  Returns:
      WorkspaceClient configured with appropriate authentication
  """
  host = os.environ.get('DATABRICKS_HOST')

  # Try to get user token from multiple sources (in order of preference)
  # 1. First try the context variable (set by execute_mcp_tool)
  user_token = _user_token_context.get()
  if user_token:
    print(f'[get_workspace_client] ✅ Got token from context variable')
  else:
    # 2. Fallback to request headers (for direct HTTP calls to tools)
    headers = get_http_headers()
    print(f'[get_workspace_client] Headers received: {list(headers.keys())}')
    user_token = headers.get('x-forwarded-access-token')

  print(f'[get_workspace_client] User token found: {bool(user_token)}')
  if user_token:
    print(f'[get_workspace_client] Token preview: {user_token[:20]}...')

  if user_token:
    # Try on-behalf-of authentication with user's token
    print(f'🔐 Attempting OBO authentication for user')
    config = Config(host=host, token=user_token, auth_type='pat')
    user_client = WorkspaceClient(config=config)

    # Verify user has access to SQL warehouses
    has_warehouse_access = False

    try:
      warehouses = list(user_client.warehouses.list())
      if warehouses:
        has_warehouse_access = True
        print(f'✅ User has access to {len(warehouses)} warehouse(s)')
    except Exception as e:
      print(f'⚠️  User cannot list warehouses: {str(e)}')

    # If user has warehouse access, use OBO; otherwise fallback to service principal
    if has_warehouse_access:
      print(f'✅ Using OBO authentication - user has warehouse access')
      return user_client
    else:
      print(f'⚠️  User has no warehouse access, falling back to service principal')
      return WorkspaceClient(host=host)
  else:
    # Fall back to OAuth service principal authentication
    # WorkspaceClient will automatically use DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET
    # which are injected by Databricks Apps platform
    print(f'⚠️  No user token found, falling back to service principal')
    return WorkspaceClient(host=host)


def _execute_sql_query(
  query: str, warehouse_id: str = None, catalog: str = None, schema: str = None, limit: int = 100
) -> dict:
  """Helper function to execute SQL queries on Databricks SQL warehouse.

  Args:
      query: SQL query to execute
      warehouse_id: SQL warehouse ID (optional, uses env var if not provided)
      catalog: Catalog to use (optional)
      schema: Schema to use (optional)
      limit: Maximum number of rows to return (default: 100)

  Returns:
      Dictionary with query results or error message
  """
  try:
    # Initialize Databricks SDK with on-behalf-of authentication
    w = get_workspace_client()

    # Get warehouse ID from parameter or environment
    warehouse_id = warehouse_id or os.environ.get('DATABRICKS_SQL_WAREHOUSE_ID')
    if not warehouse_id:
      return {
        'success': False,
        'error': (
          'No SQL warehouse ID provided. Set DATABRICKS_SQL_WAREHOUSE_ID or pass warehouse_id.'
        ),
      }

    # Build the full query with catalog/schema if provided; if the query is an http_connection request then good else bad
    full_query = query
    if "http_request(" in query.lower():
      full_query = query
    elif catalog and schema:
      full_query = f'USE CATALOG {catalog}; USE SCHEMA {schema}; {query}'

    print(f'🔧 Executing SQL on warehouse {warehouse_id}: {query[:100]}...')

    # Execute the query
    result = w.statement_execution.execute_statement(
      warehouse_id=warehouse_id, statement=full_query, wait_timeout='30s'
    )
    print(f'⛁⛁⛁ Output executing SQL result: {result}')
    # Process results
    if result.result and result.result.data_array:
      columns = [col.name for col in result.manifest.schema.columns]
      data = []
      
      for row in result.result.data_array[:limit]:
        row_dict = {}
        for i, col in enumerate(columns):
          row_dict[col] = row[i]
        data.append(row_dict)

      return {'success': True, 'data': {'columns': columns, 'rows': data}, 'row_count': len(data)}
    else:
      return {
        'success': True,
        'data': {'message': 'Query executed successfully with no results'},
        'row_count': 0,
      }

  except Exception as e:
    print(f'❌ Error executing SQL: {str(e)}')
    return {'success': False, 'error': f'Error: {str(e)}'}


def load_tools(mcp_server):
  """Register all MCP tools with the server.

  Args:
      mcp_server: The FastMCP server instance to register tools with
  """

  @mcp_server.tool
  def health() -> dict:
    """Check the health of the MCP server and Databricks connection."""
    headers = get_http_headers()
    user_token = headers.get('x-forwarded-access-token')
    user_token_present = bool(user_token)

    # Get basic info about the authenticated user if OBO token is present
    user_info = None
    if user_token_present:
      try:
        # Use user's token for on-behalf-of authentication
        # Create Config with ONLY token auth to avoid OAuth conflict
        # auth_type='pat' forces token-only auth and disables auto-detection
        config = Config(host=os.environ.get('DATABRICKS_HOST'), token=user_token, auth_type='pat')
        w = WorkspaceClient(config=config)
        current_user = w.current_user.me()
        user_info = {
          'username': current_user.user_name,
          'display_name': current_user.display_name,
          'active': current_user.active,
        }
      except Exception as e:
        user_info = {'error': f'Could not fetch user info: {str(e)}'}

    return {
      'status': 'healthy',
      'service': 'databricks-api-registry-http',
      'databricks_configured': bool(os.environ.get('DATABRICKS_HOST')),
      'auth_mode': 'on-behalf-of' if user_token_present else 'service-principal',
      'user_auth_available': user_token_present,
      'authenticated_user': user_info,
      'architecture': 'Unity Catalog HTTP Connections',
    }

  @mcp_server.tool
  def execute_dbsql(
    query: str,
    warehouse_id: str = None,
    catalog: str = None,
    schema: str = None,
    limit: int = 100,
  ) -> dict:
    """Execute a SQL query on Databricks SQL warehouse.

    Args:
        query: SQL query to execute
        warehouse_id: SQL warehouse ID (optional, uses env var if not provided)
        catalog: Catalog to use (optional)
        schema: Schema to use (optional)
        limit: Maximum number of rows to return (default: 100)

    Returns:
        Dictionary with query results or error message
    """
    return _execute_sql_query(query, warehouse_id, catalog, schema, limit)

  @mcp_server.tool
  def list_warehouses() -> dict:
    """List all SQL warehouses in the Databricks workspace.

    Returns:
        Dictionary containing list of warehouses with their details
    """
    try:
      # Initialize Databricks SDK with on-behalf-of authentication
      w = get_workspace_client()

      # List SQL warehouses
      warehouses = []
      for warehouse in w.warehouses.list():
        warehouses.append(
          {
            'id': warehouse.id,
            'name': warehouse.name,
            'state': warehouse.state.value if warehouse.state else 'UNKNOWN',
            'size': warehouse.cluster_size,
            'type': warehouse.warehouse_type.value if warehouse.warehouse_type else 'UNKNOWN',
            'creator': warehouse.creator_name if hasattr(warehouse, 'creator_name') else None,
            'auto_stop_mins': warehouse.auto_stop_mins
            if hasattr(warehouse, 'auto_stop_mins')
            else None,
          }
        )

      return {
        'success': True,
        'warehouses': warehouses,
        'count': len(warehouses),
        'message': f'Found {len(warehouses)} SQL warehouse(s)',
      }

    except Exception as e:
      print(f'❌ Error listing warehouses: {str(e)}')
      return {'success': False, 'error': f'Error: {str(e)}', 'warehouses': [], 'count': 0}

  @mcp_server.tool
  def list_dbfs_files(path: str = '/') -> dict:
    """List files and directories in DBFS (Databricks File System).

    Args:
        path: DBFS path to list (default: '/')

    Returns:
        Dictionary with file listings or error message
    """
    try:
      # Initialize Databricks SDK with on-behalf-of authentication
      w = get_workspace_client()

      # List files in DBFS
      files = []
      for file_info in w.dbfs.list(path):
        files.append(
          {
            'path': file_info.path,
            'is_dir': file_info.is_dir,
            'size': file_info.file_size if not file_info.is_dir else None,
            'modification_time': file_info.modification_time,
          }
        )

      return {
        'success': True,
        'path': path,
        'files': files,
        'count': len(files),
        'message': f'Listed {len(files)} item(s) in {path}',
      }

    except Exception as e:
      print(f'❌ Error listing DBFS files: {str(e)}')
      return {'success': False, 'error': f'Error: {str(e)}', 'files': [], 'count': 0}

  # ========================================
  # Unity Catalog HTTP Connection Tools (SQL-based with Secret Scopes)
  # ========================================

  # Private helper functions for secret management
  #
  # PERMISSION MODEL:
  # The app's service principal (configured in app.yaml with 'secrets' scope)
  # manages all secrets on behalf of users. Two shared scopes are used:
  #   - mcp_api_keys: For API key authentication
  #   - mcp_bearer_tokens: For bearer token authentication
  #
  # Setup required (one-time by admin):
  #   1. Create scopes: ./setup_shared_secrets.sh
  #   2. Grant WRITE to service principal
  #   3. Redeploy app: ./deploy.sh
  #
  # After setup, users can register APIs with auth through the app UI.
  # No per-user permissions needed - the service principal handles all secret operations.

  def _get_secrets_client() -> WorkspaceClient:
    """Get a WorkspaceClient specifically for secrets operations.
    
    Uses service principal credentials directly to bypass OAuth token scope limitations.
    The service principal must have WRITE permission on the secret scopes.
    """
    host = os.environ.get('DATABRICKS_HOST')
    client_id = os.environ.get('DATABRICKS_CLIENT_ID')
    client_secret = os.environ.get('DATABRICKS_CLIENT_SECRET')
    
    if client_id and client_secret:
      # Use OAuth M2M with service principal credentials
      print(f"🔐 Using service principal for secrets: {client_id}")
      config = Config(
        host=host,
        client_id=client_id,
        client_secret=client_secret,
        auth_type='oauth-m2m'
      )
      return WorkspaceClient(config=config)
    else:
      # Fallback to default client
      print(f"⚠️  No service principal credentials found, using default client")
      return get_workspace_client()

  def _create_secret_scope(scope_name: str) -> dict:
    """Create a Databricks secret scope if it doesn't exist."""
    try:
      w = _get_secrets_client()

      # Check if scope already exists
      try:
        existing_scopes = list(w.secrets.list_scopes())
        scope_exists = any(s.name == scope_name for s in existing_scopes)
        if scope_exists:
          print(f"✅ Secret scope already exists: {scope_name}")
          return {'success': True, 'scope_name': scope_name, 'created': False}
      except Exception:
        pass

      # Create the scope
      w.secrets.create_scope(scope=scope_name)
      print(f"✅ Created secret scope: {scope_name}")
      return {'success': True, 'scope_name': scope_name, 'created': True}

    except Exception as e:
      if "already exists" in str(e).lower():
        print(f"✅ Secret scope already exists: {scope_name}")
        return {'success': True, 'scope_name': scope_name, 'created': False}
      print(f"❌ Error creating secret scope: {str(e)}")
      return {'success': False, 'error': str(e)}

  def _store_secret(scope_name: str, key_name: str, secret_value: str) -> dict:
    """Store a secret in a Databricks secret scope."""
    print(f"🔐 [_store_secret] Attempting to store secret:")
    print(f"    Scope: {scope_name}")
    print(f"    Key: {key_name}")
    print(f"    Value length: {len(secret_value)} chars")
    
    try:
      w = _get_secrets_client()
      print(f"🔐 [_store_secret] Got workspace client, calling put_secret...")
      
      w.secrets.put_secret(scope=scope_name, key=key_name, string_value=secret_value)
      
      print(f"🔐 [_store_secret] put_secret() completed successfully!")
      print(f"✅ Stored secret: {scope_name}/{key_name}")
      
      # VERIFY it was actually created
      try:
        print(f"🔍 [_store_secret] Verifying secret was created...")
        secrets_list = list(w.secrets.list_secrets(scope=scope_name))
        secret_keys = [s.key for s in secrets_list]
        if key_name in secret_keys:
          print(f"✅ [_store_secret] Verification: Secret {key_name} found in scope!")
        else:
          print(f"⚠️  [_store_secret] Verification: Secret {key_name} NOT found! Keys: {secret_keys}")
      except Exception as verify_error:
        print(f"⚠️  [_store_secret] Could not verify secret creation: {verify_error}")
      
      return {'success': True, 'scope_name': scope_name, 'key_name': key_name}
    except Exception as e:
      print(f"❌ [_store_secret] Error storing secret: {str(e)}")
      print(f"❌ [_store_secret] Error type: {type(e).__name__}")
      import traceback
      traceback.print_exc()
      return {'success': False, 'error': str(e)}

  def _create_http_connection_sql(
    connection_name: str,
    host: str,
    base_path: str,
    auth_type: str,
    catalog: str,
    schema: str,
    api_name: str = None,
    port: int = 443,
    description: str = None
  ) -> str:
    """Generate SQL CREATE CONNECTION statement for three auth flavors.

    NOTE: Creates connection in specified catalog.schema by setting context first.
    """
    if auth_type not in ['none', 'api_key', 'bearer_token']:
      raise ValueError(f"auth_type must be 'none', 'api_key', or 'bearer_token'")
    # Create connection with simple name (catalog/schema set via execute_statement params)
    # NOTE: Don't use IF NOT EXISTS - it may not be supported for connections
    # IMPORTANT: Host must include https:// protocol
    host_with_protocol = host if host.startswith('https://') else f'https://{host}'

    sql = f"""CREATE CONNECTION {connection_name}
  TYPE HTTP
  OPTIONS (
    host '{host_with_protocol}',
    port '{port}'"""

    if base_path:
      sql += f""",
    base_path '{base_path}'"""

    # Handle bearer_token based on auth_type
    if auth_type == 'bearer_token':
      # Use secret reference for bearer token auth
      # The bearer token is stored in the connection and automatically used
      if not api_name:
        raise ValueError("api_name is required for bearer_token authentication")
      # Use dedicated bearer token scope with simple API name as key
      scope_name = os.environ.get('MCP_BEARER_TOKEN_SCOPE', 'mcp_bearer_tokens')
      secret_key = api_name  # Simple: just the API name
      sql += f""",
    bearer_token secret('{scope_name}', '{secret_key}')"""
    elif auth_type == 'api_key':
      # For API key auth, connection has EMPTY bearer_token
      # The API key is stored in secrets and passed as a param at runtime
      sql += f""",
    bearer_token ''"""
    else:
      # For public APIs (auth_type='none'), use empty string
      sql += f""",
    bearer_token ''"""

    comment = description or f'HTTP connection for {host}'
    # Escape single quotes in comment to prevent SQL syntax errors
    comment_escaped = comment.replace("'", "''")
    sql += f"""
  )
  COMMENT '{comment_escaped}';"""
    return sql

  def _execute_create_connection_sql(sql: str, warehouse_id: str, catalog: str, schema: str) -> dict:
    """Execute CREATE CONNECTION SQL statement with catalog/schema context."""
    try:
      w = get_workspace_client()

      # Debug: Print the exact SQL being executed
      print(f"🔍 Executing CREATE CONNECTION SQL:")
      print(f"   Catalog: {catalog}")
      print(f"   Schema: {schema}")
      print(f"   Warehouse: {warehouse_id}")
      print(f"   SQL Statement:")
      print("=" * 80)
      print(sql)
      print("=" * 80)

      result = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=sql,
        catalog=catalog,
        schema=schema,
        wait_timeout="30s"
      )

      if result.status and result.status.state:
        state = result.status.state.value
        if state == "SUCCEEDED":
          print(f"✅ Connection created via SQL in {catalog}.{schema}")
          return {'success': True, 'state': state}
        error_msg = result.status.error.message if result.status.error else "Unknown error"
        print(f"❌ Connection creation failed: {error_msg}")
        return {'success': False, 'error': error_msg, 'state': state}
      return {'success': False, 'error': 'No status from SQL execution'}
    except Exception as e:
      print(f"❌ Error executing CREATE CONNECTION: {str(e)}")
      return {'success': False, 'error': str(e)}

  # ========================================
  # New API Registration with Auth Types
  # ========================================

  # Private helper for API registration (can be called from multiple tools)
  def _register_api_impl(
    api_name: str,
    description: str,
    host: str,
    auth_type: str,
    warehouse_id: str,
    catalog: str,
    schema: str,
    base_path: str = '',
    secret_value: str = None,
    available_endpoints: list = None,
    example_calls: list = None,
    documentation_url: str = None,
    port: int = 443
  ) -> dict:
    """Private implementation for API registration with SQL-based connections.
    
    ARCHITECTURE: Register API once (host + base_path), call dynamically later.
    
    Args:
        available_endpoints: List of dicts with path/description/method for reference
            Example: [{"path": "/repos", "description": "Repository operations", "method": "GET"}]
        example_calls: List of dicts with concrete usage examples
            Example: [{"description": "Get a repo", "path": "/repos/owner/repo", "params": {"type": "public"}}]
    
    Both parameters are INFORMATIONAL ONLY - users can call ANY path at runtime.
    """
    try:
      import json

      # Validate auth_type
      if auth_type not in ['none', 'api_key', 'bearer_token']:
        return {'success': False, 'error': f"auth_type must be 'none', 'api_key', or 'bearer_token', got: {auth_type}"}

      # SECURE: ALWAYS check credentials context FIRST (ignore secret_value parameter)
      # This prevents LLM from passing placeholder values like "YOUR_BEARER_TOKEN"
      if auth_type in ['api_key', 'bearer_token']:
        credentials = _credentials_context.get()
        print(f'🔐 [register_api] Auth type: {auth_type}, API name: {api_name}')
        print(f'🔐 [register_api] secret_value param provided: {bool(secret_value)} (length: {len(secret_value) if secret_value else 0})')
        print(f'🔐 [register_api] Credentials from context: {bool(credentials)}')
        
        if credentials:
          print(f'    Credential keys available: {list(credentials.keys())}')
          context_secret = credentials.get(auth_type)
          if context_secret:
            # ALWAYS prefer context over parameter (prevents LLM placeholder bug)
            secret_value = context_secret
            value_preview = secret_value[:10] + '...' if len(secret_value) > 10 else secret_value
            print(f'✅ [register_api] Using credential from CONTEXT for {api_name}: {value_preview} ({len(secret_value)} chars)')
          else:
            print(f'❌ [register_api] Credential key "{auth_type}" not found in context! Available: {list(credentials.keys())}')
        else:
          print(f'⚠️  [register_api] No credentials in context, using parameter if provided')
        
        if not secret_value:
          return {'success': False, 'error': f"secret_value required for auth_type '{auth_type}'. Please provide your credential first."}

      # Convert available_endpoints list to JSON string for storage
      available_endpoints_str = None
      if available_endpoints:
        if isinstance(available_endpoints, list):
          available_endpoints_str = json.dumps(available_endpoints)
        elif isinstance(available_endpoints, str):
          available_endpoints_str = available_endpoints
        else:
          return {'success': False, 'error': f'available_endpoints must be list or JSON string, got {type(available_endpoints).__name__}'}

      # Convert example_calls list to JSON string for storage
      example_calls_str = None
      if example_calls:
        if isinstance(example_calls, list):
          example_calls_str = json.dumps(example_calls)
        elif isinstance(example_calls, str):
          example_calls_str = example_calls
        else:
          return {'success': False, 'error': f'example_calls must be list or JSON string, got {type(example_calls).__name__}'}

      api_id = str(uuid.uuid4())
      connection_name = f"{api_name.lower().replace(' ', '_')}_connection"
      secret_scope = None

      # Step 1: Create secret scope and store secret (only for authenticated APIs)
      # NOTE: Creating secret scopes requires admin permissions which apps don't have
      # For public APIs, we'll use a literal placeholder instead
      secret_scope = None

      if auth_type in ['api_key', 'bearer_token']:
        # Use separate scopes for API keys vs bearer tokens for better organization
        # Scopes should be pre-created by an admin
        if auth_type == 'api_key':
          scope_name = os.environ.get('MCP_API_KEY_SCOPE', 'mcp_api_keys')
          secret_key = api_name  # Simple: just the API name
        else:  # bearer_token
          scope_name = os.environ.get('MCP_BEARER_TOKEN_SCOPE', 'mcp_bearer_tokens')
          secret_key = api_name  # Simple: just the API name
        
        # Try to create the scope (will succeed if it doesn't exist and user has perms)
        # If it fails, we'll try to use it anyway (assuming it was pre-created)
        scope_result = _create_secret_scope(scope_name)
        
        if not scope_result.get('success'):
          print(f"⚠️  Could not create secret scope '{scope_name}': {scope_result.get('error')}")
          print(f"⚠️  Assuming scope was pre-created by admin. Attempting to store secret...")
        
        print(f"🔐 [register_api] About to store secret:")
        print(f"    Scope: {scope_name}")
        print(f"    Key: {secret_key}")
        print(f"    Value length: {len(secret_value)} chars")
        
        secret_result = _store_secret(scope_name, secret_key, secret_value)
        
        print(f"🔐 [register_api] Secret storage result: {secret_result}")
        
        if not secret_result.get('success'):
          scope_type = "API keys" if auth_type == 'api_key' else "bearer tokens"
          print(f"❌ [register_api] SECRET STORAGE FAILED!")
          return {
            'success': False,
            'error': f"Failed to store secret: {secret_result.get('error')}",
            'help': (
              f"Secret scope '{scope_name}' (for {scope_type}) may not exist or the app's service principal doesn't have WRITE permission.\n\n"
              f"Please ask an admin to run the setup script:\n"
              f"  ./setup_shared_secrets.sh\n\n"
              f"Or manually:\n"
              f"1. Create the scope: databricks secrets create-scope {scope_name}\n"
              f"2. Grant the app's service principal WRITE access:\n"
              f"   databricks secrets put-acl {scope_name} <app-service-principal-id> WRITE\n"
              f"3. Redeploy the app: ./deploy.sh\n\n"
              f"Find your service principal ID: Databricks UI → Compute → Apps → Your App\n\n"
              f"Or set custom scope names via environment variables:\n"
              f"  - MCP_API_KEY_SCOPE (current: {os.environ.get('MCP_API_KEY_SCOPE', 'mcp_api_keys')})\n"
              f"  - MCP_BEARER_TOKEN_SCOPE (current: {os.environ.get('MCP_BEARER_TOKEN_SCOPE', 'mcp_bearer_tokens')})"
            )
          }
        
        print(f"✅ Stored secret in {auth_type} scope: {scope_name}/{secret_key}")
        secret_scope = scope_name
      # For public APIs (auth_type='none'), we don't create secrets at all

      # Step 2: Drop existing connection if it exists (to handle auth type changes)
      print(f"🗑️  Dropping connection '{connection_name}' if it exists...")
      drop_sql = f"DROP CONNECTION {connection_name};"
      try:
        w = get_workspace_client()
        drop_result = w.statement_execution.execute_statement(
          warehouse_id=warehouse_id,
          statement=drop_sql,
          catalog=catalog,
          schema=schema,
          wait_timeout="30s"
        )
        if drop_result.status and drop_result.status.state.value == "SUCCEEDED":
          print(f"✅ Dropped existing connection")
      except Exception as e:
        # Connection doesn't exist or other error - that's OK, we'll create it fresh
        print(f"⚠️  Could not drop connection (likely doesn't exist): {str(e)[:200]}")
        # Continue anyway

      # Step 3: Create HTTP connection via SQL
      create_sql = _create_http_connection_sql(
        connection_name=connection_name,
        host=host,
        base_path=base_path,
        auth_type=auth_type,
        catalog=catalog,
        schema=schema,
        api_name=api_name,  # Always pass api_name (needed for secret scope reference)
        port=port,
        description=description
      )

      sql_result = _execute_create_connection_sql(create_sql, warehouse_id, catalog, schema)
      if not sql_result.get('success'):
        return {'success': False, 'error': f"Failed to create connection: {sql_result.get('error')}"}

      # Step 3: Register in database
      w = get_workspace_client()
      user_email = w.current_user.me().user_name
      table_name = f'{catalog}.{schema}.api_http_registry'
      now = datetime.now(timezone.utc).isoformat()

      def escape_sql_string(s):
        if s is None:
          return None
        return s.replace("'", "''").replace("\\", "\\\\")

      insert_query = f"""
INSERT INTO {table_name}
(api_id, api_name, description, connection_name, host, base_path,
 auth_type, secret_scope, documentation_url, available_endpoints, example_calls,
 status, user_who_requested, created_at, modified_date)
VALUES (
  '{api_id}',
  '{escape_sql_string(api_name)}',
  '{escape_sql_string(description)}',
  '{connection_name}',
  '{host}',
  {f"'{escape_sql_string(base_path)}'" if base_path else 'NULL'},
  '{auth_type}',
  {f"'{secret_scope}'" if secret_scope else 'NULL'},
  {f"'{escape_sql_string(documentation_url)}'" if documentation_url else 'NULL'},
  {f"'{escape_sql_string(available_endpoints_str)}'" if available_endpoints_str else 'NULL'},
  {f"'{escape_sql_string(example_calls_str)}'" if example_calls_str else 'NULL'},
  'registered',
  '{user_email}',
  '{now}',
  '{now}'
)
"""

      result = _execute_sql_query(insert_query, warehouse_id, catalog=None, schema=None, limit=1)

      if not result.get('success'):
        return {'success': False, 'error': f"Failed to insert into registry: {result.get('error')}"}

      return {
        'success': True,
        'api_id': api_id,
        'api_name': api_name,
        'connection_name': connection_name,
        'auth_type': auth_type,
        'secret_scope': secret_scope,
        'message': f'✅ Successfully registered API "{api_name}"',
        'next_steps': [
          f'Call API: call_parameterized_api(api_id="{api_id}", warehouse_id="...", params={{...}})',
          f'List APIs: check_api_http_registry(warehouse_id="...", catalog="{catalog}", schema="{schema}")'
        ]
      }

    except Exception as e:
      print(f'❌ Error registering API: {str(e)}')
      return {'success': False, 'error': str(e)}

  @mcp_server.tool
  def register_api(
    api_name: str,
    description: str,
    host: str,
    auth_type: str,
    warehouse_id: str,
    catalog: str,
    schema: str,
    base_path: str = '',
    secret_value: str = None,
    available_endpoints: list = None,
    example_calls: list = None,
    documentation_url: str = None,
    port: int = 443
  ) -> dict:
    """Register an API with automatic connection and secret setup.

    NEW ARCHITECTURE: Register API ONCE (host + base_path), call dynamically later!
    No need to register individual endpoints - just register the API and call any path at runtime.

    This tool supports three authentication types:
    - 'none': Public API with no authentication
    - 'api_key': API key passed as query parameter (e.g., FRED API)
    - 'bearer_token': Bearer token in Authorization header (e.g., GitHub API)

    The tool automatically:
    1. Creates secret scope (if auth required)
    2. Stores secret (if auth required)
    3. Creates UC HTTP connection via SQL
    4. Registers API metadata in registry table

    Args:
        api_name: Unique name for the API (e.g., "github_api", "fred_api")
        description: What the API does
        host: API host (e.g., "api.github.com")
        auth_type: 'none', 'api_key', or 'bearer_token'
        warehouse_id: SQL warehouse ID
        catalog: Catalog name
        schema: Schema name
        base_path: Base path for API (optional, e.g., "/v1" or "/api" or "")
        secret_value: API key or bearer token (required if auth_type != 'none')
        available_endpoints: INFORMATIONAL ONLY - List of dicts with path/description/method
            Example: [{"path": "/repos", "description": "Repository operations", "method": "GET"},
                      {"path": "/user", "description": "User operations", "method": "GET"}]
        example_calls: INFORMATIONAL ONLY - List of dicts with concrete usage examples
            Example: [{"description": "Get a repo", "path": "/repos/databricks/mlflow", "params": {"type": "public"}},
                      {"description": "List user repos", "path": "/user/repos", "params": {}}]
        documentation_url: API docs URL (optional)
        port: Connection port (default: 443)

    Returns:
        Dictionary with registration results
        
    Example:
        register_api(
            api_name="github_api",
            description="GitHub REST API for repository operations",
            host="api.github.com",
            auth_type="bearer_token",
            warehouse_id="abc123",
            catalog="main",
            schema="apis",
            base_path="",
            available_endpoints=[
                {"path": "/repos", "description": "Repository operations", "method": "GET"},
                {"path": "/user", "description": "User operations", "method": "GET"}
            ],
            example_calls=[
                {"description": "Get repo", "path": "/repos/databricks/mlflow", "params": {}},
                {"description": "List user repos", "path": "/user/repos", "params": {"type": "public"}}
            ]
        )
        
        Then call dynamically:
        execute_api_call(api_name="github_api", path="/repos/databricks/mlflow", ...)
        execute_api_call(api_name="github_api", path="/user/repos", ...)
        execute_api_call(api_name="github_api", path="/orgs/databricks/members", ...)
    """
    return _register_api_impl(
      api_name=api_name,
      description=description,
      host=host,
      auth_type=auth_type,
      warehouse_id=warehouse_id,
      catalog=catalog,
      schema=schema,
      base_path=base_path,
      secret_value=secret_value,
      available_endpoints=available_endpoints,
      example_calls=example_calls,
      documentation_url=documentation_url,
      port=port
    )

  @mcp_server.tool
  def execute_api_call(
    api_name: str,
    path: str,
    warehouse_id: str,
    catalog: str,
    schema: str,
    http_method: str = 'GET',
    params: dict = None,
    headers: dict = None
  ) -> dict:
    """Execute an API call dynamically with any path.
    
    This is the core tool for calling registered APIs. After an API is registered once,
    you can call ANY path without needing to register each endpoint separately.
    
    ARCHITECTURE: Lookup API by name → Get connection → Call with dynamic path
    
    Args:
        api_name: Name of the registered API (e.g., "github_api", "fred_api")
        path: Dynamic path to call (e.g., "/repos/databricks/mlflow", "/user/repos", "/series/GDPC1")
        warehouse_id: SQL warehouse ID
        catalog: Catalog name where registry table is located
        schema: Schema name where registry table is located
        http_method: HTTP method (default: GET)
        params: Query parameters as dict (e.g., {"type": "public", "per_page": "10"})
        headers: Additional HTTP headers as dict (optional)
    
    Returns:
        Dictionary with API response
        
    Example:
        # After registering github_api once:
        execute_api_call(
            api_name="github_api",
            path="/repos/databricks/mlflow",
            warehouse_id="abc123",
            catalog="main",
            schema="apis"
        )
        
        # Call a different path - no need to register!
        execute_api_call(
            api_name="github_api",
            path="/user/repos",
            warehouse_id="abc123",
            catalog="main",
            schema="apis",
            params={"type": "public"}
        )
    """
    try:
      import json
      
      # Step 1: Look up API in registry
      table_name = f'`{catalog}`.`{schema}`.`api_http_registry`'
      lookup_query = f"""
SELECT connection_name, auth_type, secret_scope, host, base_path, available_endpoints, example_calls
FROM {table_name}
WHERE api_name = '{api_name}'
LIMIT 1
"""
      
      result = _execute_sql_query(lookup_query, warehouse_id, catalog=None, schema=None, limit=1)
      
      if not result.get('success'):
        return {'success': False, 'error': f"Failed to lookup API '{api_name}': {result.get('error')}"}
      
      # _execute_sql_query returns data as {'columns': [...], 'rows': [...]}
      rows = result.get('data', {}).get('rows', [])
      if not rows or len(rows) == 0:
        return {
          'success': False,
          'error': f"API '{api_name}' not found in registry. Please register it first using register_api().",
          'hint': "Check available APIs with check_api_http_registry()"
        }
      
      api_info = rows[0]
      connection_name = api_info['connection_name']
      auth_type = api_info['auth_type']
      secret_scope = api_info['secret_scope']
      base_path = api_info.get('base_path', '') or ''  # Get base_path from registry (for reference only)
      
      # IMPORTANT: The HTTP connection already has base_path configured in its OPTIONS!
      # We should NOT prepend base_path to the dynamic path - the connection does that automatically.
      # Just use the dynamic path directly.
      
      print(f"📡 Calling API: {api_name}")
      print(f"   Connection: {connection_name}")
      print(f"   Base Path (in connection): {base_path}")
      print(f"   Dynamic Path: {path}")
      print(f"   Method: {http_method}")
      print(f"   Auth: {auth_type}")
      
      # Step 2: Build SQL query using http_request() function
      # The connection already has auth configured, so we just call it
      
      # Build params map - use NULL if empty (map() creates MAP<VOID,VOID> which causes type errors)
      params_sql = "NULL"
      if params:
        param_pairs = []
        for key, value in params.items():
          if isinstance(value, str):
            param_pairs.append(f"'{key}', '{value}'")
          else:
            param_pairs.append(f"'{key}', cast({value} as string)")
        params_sql = f"map({', '.join(param_pairs)})"
      
      # Build headers map - use NULL if empty (map() creates MAP<VOID,VOID> which causes type errors)
      headers_sql = "NULL"
      if headers:
        header_pairs = []
        for key, value in headers.items():
          header_pairs.append(f"'{key}', '{value}'")
        headers_sql = f"map({', '.join(header_pairs)})"
      
      # Build the http_request SQL
      # NOTE: Connection already has base_path configured, so we pass ONLY the dynamic path
      call_sql = f"""
SELECT http_request(
  conn => '{connection_name}',
  method => '{http_method}',
  path => '{path}',
  params => {params_sql},
  headers => {headers_sql}
) as response
"""
      
      print(f"=" * 80)
      print(f"🔍 EXECUTING SQL QUERY:")
      print(call_sql)
      print(f"=" * 80)
      
      # Step 3: Execute the API call
      call_result = _execute_sql_query(call_sql, warehouse_id, catalog=None, schema=None, limit=1)
      
      if not call_result.get('success'):
        error_msg = call_result.get('error')
        print(f"❌ SQL execution failed: {error_msg}")
        return {
          'success': False,
          'error': f"API call failed: {error_msg}",
          'sql_query': call_sql,
          'path': path
        }
      
      # _execute_sql_query returns data as {'columns': [...], 'rows': [...]}
      response_rows = call_result.get('data', {}).get('rows', [])
      if not response_rows or len(response_rows) == 0:
        print(f"❌ No response rows from API")
        return {
          'success': False,
          'error': "No response from API",
          'sql_query': call_sql,
          'path': path
        }
      
      response_data = response_rows[0].get('response', '')
      
      # Try to parse JSON response
      try:
        response_json = json.loads(response_data)
        
        # Check if response indicates an error (4xx, 5xx, etc.)
        status_code = response_json.get('status_code', '200')
        status_code_int = int(status_code) if isinstance(status_code, str) else status_code
        
        # Handle specific error codes
        if status_code == '401' or status_code_int == 401:
          print(f"❌ API returned 401 - Unauthorized: {path}")
          return {
            'success': False,
            'error': f"401 Unauthorized - Authentication failed. Check your bearer token/API key in secret scope '{secret_scope}'",
            'status_code': 401,
            'api_name': api_name,
            'base_path': base_path,
            'path': path,
            'method': http_method,
            'auth_type': auth_type,
            'secret_scope': secret_scope,
            'sql_query': call_sql,
            'response': response_json,
            'hint': f"Verify secret exists: databricks secrets list --scope {secret_scope}"
          }
        elif status_code == '403' or status_code_int == 403:
          print(f"❌ API returned 403 - Forbidden: {path}")
          return {
            'success': False,
            'error': f"403 Forbidden - Access denied. Check your credentials and permissions.",
            'status_code': 403,
            'api_name': api_name,
            'base_path': base_path,
            'path': path,
            'method': http_method,
            'sql_query': call_sql,
            'response': response_json
          }
        elif status_code == '404' or status_code_int == 404:
          print(f"⚠️  API returned 404 - Path not found: {path}")
          return {
            'success': False,
            'error': f"404 Not Found - The path '{path}' does not exist on this API",
            'status_code': 404,
            'api_name': api_name,
            'base_path': base_path,
            'path': path,
            'method': http_method,
            'sql_query': call_sql,
            'response': response_json
          }
        elif status_code_int >= 400:
          print(f"❌ API returned error status {status_code}: {path}")
          return {
            'success': False,
            'error': f"HTTP {status_code} Error - API request failed",
            'status_code': status_code_int,
            'api_name': api_name,
            'base_path': base_path,
            'path': path,
            'method': http_method,
            'sql_query': call_sql,
            'response': response_json
          }
        
        # Success response (2xx status codes)
        print(f"✅ API call successful (status: {status_code})")
        return {
          'success': True,
          'api_name': api_name,
          'base_path': base_path,
          'path': path,
          'method': http_method,
          'status_code': status_code,
          'sql_query': call_sql,
          'response': response_json,
          'raw_response': response_data
        }
      except:
        # Return raw response if not JSON
        print(f"⚠️  Response is not JSON, returning raw data")
        return {
          'success': True,
          'api_name': api_name,
          'base_path': base_path,
          'path': path,
          'method': http_method,
          'sql_query': call_sql,
          'response': response_data
        }
    
    except Exception as e:
      print(f'❌ Error executing API call: {str(e)}')
      import traceback
      traceback.print_exc()
      return {'success': False, 'error': str(e)}

  # Note: Old connection management tools deprecated in favor of new register_api
  # which handles connection creation automatically

  @mcp_server.tool
  def list_http_connections() -> dict:
    """List all Unity Catalog HTTP connections the user has access to.

    Returns:
        Dictionary with list of available HTTP connections
    """
    try:
      w = get_workspace_client()

      connections = []
      for conn in w.connections.list():
        if conn.connection_type == ConnectionType.HTTP:
          # Get detailed info
          conn_detail = w.connections.get(conn.name)
          connections.append({
            'name': conn_detail.name,
            'connection_type': conn_detail.connection_type.value,
            'comment': conn_detail.comment,
            'owner': conn_detail.owner,
            'created_at': conn_detail.created_at,
            'updated_at': conn_detail.updated_at,
            'host': conn_detail.options.get('host') if conn_detail.options else None,
            'base_path': conn_detail.options.get('base_path') if conn_detail.options else None,
          })

      return {
        'success': True,
        'connections': connections,
        'count': len(connections),
        'message': f'Found {len(connections)} HTTP connection(s)',
      }

    except Exception as e:
      print(f'❌ Error listing HTTP connections: {str(e)}')
      return {'success': False, 'error': f'Error: {str(e)}', 'connections': [], 'count': 0}

  @mcp_server.tool
  def test_http_connection(connection_name: str, path: str = "/", http_method: str = "GET") -> dict:
    """Test a Unity Catalog HTTP connection by making a sample request.

    Args:
        connection_name: Name of the UC HTTP connection to test
        path: Path to test (default: "/")
        http_method: HTTP method to use (default: "GET")

    Returns:
        Dictionary with test results
    """
    try:
      w = get_workspace_client()

      # Map string method to enum
      method_map = {
        'GET': ExternalFunctionRequestHttpMethod.GET,
        'POST': ExternalFunctionRequestHttpMethod.POST,
        'PUT': ExternalFunctionRequestHttpMethod.PUT,
        'DELETE': ExternalFunctionRequestHttpMethod.DELETE,
        'PATCH': ExternalFunctionRequestHttpMethod.PATCH,
      }

      method_enum = method_map.get(http_method.upper())
      if not method_enum:
        return {
          'success': False,
          'error': f'Invalid HTTP method: {http_method}. Must be one of: {list(method_map.keys())}',
        }

      print(f'🧪 Testing HTTP connection: {connection_name}')

      # Make test request
      response = w.serving_endpoints.http_request(
        conn=connection_name,
        method=method_enum,
        path=path,
      )

      return {
        'success': True,
        'connection_name': connection_name,
        'status_code': response.status_code if hasattr(response, 'status_code') else None,
        'is_healthy': True,
        'message': f'✅ Connection test successful for: {connection_name}',
      }

    except Exception as e:
      print(f'❌ Error testing HTTP connection: {str(e)}')
      return {
        'success': False,
        'is_healthy': False,
        'connection_name': connection_name,
        'error': f'Error: {str(e)}',
      }

  # Private helper for deleting connections
  def _delete_http_connection_impl(connection_name: str) -> dict:
    """Internal implementation for deleting UC HTTP connections."""
    try:
      w = get_workspace_client()
      w.connections.delete(connection_name)
      return {
        'success': True,
        'message': f'✅ Successfully deleted HTTP connection: {connection_name}',
      }
    except Exception as e:
      print(f'❌ Error deleting HTTP connection: {str(e)}')
      return {'success': False, 'error': f'Error: {str(e)}'}

  @mcp_server.tool
  def delete_http_connection(connection_name: str) -> dict:
    """Delete a Unity Catalog HTTP connection.

    Args:
        connection_name: Name of the connection to delete

    Returns:
        Dictionary with deletion results
    """
    return _delete_http_connection_impl(connection_name)

  # ========================================
  # API Registry Tools (using UC HTTP Connections)
  # ========================================

  @mcp_server.tool
  def check_api_http_registry(
    warehouse_id: str,
    catalog: str,
    schema: str,
    limit: int = 100
  ) -> dict:
    """Check the API HTTP Registry to see all registered APIs.

    This queries the api_http_registry table which stores API metadata.
    Credentials are securely stored in Unity Catalog HTTP Connections.

    Args:
        warehouse_id: SQL warehouse ID (required)
        catalog: Catalog name (required)
        schema: Schema name (required)
        limit: Maximum number of rows to return (default: 100)

    Returns:
        Dictionary with API registry results including:
        - List of all registered APIs
        - Connection names (NOT credentials!)
        - API configurations and metadata
    """
    if not catalog or not schema:
      return {
        'success': False,
        'error': 'catalog and schema parameters are required',
        'message': 'Please provide both catalog and schema parameters to locate the api_http_registry table',
      }

    # Build fully-qualified table name
    table_name = f'{catalog}.{schema}.api_http_registry'
    query = f'SELECT * FROM {table_name}'

    print(f'📊 Querying API HTTP registry table: {table_name}')

    result = _execute_sql_query(query, warehouse_id, catalog=None, schema=None, limit=limit)

    # Add context to the result and parse available_endpoints
    if result.get('success'):
      result['registry_info'] = {
        'catalog': catalog,
        'schema': schema,
        'table': 'api_http_registry',
        'full_table_name': table_name,
        'description': 'API Registry using Unity Catalog HTTP Connections for secure credential management',
      }
      
      # Parse and highlight available_endpoints for each API
      rows = result.get('data', {}).get('rows', [])
      for row in rows:
        # Parse available_endpoints JSON if it exists
        if row.get('available_endpoints'):
          try:
            import json
            endpoints = json.loads(row['available_endpoints'])
            row['available_endpoints_parsed'] = endpoints
            row['_endpoint_paths'] = [ep.get('path') for ep in endpoints]
          except:
            pass
        
        # Parse example_calls JSON if it exists
        if row.get('example_calls'):
          try:
            import json
            examples = json.loads(row['example_calls'])
            row['example_calls_parsed'] = examples
          except:
            pass
      
      # Add a summary for the LLM
      result['_IMPORTANT_READ_THIS'] = (
        "⚠️ BEFORE calling execute_api_call, CHECK the 'available_endpoints_parsed' field for each API. "
        "This tells you which paths are documented to exist. DO NOT guess or assume paths - use only what's listed!"
      )

    return result

  # Private helper for registering APIs
  def _register_api_with_connection_impl(
    api_name: str,
    description: str,
    connection_name: str,
    api_path: str,
    warehouse_id: str,
    catalog: str,
    schema: str,
    http_method: str = 'GET',
    request_headers: str = '{}',
    documentation_url: str = None,
    parameters: str = None,
    validate: bool = True
  ) -> dict:
    """Internal implementation for registering APIs with UC connections.

    Args:
        parameters: JSON string defining API parameters, e.g.:
            {"query_params": [{"name": "series_id", "type": "string", "required": true,
                               "description": "Series ID", "examples": ["GDPC1"]}]}
    """
    if not catalog or not schema:
      return {
        'success': False,
        'error': 'catalog and schema parameters are required',
      }

    try:
      # Get authenticated user info
      user_token = _user_token_context.get()
      if not user_token:
        headers = get_http_headers()
        user_token = headers.get('x-forwarded-access-token')

      username = 'unknown'
      if user_token:
        try:
          config = Config(host=os.environ.get('DATABRICKS_HOST'), token=user_token, auth_type='pat')
          w = WorkspaceClient(config=config)
          current_user = w.current_user.me()
          username = current_user.user_name if current_user.user_name else 'unknown'
        except Exception:
          username = 'unknown'

      # Generate unique API ID
      api_id = f'api-{str(uuid.uuid4())[:8]}'

      # Get current timestamp
      created_at = datetime.now(timezone.utc).isoformat()
      modified_date = created_at

      # Initial status
      status = 'pending'
      validation_message = 'Awaiting validation'

      # Optionally validate the connection
      if validate:
        print(f'🔍 Validating UC HTTP connection: {connection_name}')
        w = get_workspace_client()
        try:
          method_map = {
            'GET': ExternalFunctionRequestHttpMethod.GET,
            'POST': ExternalFunctionRequestHttpMethod.POST,
            'PUT': ExternalFunctionRequestHttpMethod.PUT,
            'DELETE': ExternalFunctionRequestHttpMethod.DELETE,
            'PATCH': ExternalFunctionRequestHttpMethod.PATCH,
          }
          method_enum = method_map.get(http_method.upper(), ExternalFunctionRequestHttpMethod.GET)

          response = w.serving_endpoints.http_request(
            conn=connection_name,
            method=method_enum,
            path=api_path,
          )
          status = 'valid'
          validation_message = f'✅ Connection validated successfully'
        except Exception as e:
          status = 'pending'
          validation_message = f'⚠️  Validation error: {str(e)}'

      # Escape single quotes in strings for SQL
      def escape_sql_string(s):
        return s.replace("'", "''") if s else ''

      # Build fully-qualified table name
      table_name = f'{catalog}.{schema}.api_http_registry'

      # Build INSERT query
      insert_query = f"""
INSERT INTO {table_name}
(api_id, api_name, description, connection_name, api_path,
 http_method, request_headers, documentation_url, parameters,
 status, validation_message, user_who_requested, created_at, modified_date)
VALUES (
  '{api_id}',
  '{escape_sql_string(api_name)}',
  '{escape_sql_string(description)}',
  '{escape_sql_string(connection_name)}',
  '{escape_sql_string(api_path)}',
  '{escape_sql_string(http_method.upper())}',
  '{escape_sql_string(request_headers)}',
  {f"'{escape_sql_string(documentation_url)}'" if documentation_url else 'NULL'},
  {f"'{escape_sql_string(parameters)}'" if parameters else 'NULL'},
  '{escape_sql_string(status)}',
  '{escape_sql_string(validation_message)}',
  '{escape_sql_string(username)}',
  '{created_at}',
  '{modified_date}'
)
"""

      # Execute the INSERT
      result = _execute_sql_query(insert_query, warehouse_id, catalog=None, schema=None, limit=1)

      if result.get('success'):
        return {
          'success': True,
          'api_id': api_id,
          'api_name': api_name,
          'connection_name': connection_name,
          'status': status,
          'user_who_requested': username,
          'validation_message': validation_message,
          'message': f'✅ Successfully registered API "{api_name}" using connection "{connection_name}"',
          'next_steps': [
            f'View registered APIs: check_api_http_registry()',
            f'Call the API: call_registered_api(api_id="{api_id}")',
          ],
        }
      else:
        return {
          'success': False,
          'error': f"Failed to insert into registry: {result.get('error')}",
        }

    except Exception as e:
      print(f'❌ Error registering API: {str(e)}')
      return {'success': False, 'error': f'Registration error: {str(e)}'}

  @mcp_server.tool
  def register_api_with_connection(
    api_name: str,
    description: str,
    connection_name: str,
    api_path: str,
    warehouse_id: str,
    catalog: str,
    schema: str,
    http_method: str = 'GET',
    request_headers: str = '{}',
    documentation_url: str = None,
    parameters: str = None,
    validate: bool = True
  ) -> dict:
    """DEPRECATED: Use register_api() instead.

    This tool is deprecated and kept only for backward compatibility.
    Please use register_api() which supports the new SQL-based architecture
    with three authentication types (none, api_key, bearer_token).

    Args:
        api_name: Unique name for the API
        description: Description of what the API does
        connection_name: Name of existing UC HTTP connection to use
        api_path: Base path to append to connection's base URL (without dynamic params)
        warehouse_id: SQL warehouse ID for database operations
        catalog: Catalog name (required)
        schema: Schema name (required)
        http_method: HTTP method (default: GET)
        request_headers: JSON string of additional headers (optional)
        documentation_url: URL to API documentation (optional)
        parameters: JSON string defining dynamic parameters (optional)
        validate: Whether to test the connection after registering (default: True)

    Returns:
        Dictionary with deprecation warning
    """
    return {
      'success': False,
      'error': 'DEPRECATED: register_api_with_connection() is deprecated. Please use register_api() or smart_register_with_connection() instead.',
      'deprecation_notice': 'This tool has been replaced by the new SQL-based architecture.',
      'recommended_tool': 'register_api',
      'migration_guide': {
        'old_way': 'register_api_with_connection(api_name, description, connection_name, api_path, ...)',
        'new_way': 'register_api(api_name, description, host, api_path, auth_type, secret_value, ...)',
        'example': 'register_api(api_name="fred_test", host="api.stlouisfed.org", api_path="/fred/series", auth_type="api_key", secret_value="YOUR_KEY", ...)'
      }
    }

  @mcp_server.tool
  def call_registered_api(
    api_id: str,
    warehouse_id: str,
    catalog: str,
    schema: str,
    query_params: str = None,
    additional_headers: str = None
  ) -> dict:
    """Call a registered API using its Unity Catalog HTTP connection.

    This retrieves the API metadata from the registry and makes a secure request
    using the UC HTTP connection (credentials are managed by UC, not exposed).

    Args:
        api_id: ID of the registered API to call
        warehouse_id: SQL warehouse ID to query registry
        catalog: Catalog name (required)
        schema: Schema name (required)
        query_params: Optional query parameters as URL string (e.g., "param1=value1&param2=value2")
        additional_headers: Optional additional headers as JSON string

    Returns:
        Dictionary with API response
    """
    if not catalog or not schema:
      return {
        'success': False,
        'error': 'catalog and schema parameters are required',
      }

    try:
      # Get API metadata from registry
      table_name = f'{catalog}.{schema}.api_http_registry'
      query = f"""
        SELECT api_name, connection_name, api_path, http_method, request_headers
        FROM {table_name}
        WHERE api_id = '{api_id}'
      """

      result = _execute_sql_query(query, warehouse_id, catalog=None, schema=None, limit=1)

      if not result.get('success') or not result.get('data', {}).get('rows'):
        return {
          'success': False,
          'error': f'API with id "{api_id}" not found in registry',
        }

      # Get API details
      api_row = result['data']['rows'][0]
      connection_name = api_row.get('connection_name')
      api_path = api_row.get('api_path', '')
      http_method = api_row.get('http_method', 'GET')

      # Build path for SQL http_request
      api_path_with_params = api_path
      if query_params:
        # query_params is already a URL-encoded string
        separator = '&' if '?' in api_path_with_params else '?'
        api_path_with_params = f'{api_path_with_params}{separator}{query_params}'

      # Use full connection name (catalog.schema.connection_name)
      full_connection_name = f"{catalog}.{schema}.{connection_name}"

      print(f'🌐 Calling API via SQL http_request()')
      print(f'   Connection: {full_connection_name}')
      print(f'   Path: {api_path_with_params}')
      print(f'   Method: {http_method}')

      # Build SQL query using http_request() function
      import json
      headers_map = "map('Accept', 'application/json')"
      if additional_headers:
        try:
          headers_dict = json.loads(additional_headers) if isinstance(additional_headers, str) else additional_headers
          header_pairs = [f"'{k}', '{v}'" for k, v in headers_dict.items()]
          headers_map = f"map({', '.join(header_pairs)})"
        except:
          print(f'⚠️  Could not parse additional_headers, using default')

      sql = f"""SELECT http_request(
  conn => '{full_connection_name}',
  method => '{http_method}',
  path => '{api_path_with_params}',
  headers => {headers_map}
) as response"""

      # Execute the SQL
      w = get_workspace_client()
      sql_result = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=sql,
        wait_timeout="30s"
      )

      if not sql_result.status or not sql_result.status.state:
        return {'success': False, 'error': 'No status from SQL execution'}

      state = sql_result.status.state.value
      if state != "SUCCEEDED":
        error_msg = sql_result.status.error.message if sql_result.status.error else "Unknown error"
        return {'success': False, 'error': f'SQL http_request failed: {error_msg}', 'state': state}

      # Parse response from SQL result
      response_data = None
      if sql_result.result and sql_result.result.data_array:
        if len(sql_result.result.data_array) > 0 and len(sql_result.result.data_array[0]) > 0:
          response_str = sql_result.result.data_array[0][0]
          try:
            response_data = json.loads(response_str)
          except:
            response_data = response_str

      return {
        'success': True,
        'api_id': api_id,
        'api_name': api_row.get('api_name'),
        'connection_name': connection_name,
        'response': response_data,
        'message': '✅ API call successful via SQL',
      }

    except Exception as e:
      print(f'❌ Error calling registered API: {str(e)}')
      return {'success': False, 'error': f'Error: {str(e)}'}

  @mcp_server.tool
  def call_parameterized_api(
    api_id: str,
    warehouse_id: str,
    catalog: str,
    schema: str,
    params: str | dict = None
  ) -> dict:
    """Call a parameterized API with dynamic parameters and documentation validation.

    **NEW: This tool now fetches API documentation to validate path structure and parameters.**

    This retrieves the API from the registry, fetches its documentation (if available),
    validates the path structure against documentation, and makes the API request.

    The response includes:
    - API response data
    - Path structure used (base_path + api_path)
    - Documentation validation results (if documentation_url is available)
    - Warnings if stored path doesn't match documentation

    Args:
        api_id: ID of the registered API to call
        warehouse_id: SQL warehouse ID to query registry
        catalog: Catalog name (required)
        schema: Schema name (required)
        params: Parameter values as JSON string or dict, e.g.: '{"series_id": "GDPC1", "frequency": "q"}' or {"series_id": "GDPC1"}

    Returns:
        Dictionary with:
        - success: Boolean indicating call success
        - response: API response data
        - path_used: Structure showing base_path, api_path, and full_path
        - documentation_validation: (if docs available) Validation results and warnings
        - parameters_used: The parameters that were sent
    """
    if not catalog or not schema:
      return {
        'success': False,
        'error': 'catalog and schema parameters are required',
      }

    try:
      import json

      # Get API metadata from registry (including documentation_url for validation)
      table_name = f'{catalog}.{schema}.api_http_registry'
      query = f"""
        SELECT api_name, connection_name, host, base_path, api_path, http_method,
               parameters, auth_type, secret_scope, documentation_url
        FROM {table_name}
        WHERE api_id = '{api_id}'
      """

      result = _execute_sql_query(query, warehouse_id, catalog=None, schema=None, limit=1)

      if not result.get('success') or not result.get('data', {}).get('rows'):
        return {
          'success': False,
          'error': f'API with id "{api_id}" not found in registry',
        }

      # Get API details
      api_row = result['data']['rows'][0]
      api_name = api_row.get('api_name')
      connection_name = api_row.get('connection_name')
      host = api_row.get('host', '')
      base_path = api_row.get('base_path', '')
      api_path = api_row.get('api_path', '')
      http_method = api_row.get('http_method', 'GET')
      parameters_json = api_row.get('parameters')
      auth_type = api_row.get('auth_type', 'none')
      secret_scope = api_row.get('secret_scope')
      documentation_url = api_row.get('documentation_url')

      # CRITICAL: Fetch documentation to validate path structure
      doc_insights = None
      if documentation_url:
        print(f'📚 Fetching documentation to validate path structure: {documentation_url}')
        doc_result = _fetch_api_documentation_impl(documentation_url=documentation_url)

        if doc_result.get('success'):
          doc_insights = {
            'found_urls': doc_result.get('found_urls', []),
            'found_paths': doc_result.get('found_paths', []),
            'found_params': doc_result.get('found_params', []),
            'content_preview': doc_result.get('content_preview', '')[:500]
          }
          print(f'✅ Documentation fetched: Found {len(doc_insights["found_paths"])} endpoint paths')

          # Warn if stored api_path doesn't appear in documentation
          full_expected_path = f"{base_path}{api_path}" if base_path else api_path
          path_matches = [p for p in doc_insights['found_paths'] if api_path in p or p in full_expected_path]

          if not path_matches and doc_insights['found_paths']:
            print(f'⚠️  WARNING: Stored api_path "{api_path}" not found in documentation!')
            print(f'   Documentation suggests these paths: {doc_insights["found_paths"][:3]}')
        else:
          print(f'⚠️  Could not fetch documentation: {doc_result.get("error")}')

      # Parse provided parameters - accept both dict and JSON string
      provided_params = {}
      if params:
        if isinstance(params, dict):
          # Already a dictionary, use directly
          provided_params = params
        elif isinstance(params, str):
          # JSON string, parse it
          try:
            provided_params = json.loads(params)
          except json.JSONDecodeError:
            return {
              'success': False,
              'error': f'Invalid params JSON: {params}',
            }
        else:
          return {
            'success': False,
            'error': f'params must be a dict or JSON string, got {type(params).__name__}',
          }

      # Parse parameter definitions
      param_defs = {}
      if parameters_json:
        try:
          param_config = json.loads(parameters_json)
          query_params_defs = param_config.get('query_params', [])
          param_defs = {p['name']: p for p in query_params_defs}
        except json.JSONDecodeError:
          print(f'⚠️  Warning: Could not parse parameter definitions')

      # Validate required parameters
      missing_required = []
      for param_name, param_def in param_defs.items():
        if param_def.get('required') and param_name not in provided_params:
          missing_required.append(param_name)

      if missing_required:
        return {
          'success': False,
          'error': f'Missing required parameters: {", ".join(missing_required)}',
          'parameter_definitions': param_defs,
        }

      # Build SQL http_request() call with proper auth handling
      # Use full connection name (catalog.schema.connection_name)
      full_connection_name = f"{catalog}.{schema}.{connection_name}"

      print(f'🌐 Calling parameterized API via SQL http_request()')
      print(f'   Connection: {full_connection_name}')
      print(f'   Path: {api_path}')
      print(f'   Auth Type: {auth_type}')
      print(f'   Parameters: {provided_params}')

      # Build params map for SQL
      param_entries = []

      # For api_key auth, add secret reference to params
      if auth_type == 'api_key':
        if not secret_scope:
          return {'success': False, 'error': 'API key auth configured but no secret scope found'}
        # Use the secret scope from database (stored during registration)
        secret_key = api_name  # Simple: just the API name
        param_entries.append(f"'api_key', secret('{secret_scope}', '{secret_key}')")

      # Add user-provided parameters
      for key, value in provided_params.items():
        # Escape single quotes in values
        escaped_value = str(value).replace("'", "''")
        param_entries.append(f"'{key}', '{escaped_value}'")

      params_str = ",\n    ".join(param_entries) if param_entries else ""
      params_map = f"map(\n    {params_str}\n  )" if params_str else "NULL"

      # Build the SQL query
      sql = f"""SELECT http_request(
  conn => '{full_connection_name}',
  method => '{http_method}',
  path => '{api_path}',
  params => {params_map},
  headers => map('Accept', 'application/json')
) as response"""

      # Execute the SQL
      w = get_workspace_client()
      sql_result = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=sql,
        wait_timeout="30s"
      )

      if not sql_result.status or not sql_result.status.state:
        return {'success': False, 'error': 'No status from SQL execution'}

      state = sql_result.status.state.value
      if state != "SUCCEEDED":
        error_msg = sql_result.status.error.message if sql_result.status.error else "Unknown error"
        return {'success': False, 'error': f'SQL http_request failed: {error_msg}', 'state': state}

      # Parse response from SQL result
      response_data = None
      if sql_result.result and sql_result.result.data_array:
        if len(sql_result.result.data_array) > 0 and len(sql_result.result.data_array[0]) > 0:
          response_str = sql_result.result.data_array[0][0]
          try:
            response_data = json.loads(response_str)
          except:
            response_data = response_str

      result_data = {
        'success': True,
        'api_id': api_id,
        'api_name': api_name,
        'connection_name': connection_name,
        'auth_type': auth_type,
        'path_used': {
          'base_path': base_path,
          'api_path': api_path,
          'full_path': f"{base_path}{api_path}" if base_path else api_path
        },
        'parameters_used': provided_params,
        'response': response_data,
        'message': '✅ Parameterized API call successful via SQL',
      }

      # Include documentation insights if fetched
      if doc_insights:
        result_data['documentation_validation'] = {
          'documentation_url': documentation_url,
          'found_paths_in_docs': doc_insights['found_paths'],
          'found_params_in_docs': doc_insights['found_params'],
          'warning': (
            f'⚠️  Stored api_path may not match documentation. Check found_paths_in_docs.'
            if doc_insights['found_paths'] and api_path not in str(doc_insights['found_paths'])
            else None
          )
        }

      return result_data

    except Exception as e:
      print(f'❌ Error calling parameterized API: {str(e)}')
      return {'success': False, 'error': f'Error: {str(e)}'}

  # ========================================
  # API Discovery & Smart Registration Tools
  # ========================================

  # Private helper for documentation fetching (can be called from other functions)
  def _fetch_api_documentation_impl(documentation_url: str, timeout: int = 10) -> dict:
    """Internal implementation for fetching API documentation.

    This is a private helper that can be called from other tools without MCP tool conflicts.
    """
    try:
      import requests
      import re

      print(f'📚 Fetching API documentation from: {documentation_url}')
      response = requests.get(documentation_url, timeout=timeout)

      if response.status_code != 200:
        return {
          'success': False,
          'error': f'Failed to fetch documentation (status {response.status_code})'
        }

      content = response.text

      # Extract common API patterns from documentation
      # Look for URL patterns (http/https URLs)
      url_pattern = r'https?://[^\s<>"\']+(?:/[^\s<>"\']*)?'
      found_urls = re.findall(url_pattern, content)

      # Look for API endpoint paths
      path_pattern = r'/api/[^\s<>"\']+|/v\d+/[^\s<>"\']+|/[a-z_]+/[a-z_]+'
      found_paths = re.findall(path_pattern, content)

      # Look for parameter names (common API parameter patterns)
      param_patterns = ['apikey', 'api_key', 'token', 'function', 'symbol', 'query']
      found_params = []
      for param in param_patterns:
        if param in content.lower():
          found_params.append(param)

      # Extract code examples (often in <code>, <pre>, or ``` blocks)
      code_pattern = r'<code>(.*?)</code>|<pre>(.*?)</pre>|```(.*?)```'
      code_examples = re.findall(code_pattern, content, re.DOTALL)

      return {
        'success': True,
        'url': documentation_url,
        'content_preview': content[:1000],
        'found_urls': list(set(found_urls))[:10],
        'found_paths': list(set(found_paths))[:10],
        'found_params': found_params,
        'code_examples_count': len(code_examples),
        'content_length': len(content)
      }

    except Exception as e:
      print(f'❌ Error fetching documentation: {str(e)}')
      return {'success': False, 'error': f'Error: {str(e)}'}

  @mcp_server.tool
  def fetch_api_documentation(documentation_url: str, timeout: int = 10) -> dict:
    """Fetch and parse API documentation from a URL.

    This tool automatically fetches API documentation pages and extracts
    useful information like endpoint URLs, parameters, and code examples.
    Use this when the user provides a documentation link.

    Args:
        documentation_url: URL of the API documentation page
        timeout: Request timeout in seconds (default: 10)

    Returns:
        Dictionary with:
        - success: Boolean indicating if fetch succeeded
        - content_preview: Preview of documentation content
        - found_urls: List of API URLs found in the documentation
        - found_paths: List of API endpoint paths found
        - found_params: List of common parameter names found
        - code_examples_count: Number of code examples in the docs
    """
    return _fetch_api_documentation_impl(documentation_url, timeout)

  @mcp_server.tool
  def discover_api_endpoint(endpoint_url: str, api_key: str = None, timeout: int = 10) -> dict:
    """Discover API endpoint requirements and capabilities.

    This tool analyzes an API endpoint to determine authentication requirements
    and what data the API provides. Use this before registering an API to validate it works.

    Args:
        endpoint_url: The full URL of the API endpoint to discover
        api_key: Optional API key if the endpoint requires authentication
        timeout: Request timeout in seconds (default: 10)

    Returns:
        Dictionary with discovery results including:
        - requires_auth: Boolean indicating if API key is needed
        - is_accessible: Whether the endpoint is reachable
        - auth_method: Detected authentication method
        - sample_data: Sample response from the API
        - next_steps: Recommendations for registration
    """
    try:
      import requests
      from urllib.parse import urlparse, parse_qs

      # Parse the URL
      parsed_url = urlparse(endpoint_url)
      query_params = parse_qs(parsed_url.query)
      base_url = f'{parsed_url.scheme}://{parsed_url.netloc}{parsed_url.path}'
      host = parsed_url.netloc

      print(f'🔍 Discovering API endpoint: {endpoint_url}')

      # First attempt: Call without API key
      requires_auth = False
      auth_method = 'none'
      is_accessible = False
      sample_data = None

      try:
        response_no_auth = requests.get(endpoint_url, timeout=timeout)
        initial_status = response_no_auth.status_code

        if initial_status == 200:
          is_accessible = True
          requires_auth = False
          try:
            sample_data = response_no_auth.json()
          except:
            sample_data = response_no_auth.text[:500]
        elif initial_status in [401, 403]:
          requires_auth = True
          auth_method = 'bearer_token'

        # Check response content for auth indicators
        response_lower = str(response_no_auth.text).lower()
        if any(keyword in response_lower for keyword in ['api key', 'apikey', 'api_key', 'unauthorized']):
          requires_auth = True

      except Exception as e:
        return {
          'success': False,
          'error': f'Failed to reach endpoint: {str(e)}',
          'next_steps': ['Check if the URL is correct', 'Verify internet connectivity'],
        }

      # If API key provided, try with authentication
      if api_key and requires_auth:
        print(f'🔑 Testing with provided API key...')

        # Try common auth patterns
        auth_attempts = [
          {'params': {**query_params, 'apikey': [api_key]}},
          {'params': {**query_params, 'api_key': [api_key]}},
          {'headers': {'Authorization': f'Bearer {api_key}'}},
        ]

        for attempt in auth_attempts:
          try:
            params = {k: v[0] if isinstance(v, list) else v for k, v in attempt.get('params', {}).items()}
            auth_response = requests.get(
              base_url,
              params=params,
              headers=attempt.get('headers', {}),
              timeout=timeout
            )

            if auth_response.status_code == 200:
              is_accessible = True
              try:
                sample_data = auth_response.json()
              except:
                sample_data = auth_response.text[:500]

              # Determine auth method
              if 'Authorization' in attempt.get('headers', {}):
                auth_method = 'bearer_token'
              else:
                auth_method = 'api_key_param'
              break
          except:
            continue

      # Build recommendations
      next_steps = []
      if is_accessible:
        if requires_auth and api_key:
          next_steps = [
            '✅ API is accessible with provided credentials',
            f'Ready to register! Use smart_register_with_connection() to create UC connection and register API',
          ]
        elif not requires_auth:
          next_steps = [
            '✅ API is publicly accessible (no auth required)',
            'You can register this API, but it may have rate limits',
          ]
        else:
          next_steps = [
            '⚠️  API requires authentication but no API key provided',
            'Please provide an API key to test authentication',
          ]
      else:
        next_steps = [
          '❌ API is not accessible with provided information',
          'Check the endpoint URL and authentication requirements',
        ]

      return {
        'success': True,
        'endpoint_url': endpoint_url,
        'host': host,
        'is_accessible': is_accessible,
        'requires_auth': requires_auth,
        'auth_method': auth_method,
        'sample_data': sample_data,
        'next_steps': next_steps,
      }

    except Exception as e:
      print(f'❌ Error discovering API: {str(e)}')
      return {
        'success': False,
        'error': f'Discovery error: {str(e)}',
        'next_steps': ['Check the endpoint URL', 'Verify the API is accessible'],
      }

  @mcp_server.tool
  def smart_register_with_connection(
    api_name: str,
    description: str,
    endpoint_url: str,
    documentation_url: str,
    warehouse_id: str,
    catalog: str,
    schema: str,
    api_key: str = None,
    http_method: str = 'GET'
  ) -> dict:
    """Smart one-step API registration with documentation-based parsing.

    **CRITICAL: This tool requires documentation_url to properly extract the API structure.**

    This tool:
    1. Fetches and parses the API documentation
    2. Analyzes the documentation to extract URL structure
    3. Returns the parsed information for you to use with register_api()

    **WORKFLOW:**
    1. Call this function with documentation_url
    2. Analyze the returned documentation insights (found_urls, found_paths, content_preview)
    3. Determine the correct host, base_path, and api_path split
    4. Call register_api() directly with the correct parameters

    For public APIs (no authentication), simply omit the api_key parameter.

    Args:
        api_name: Unique name for the API (e.g., "fred_economic_data")
        description: Description of what the API does
        endpoint_url: Full API endpoint URL (e.g., "https://api.stlouisfed.org/fred/series/observations")
        documentation_url: REQUIRED - URL to API documentation (for parsing structure)
        warehouse_id: SQL warehouse ID for database operations
        catalog: Catalog name (required)
        schema: Schema name (required)
        api_key: API key or bearer token for authentication (optional for public APIs)
        http_method: HTTP method (default: GET)

    Returns:
        Dictionary with documentation parsing results and guidance for using register_api()
    """
    try:
      from urllib.parse import urlparse, parse_qs, urlencode

      print(f'🚀 Smart registration starting for: {api_name}')
      print(f'📚 Documentation-first workflow: Fetching API documentation...')

      # Step 1: MANDATORY - Fetch and parse documentation FIRST
      doc_result = _fetch_api_documentation_impl(documentation_url=documentation_url)

      if not doc_result.get('success'):
        return {
          'success': False,
          'error': f'Failed to fetch documentation: {doc_result.get("error")}',
          'guidance': 'Cannot proceed without documentation. Please provide a valid documentation_url.'
        }

      # Step 2: Parse endpoint URL for basic structure
      parsed = urlparse(endpoint_url)
      host = parsed.netloc  # Just the host, no protocol

      # Parse query string to extract and remove API key
      query_params = parse_qs(parsed.query) if parsed.query else {}
      api_key_from_url = None
      sensitive_param_names = ['api_key', 'apikey', 'key', 'token', 'access_token']

      for param_name in sensitive_param_names:
        if param_name in query_params:
          api_key_from_url = query_params[param_name][0]
          del query_params[param_name]
          print(f'🔑 Extracted API key from URL parameter: {param_name}')
          break

      # Use extracted key if no explicit api_key was provided
      secret_value = api_key or api_key_from_url

      # Determine auth type
      auth_type = 'api_key' if secret_value else 'none'

      print(f'📍 Endpoint URL provided: {endpoint_url}')
      print(f'📄 Documentation fetched successfully')
      print(f'🔍 Found {len(doc_result.get("found_urls", []))} URLs and {len(doc_result.get("found_paths", []))} paths in documentation')

      # Step 3: Return documentation insights and guidance for LLM
      return {
        'success': True,
        'action_required': 'ANALYZE_DOCS_AND_CALL_REGISTER_API',
        'message': (
          '✅ Documentation fetched successfully. '
          'You MUST now analyze the documentation and call register_api() with the correct parameters.'
        ),
        'documentation_insights': {
          'found_urls': doc_result.get('found_urls', []),
          'found_paths': doc_result.get('found_paths', []),
          'found_params': doc_result.get('found_params', []),
          'content_preview': doc_result.get('content_preview', ''),
          'code_examples_count': doc_result.get('code_examples_count', 0)
        },
        'endpoint_url_parsed': {
          'full_url': endpoint_url,
          'host': host,
          'path': parsed.path,
          'detected_auth_type': auth_type
        },
        'next_steps': [
          '1. Analyze the documentation insights above',
          '2. Identify the correct split: host, base_path, and api_path',
          '3. Identify required parameters from documentation',
          '4. Call register_api() with the correct parameters',
          '',
          'Example:',
          'register_api(',
          f'  api_name="{api_name}",',
          f'  description="{description}",',
          '  host="extracted-host-from-docs",',
          '  base_path="/common/prefix/for/all/endpoints",',
          '  api_path="/specific/endpoint/path",',
          f'  auth_type="{auth_type}",',
          f'  warehouse_id="{warehouse_id}",',
          f'  catalog="{catalog}",',
          f'  schema="{schema}",',
          '  parameters=\'{"query_params": [...]}\',',
          f'  documentation_url="{documentation_url}"',
          ')'
        ]
      }

    except Exception as e:
      print(f'❌ Error in smart registration: {str(e)}')
      return {
        'success': False,
        'error': f'Smart registration error: {str(e)}',
      }
