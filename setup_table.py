#!/usr/bin/env python3
"""Setup API Registry table in Databricks."""

import os
import sys
from pathlib import Path
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

# Load environment variables from .env.local if it exists
try:
    from dotenv import load_dotenv
    env_file = Path(__file__).parent / '.env.local'
    if env_file.exists():
        load_dotenv(env_file)
        print(f"✅ Loaded environment from .env.local")
except ImportError:
    pass  # python-dotenv not required

def setup_api_registry_table(catalog: str, schema: str, warehouse_id: str = None):
    """Create the api_http_registry table in the specified catalog.schema.

    Args:
        catalog: Catalog name (e.g., 'luca_milletti')
        schema: Schema name (e.g., 'custom_mcp_server')
        warehouse_id: SQL warehouse ID (optional, will use env var if not provided)
    """
    # Initialize Databricks client
    host = os.environ.get('DATABRICKS_HOST')
    if not host:
        print("❌ DATABRICKS_HOST environment variable not set")
        print("💡 Make sure you have run ./setup.sh to create .env.local")
        print("💡 Or set DATABRICKS_HOST manually:")
        print("   export DATABRICKS_HOST=https://your-workspace.cloud.databricks.com")
        sys.exit(1)

    print(f"🔐 Connecting to Databricks: {host}")
    w = WorkspaceClient(host=host)

    # Get warehouse ID
    if not warehouse_id:
        warehouse_id = os.environ.get('DATABRICKS_SQL_WAREHOUSE_ID')

    if not warehouse_id:
        # Try to get first available warehouse
        print("📊 No warehouse ID provided, looking for available warehouses...")
        warehouses = list(w.warehouses.list())
        if warehouses:
            warehouse_id = warehouses[0].id
            print(f"✅ Using warehouse: {warehouses[0].name} ({warehouse_id})")
        else:
            print("❌ No SQL warehouses found in your workspace")
            print("\n📖 You need to create a SQL Warehouse to continue:")
            print("   https://docs.databricks.com/en/compute/sql-warehouse/create.html")
            print("\n💡 Quick steps:")
            print("   1. Go to your Databricks workspace")
            print("   2. Click 'SQL Warehouses' in the left sidebar")
            print("   3. Click 'Create SQL Warehouse'")
            print("   4. Choose 'Serverless' for best performance")
            print("   5. Click 'Create'")
            print("\n   Then run this script again.")
            sys.exit(1)

    # Read SQL template
    sql_file = os.path.join(os.path.dirname(__file__), 'setup_api_http_registry_table.sql')
    with open(sql_file, 'r') as f:
        sql_template = f.read()

    # Replace placeholders
    sql = sql_template.replace('{catalog}', catalog).replace('{schema}', schema)

    # Split into individual statements (simple split by semicolon)
    # Remove comment-only lines but keep comments within statements
    raw_statements = sql.split(';')
    statements = []
    for s in raw_statements:
        s_stripped = s.strip()
        # Skip empty or comment-only statements
        if not s_stripped:
            continue
        # Remove leading comment lines but keep the SQL
        lines = [line for line in s_stripped.split('\n') if not line.strip().startswith('--')]
        if lines:
            statement = '\n'.join(lines).strip()
            if statement:
                statements.append(statement)

    print(f"\n📝 Creating api_http_registry table in {catalog}.{schema}...")
    print(f"🔧 Using SQL warehouse: {warehouse_id}")
    print(f"📄 Found {len(statements)} SQL statement(s) to execute\n")

    if len(statements) == 0:
        print("❌ No SQL statements found in setup_api_http_registry_table.sql")
        print(f"   SQL file location: {sql_file}")
        sys.exit(1)

    # Execute each statement
    for i, statement in enumerate(statements, 1):
        if not statement:
            continue

        print(f"\nExecuting statement {i}/{len(statements)}...")
        # Show first 150 chars of statement
        preview = statement.replace('\n', ' ')[:150]
        print(f"  {preview}...")

        try:
            result = w.statement_execution.execute_statement(
                warehouse_id=warehouse_id,
                statement=statement,
                wait_timeout='30s'
            )

            if result.status.state == StatementState.SUCCEEDED:
                print(f"  ✅ Success")
            elif result.status.state == StatementState.FAILED:
                error_msg = result.status.error.message if result.status.error else 'Unknown error'
                print(f"  ❌ Failed: {error_msg}")
                # Don't exit, continue with verification
            else:
                print(f"  ⚠️  Status: {result.status.state}")

        except Exception as e:
            print(f"  ❌ Error: {str(e)}")
            # Continue with verification even if statement fails
            continue

    # Verify table was created
    print("🔍 Verifying table creation...")
    verify_query = f"DESCRIBE TABLE {catalog}.{schema}.api_http_registry"

    try:
        print(f"   Running: {verify_query}")
        result = w.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=verify_query,
            wait_timeout='30s'
        )

        print(f"   Query status: {result.status.state}")

        if result.status.state == StatementState.SUCCEEDED:
            print(f"✅ Table {catalog}.{schema}.api_http_registry created successfully!\n")

            # Show table structure
            if result.result and result.result.data_array:
                print("📋 Table structure:")
                for row in result.result.data_array[:15]:  # Show first 15 columns
                    col_name = row[0] if len(row) > 0 else ''
                    col_type = row[1] if len(row) > 1 else ''
                    print(f"  - {col_name}: {col_type}")

            print(f"\n🎉 Setup complete! You can now use {catalog}.{schema}.api_http_registry")
            return True
        else:
            error_msg = result.status.error.message if result.status.error else 'Unknown error'
            print(f"⚠️  Verification query did not succeed: {error_msg}")
            print(f"   The table may have been created but verification failed.")
            print(f"   Try running: DESCRIBE TABLE {catalog}.{schema}.api_http_registry")
            return False

    except Exception as e:
        print(f"❌ Failed to verify table: {str(e)}")
        print(f"   This could mean:")
        print(f"   1. The table was created but DESCRIBE timed out")
        print(f"   2. You don't have permissions to describe the table")
        print(f"   3. The warehouse is slow to respond")
        print(f"\n💡 Try checking manually in Databricks:")
        print(f"   SELECT * FROM {catalog}.{schema}.api_http_registry LIMIT 1;")
        return False


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Setup API Registry table in Databricks')
    parser.add_argument('catalog', help='Catalog name (e.g., luca_milletti)')
    parser.add_argument('schema', help='Schema name (e.g., custom_mcp_server)')
    parser.add_argument('--warehouse-id', help='SQL warehouse ID (optional)')

    args = parser.parse_args()

    setup_api_registry_table(args.catalog, args.schema, args.warehouse_id)
