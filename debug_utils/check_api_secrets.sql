-- Check which secrets each API is using
-- Run this in Databricks SQL Editor or notebook

-- Replace with your actual catalog.schema
SELECT 
  api_name,
  connection_name,
  auth_type,
  secret_scope,
  CASE 
    WHEN auth_type = 'bearer_token' THEN CONCAT('secret(''', secret_scope, ''', ''', api_name, ''')')
    WHEN auth_type = 'api_key' THEN CONCAT('secret(''', secret_scope, ''', ''', api_name, ''')')
    ELSE 'N/A (public API)'
  END as expected_secret_reference,
  host,
  base_path,
  created_at,
  modified_date
FROM lucam_catalog.custom_mcp_server.api_http_registry
ORDER BY auth_type, api_name;

-- This shows you:
-- 1. Which secret scope each API uses (mcp_api_keys or mcp_bearer_tokens)
-- 2. What the secret key should be (same as api_name)
-- 3. The full secret reference format

