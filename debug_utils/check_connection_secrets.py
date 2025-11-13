#!/usr/bin/env python3
"""
Check which secrets Unity Catalog HTTP connections are using
"""

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

print("🔍 Checking HTTP Connections and their secret references...\n")

try:
    # List all connections (may need catalog/schema context)
    catalogs = ["lucam_catalog", "luca_milletti"]  # Add your catalogs
    
    for catalog in catalogs:
        print(f"📁 Catalog: {catalog}")
        try:
            schemas = list(w.schemas.list(catalog_name=catalog))
            for schema in schemas:
                schema_name = schema.name
                if not schema_name:
                    continue
                    
                print(f"  📂 Schema: {schema_name}")
                
                # Try to list connections in this catalog.schema
                # Note: This may not work if the SDK doesn't support listing connections
                # Alternative: Query system tables
                
        except Exception as e:
            print(f"  ⚠️  Could not list schemas: {e}")
        print()
        
except Exception as e:
    print(f"❌ Error: {e}")

print("\n💡 Alternative: Query the api_http_registry table directly")
print("=" * 60)
print("SELECT api_name, connection_name, auth_type, secret_scope")
print("FROM your_catalog.your_schema.api_http_registry;")
print("=" * 60)
print("\nThis will show you which secret scope each API uses!")

