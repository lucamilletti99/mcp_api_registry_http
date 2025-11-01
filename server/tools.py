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

    # Build the full query with catalog/schema if provided
    full_query = query
    if catalog and schema:
      full_query = f'USE CATALOG {catalog}; USE SCHEMA {schema}; {query}'

    print(f'🔧 Executing SQL on warehouse {warehouse_id}: {query[:100]}...')

    # Execute the query
    result = w.statement_execution.execute_statement(
      warehouse_id=warehouse_id, statement=full_query, wait_timeout='30s'
    )

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
  # Unity Catalog HTTP Connection Tools
  # ========================================

  @mcp_server.tool
  def create_http_connection(
    connection_name: str,
    host: str,
    bearer_token: str = None,
    base_path: str = "",
    port: int = 443,
    client_id: str = None,
    client_secret: str = None,
    oauth_scope: str = None,
    token_endpoint: str = None,
    comment: str = None
  ) -> dict:
    """Create a Unity Catalog HTTP connection with secure credential storage.

    This creates a managed HTTP connection in Unity Catalog that securely stores
    credentials (bearer tokens or OAuth credentials) and can be shared across users.

    Args:
        connection_name: Unique name for the connection
        host: Hostname of the API (e.g., 'www.alphavantage.co')
        bearer_token: Bearer token for token-based auth (optional)
        base_path: Base path to prepend to all requests (optional, e.g., '/query')
        port: Port number (default: 443)
        client_id: OAuth client ID (for OAuth auth)
        client_secret: OAuth client secret (for OAuth auth)
        oauth_scope: OAuth scope (for OAuth auth)
        token_endpoint: OAuth token endpoint (for OAuth auth)
        comment: Description of the connection (optional)

    Returns:
        Dictionary with connection creation results
    """
    try:
      w = get_workspace_client()

      # Build connection options
      options = {
        'host': host,
        'port': str(port),
      }

      if base_path:
        options['base_path'] = base_path

      # Add authentication options
      if bearer_token:
        options['bearer_token'] = bearer_token
        print(f'🔐 Creating HTTP connection with bearer token authentication')
      elif client_id and client_secret:
        options['client_id'] = client_id
        options['client_secret'] = client_secret
        if oauth_scope:
          options['oauth_scope'] = oauth_scope
        if token_endpoint:
          options['token_endpoint'] = token_endpoint
        print(f'🔐 Creating HTTP connection with OAuth authentication')
      else:
        return {
          'success': False,
          'error': 'Must provide either bearer_token or OAuth credentials (client_id + client_secret)',
        }

      # Create the connection
      connection = w.connections.create(
        name=connection_name,
        connection_type=ConnectionType.HTTP,
        options=options,
        comment=comment or f'HTTP connection for {host}',
      )

      return {
        'success': True,
        'connection_name': connection.name,
        'connection_type': connection.connection_type.value,
        'host': host,
        'base_path': base_path,
        'message': f'✅ Successfully created HTTP connection: {connection_name}',
        'next_steps': [
          f'Grant access: GRANT USE CONNECTION ON {connection_name} TO <user_or_group>',
          f'Register an API using this connection with: register_api_with_connection()',
        ],
      }

    except Exception as e:
      print(f'❌ Error creating HTTP connection: {str(e)}')
      return {'success': False, 'error': f'Error: {str(e)}'}

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

  @mcp_server.tool
  def delete_http_connection(connection_name: str) -> dict:
    """Delete a Unity Catalog HTTP connection.

    Args:
        connection_name: Name of the connection to delete

    Returns:
        Dictionary with deletion results
    """
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

    # Add context to the result
    if result.get('success'):
      result['registry_info'] = {
        'catalog': catalog,
        'schema': schema,
        'table': 'api_http_registry',
        'full_table_name': table_name,
        'description': 'API Registry using Unity Catalog HTTP Connections for secure credential management',
      }

    return result

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
    validate: bool = True
  ) -> dict:
    """Register an API using an existing Unity Catalog HTTP connection.

    This stores API metadata in the api_http_registry table. Credentials are
    securely managed by the UC HTTP Connection, not stored in the table.

    Args:
        api_name: Unique name for the API
        description: Description of what the API does
        connection_name: Name of existing UC HTTP connection to use
        api_path: Path to append to connection's base URL
        warehouse_id: SQL warehouse ID for database operations
        catalog: Catalog name (required)
        schema: Schema name (required)
        http_method: HTTP method (default: GET)
        request_headers: JSON string of additional headers (optional)
        documentation_url: URL to API documentation (optional)
        validate: Whether to test the connection after registering (default: True)

    Returns:
        Dictionary with registration results
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
 http_method, request_headers, documentation_url,
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
  def call_registered_api(
    api_id: str,
    warehouse_id: str,
    catalog: str,
    schema: str,
    query_params: Dict[str, str] = None,
    additional_headers: Dict[str, str] = None
  ) -> dict:
    """Call a registered API using its Unity Catalog HTTP connection.

    This retrieves the API metadata from the registry and makes a secure request
    using the UC HTTP connection (credentials are managed by UC, not exposed).

    Args:
        api_id: ID of the registered API to call
        warehouse_id: SQL warehouse ID to query registry
        catalog: Catalog name (required)
        schema: Schema name (required)
        query_params: Optional query parameters to append to path
        additional_headers: Optional additional headers to send

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

      # Build full path with query params
      full_path = api_path
      if query_params:
        from urllib.parse import urlencode
        query_string = urlencode(query_params)
        separator = '&' if '?' in full_path else '?'
        full_path = f'{full_path}{separator}{query_string}'

      # Make request using UC HTTP connection
      w = get_workspace_client()

      method_map = {
        'GET': ExternalFunctionRequestHttpMethod.GET,
        'POST': ExternalFunctionRequestHttpMethod.POST,
        'PUT': ExternalFunctionRequestHttpMethod.PUT,
        'DELETE': ExternalFunctionRequestHttpMethod.DELETE,
        'PATCH': ExternalFunctionRequestHttpMethod.PATCH,
      }
      method_enum = method_map.get(http_method.upper(), ExternalFunctionRequestHttpMethod.GET)

      print(f'🌐 Calling API via UC connection: {connection_name}')
      print(f'   Path: {full_path}')

      response = w.serving_endpoints.http_request(
        conn=connection_name,
        method=method_enum,
        path=full_path,
        headers=additional_headers,
      )

      # Parse response
      response_data = None
      if hasattr(response, 'json') and response.json:
        response_data = response.json
      elif hasattr(response, 'text'):
        response_data = response.text

      return {
        'success': True,
        'api_id': api_id,
        'api_name': api_row.get('api_name'),
        'connection_name': connection_name,
        'response': response_data,
        'message': '✅ API call successful',
      }

    except Exception as e:
      print(f'❌ Error calling registered API: {str(e)}')
      return {'success': False, 'error': f'Error: {str(e)}'}

  # ========================================
  # API Discovery & Smart Registration Tools
  # ========================================

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
    api_key: str,
    warehouse_id: str,
    catalog: str,
    schema: str,
    documentation_url: str = None,
    http_method: str = 'GET'
  ) -> dict:
    """Smart one-step API registration: creates UC connection + registers API.

    This is the easiest way to register an API. It handles:
    1. Parsing the endpoint URL to extract host and path
    2. Creating a Unity Catalog HTTP connection with secure credentials
    3. Registering the API metadata in api_http_registry
    4. Validating the connection works

    Args:
        api_name: Unique name for the API (e.g., "alphavantage_stock_api")
        description: Description of what the API does
        endpoint_url: Full API endpoint URL (e.g., "https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY")
        api_key: API key or bearer token for authentication
        warehouse_id: SQL warehouse ID for database operations
        catalog: Catalog name (required)
        schema: Schema name (required)
        documentation_url: Optional URL to API documentation
        http_method: HTTP method (default: GET)

    Returns:
        Dictionary with registration results including connection name and API ID
    """
    try:
      from urllib.parse import urlparse

      print(f'🚀 Smart registration starting for: {api_name}')

      # Step 1: Parse endpoint URL
      parsed = urlparse(endpoint_url)
      host = parsed.netloc

      # Build path (path + query string)
      path = parsed.path
      if parsed.query:
        path = f'{path}?{parsed.query}'

      base_path = parsed.path.rsplit('/', 1)[0] if '/' in parsed.path else ''

      print(f'📍 Parsed endpoint - Host: {host}, Path: {path}')

      # Step 2: Create UC HTTP Connection
      connection_name = f'{api_name.lower().replace(" ", "_")}_connection'

      print(f'🔐 Creating UC HTTP connection: {connection_name}')

      w = get_workspace_client()
      connection_result = create_http_connection(
        connection_name=connection_name,
        host=host,
        bearer_token=api_key,
        base_path=base_path,
        comment=f'HTTP connection for {api_name}'
      )

      if not connection_result.get('success'):
        return {
          'success': False,
          'error': f"Failed to create UC connection: {connection_result.get('error')}",
          'step_failed': 'create_connection',
        }

      # Step 3: Register API in registry
      print(f'📝 Registering API in registry...')

      # Extract just the path part (remove base_path)
      api_path = path
      if base_path and path.startswith(base_path):
        api_path = path[len(base_path):]

      registration_result = register_api_with_connection(
        api_name=api_name,
        description=description,
        connection_name=connection_name,
        api_path=api_path,
        warehouse_id=warehouse_id,
        catalog=catalog,
        schema=schema,
        http_method=http_method,
        documentation_url=documentation_url,
        validate=True
      )

      if not registration_result.get('success'):
        # Cleanup: delete the connection if registration failed
        print(f'⚠️  Registration failed, cleaning up connection...')
        delete_http_connection(connection_name)
        return {
          'success': False,
          'error': f"Failed to register API: {registration_result.get('error')}",
          'step_failed': 'register_api',
        }

      # Success!
      return {
        'success': True,
        'api_id': registration_result.get('api_id'),
        'api_name': api_name,
        'connection_name': connection_name,
        'status': registration_result.get('status'),
        'message': f'✅ Successfully registered API "{api_name}" with UC connection "{connection_name}"',
        'next_steps': [
          f'View registered APIs: check_api_http_registry()',
          f'Call the API: call_registered_api(api_id="{registration_result.get("api_id")}")',
          f'View connection details: list_http_connections()',
        ],
      }

    except Exception as e:
      print(f'❌ Error in smart registration: {str(e)}')
      return {
        'success': False,
        'error': f'Smart registration error: {str(e)}',
      }
