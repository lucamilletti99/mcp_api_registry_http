"""API Registry router - manage registered APIs."""

import os
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from databricks.sdk import WorkspaceClient
from databricks.sdk.core import Config
from databricks.sdk.service.sql import StatementState

router = APIRouter()


class RegisteredAPI(BaseModel):
    """Model for a registered API using UC HTTP Connections (API-level registration)."""
    api_id: str
    api_name: str
    description: Optional[str] = None
    connection_name: str  # UC HTTP Connection name
    host: str  # API host (e.g., "api.github.com")
    base_path: Optional[str] = None  # Base path for API (e.g., "/v1", "/api", or empty)
    auth_type: str  # Authentication type: "none", "api_key", or "bearer_token"
    secret_scope: Optional[str] = None  # Secret scope: "mcp_api_keys" or "mcp_bearer_tokens"
    documentation_url: Optional[str] = None
    available_endpoints: Optional[str] = None  # JSON array of available endpoints
    example_calls: Optional[str] = None  # JSON array of example calls
    status: str = 'pending'
    user_who_requested: Optional[str] = None
    created_at: Optional[str] = None
    modified_date: Optional[str] = None
    validation_message: Optional[str] = None


class APIRegistryResponse(BaseModel):
    """Response containing list of registered APIs."""
    apis: List[RegisteredAPI]
    count: int


def get_workspace_client(request: Request = None) -> WorkspaceClient:
    """Get authenticated Databricks workspace client.

    Falls back to OAuth service principal authentication if:
    - User token is not available
    - User has no access to warehouses AND catalogs

    Args:
        request: FastAPI Request object to extract user token from

    Returns:
        WorkspaceClient configured with appropriate authentication
    """
    host = os.environ.get('DATABRICKS_HOST')

    # Try to get user token from request headers (on-behalf-of authentication)
    user_token = None
    if request:
        user_token = request.headers.get('x-forwarded-access-token')

    if user_token:
        # Try on-behalf-of authentication with user's token
        print(f"🔐 Attempting OBO authentication for user")
        config = Config(host=host, token=user_token, auth_type='pat')
        user_client = WorkspaceClient(config=config)

        # Verify user has access to SQL warehouses
        has_warehouse_access = False

        try:
            warehouses = list(user_client.warehouses.list())
            if warehouses:
                has_warehouse_access = True
                print(f"✅ User has access to {len(warehouses)} warehouse(s)")
        except Exception as e:
            print(f"⚠️  User cannot list warehouses: {str(e)}")

        # If user has warehouse access, use OBO; otherwise fallback to service principal
        if has_warehouse_access:
            print(f"✅ Using OBO authentication - user has warehouse access")
            return user_client
        else:
            print(f"⚠️  User has no warehouse access, falling back to service principal")
            return WorkspaceClient(host=host)
    else:
        # No user token - fall back to OAuth service principal authentication
        print(f"⚠️  No user token found, falling back to service principal")
        return WorkspaceClient(host=host)


def get_default_warehouse_id(ws: WorkspaceClient) -> Optional[str]:
    """Get the first available SQL warehouse."""
    try:
        warehouses = list(ws.warehouses.list())
        if warehouses:
            return warehouses[0].id
    except Exception as e:
        print(f"Failed to list warehouses: {e}")
    return None


@router.get('/list', response_model=APIRegistryResponse)
async def list_apis(
    catalog: str,
    schema: str,
    warehouse_id: str,
    request: Request
) -> APIRegistryResponse:
    """List all registered APIs from the registry table.

    Args:
        catalog: Catalog name
        schema: Schema name
        warehouse_id: SQL warehouse ID
        request: Request object for authentication

    Returns:
        List of registered APIs
    """
    try:
        ws = get_workspace_client(request)

        # Build fully-qualified table name with proper backtick quoting
        # Backticks handle catalogs/schemas with special characters (e.g., -f.default)
        table_name = f'`{catalog}`.`{schema}`.`api_http_registry`'

        # Query the registry table (API-level registration)
        query = f"""
        SELECT
            api_id,
            api_name,
            description,
            connection_name,
            host,
            base_path,
            auth_type,
            secret_scope,
            documentation_url,
            available_endpoints,
            example_calls,
            status,
            user_who_requested,
            created_at,
            modified_date,
            validation_message
        FROM {table_name}
        ORDER BY modified_date DESC
        """

        # Execute query
        statement = ws.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=query,
            wait_timeout='30s'
        )

        # Wait for completion
        if statement.status.state != StatementState.SUCCEEDED:
            # Check if it's a table not found error
            error_message = statement.status.error.message if statement.status.error else 'Unknown error'

            if 'TABLE_OR_VIEW_NOT_FOUND' in error_message or 'does not exist' in error_message.lower():
                raise HTTPException(
                    status_code=404,
                    detail=f'No api_http_registry table exists in {catalog}.{schema}. Please run setup_api_http_registry_table.sql first.'
                )
            else:
                raise HTTPException(
                    status_code=500,
                    detail=f'Query failed: {error_message}'
                )

        # Parse results
        apis = []
        if statement.result and statement.result.data_array:
            # Get column names
            columns = [col.name for col in statement.manifest.schema.columns]

            # Parse each row
            for row in statement.result.data_array:
                api_data = {}
                for i, value in enumerate(row):
                    if i < len(columns):
                        api_data[columns[i]] = value

                apis.append(RegisteredAPI(**api_data))

        return APIRegistryResponse(
            apis=apis,
            count=len(apis)
        )

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        print(f"Failed to list APIs: {e}")
        import traceback
        traceback.print_exc()

        # Check if it's a table not found error in the exception message
        error_str = str(e)
        if 'TABLE_OR_VIEW_NOT_FOUND' in error_str or 'does not exist' in error_str.lower():
            raise HTTPException(
                status_code=404,
                detail=f'No api_http_registry table exists in {catalog}.{schema}. Please run setup_api_http_registry_table.sql first.'
            )

        raise HTTPException(
            status_code=500,
            detail=f'Failed to list APIs: {str(e)}'
        )


@router.post('/update/{api_id}')
async def update_api(
    api_id: str,
    catalog: str,
    schema: str,
    warehouse_id: str,
    api_name: str,
    description: str,
    api_endpoint: str,
    request: Request,
    documentation_url: str = None
):
    """Update an existing API in the registry.

    Args:
        api_id: ID of the API to update
        catalog: Catalog name
        schema: Schema name
        warehouse_id: SQL warehouse ID
        api_name: New name
        description: New description
        api_endpoint: New endpoint URL
        request: Request object for authentication
        documentation_url: Optional documentation URL

    Returns:
        Success message
    """
    try:
        ws = get_workspace_client(request)

        # Build fully-qualified table name with proper backtick quoting
        table_name = f'`{catalog}`.`{schema}`.`api_http_registry`'

        # NOTE: This endpoint needs redesign for UC HTTP Connections architecture
        # For now, just update basic metadata fields
        if documentation_url:
            query = f"""
            UPDATE {table_name}
            SET
                api_name = '{api_name}',
                description = '{description}',
                documentation_url = '{documentation_url}',
                modified_date = CURRENT_TIMESTAMP()
            WHERE api_id = '{api_id}'
            """
        else:
            query = f"""
            UPDATE {table_name}
            SET
                api_name = '{api_name}',
                description = '{description}',
                modified_date = CURRENT_TIMESTAMP()
            WHERE api_id = '{api_id}'
            """

        # Execute update
        statement = ws.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=query,
            wait_timeout='30s'
        )

        if statement.status.state != StatementState.SUCCEEDED:
            raise HTTPException(
                status_code=500,
                detail=f'Update failed: {statement.status.state}'
            )

        return {"message": "API updated successfully"}

    except Exception as e:
        print(f"Failed to update API: {e}")
        raise HTTPException(
            status_code=500,
            detail=f'Failed to update API: {str(e)}'
        )


@router.delete('/delete/{api_id}')
async def delete_api(
    api_id: str,
    catalog: str,
    schema: str,
    warehouse_id: str,
    request: Request
):
    """Delete an API from the registry.

    Args:
        api_id: ID of the API to delete
        catalog: Catalog name
        schema: Schema name
        warehouse_id: SQL warehouse ID
        request: Request object for authentication

    Returns:
        Success message
    """
    try:
        ws = get_workspace_client(request)

        # Build fully-qualified table name with proper backtick quoting
        table_name = f'`{catalog}`.`{schema}`.`api_http_registry`'

        # Step 1: Get the connection_name before deleting the registry entry
        get_connection_query = f"""
        SELECT connection_name
        FROM {table_name}
        WHERE api_id = '{api_id}'
        """

        get_statement = ws.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=get_connection_query,
            wait_timeout='30s'
        )

        if get_statement.status.state != StatementState.SUCCEEDED:
            raise HTTPException(
                status_code=500,
                detail=f'Failed to retrieve connection name: {get_statement.status.state}'
            )

        # Extract connection_name from results
        connection_name = None
        if get_statement.result and get_statement.result.data_array:
            for row in get_statement.result.data_array:
                if row and len(row) > 0:
                    connection_name = row[0]
                    break

        # Step 2: Delete the registry entry
        delete_query = f"""
        DELETE FROM {table_name}
        WHERE api_id = '{api_id}'
        """

        delete_statement = ws.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=delete_query,
            wait_timeout='30s'
        )

        if delete_statement.status.state != StatementState.SUCCEEDED:
            raise HTTPException(
                status_code=500,
                detail=f'Delete from registry failed: {delete_statement.status.state}'
            )

        # Step 3: Drop the HTTP connection if we found one
        if connection_name:
            # Use simple DROP syntax and pass catalog/schema as parameters
            # This matches the working pattern in tools.py
            drop_connection_query = f"DROP CONNECTION IF EXISTS {connection_name}"

            try:
                drop_statement = ws.statement_execution.execute_statement(
                    warehouse_id=warehouse_id,
                    statement=drop_connection_query,
                    catalog=catalog,  # Pass as parameter instead of in SQL
                    schema=schema,    # Pass as parameter instead of in SQL
                    wait_timeout='30s'
                )

                if drop_statement.status.state == StatementState.SUCCEEDED:
                    print(f"✅ Dropped HTTP connection: {connection_name}")
                    return {
                        "message": "API and HTTP connection deleted successfully",
                        "connection_deleted": True
                    }
                else:
                    # Get more error details
                    error_msg = getattr(drop_statement.status, 'error', {})
                    print(f"⚠️  Failed to drop connection {connection_name}: {drop_statement.status.state}")
                    print(f"    Error details: {error_msg}")
                    return {
                        "message": f"API deleted, but HTTP connection deletion failed: {error_msg}",
                        "connection_deleted": False
                    }
            except Exception as drop_error:
                print(f"⚠️  Error dropping connection {connection_name}: {drop_error}")
                return {
                    "message": f"API deleted, but HTTP connection deletion failed: {str(drop_error)}",
                    "connection_deleted": False
                }
        else:
            return {"message": "API deleted successfully (no connection found)"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Failed to delete API: {e}")
        raise HTTPException(
            status_code=500,
            detail=f'Failed to delete API: {str(e)}'
        )
