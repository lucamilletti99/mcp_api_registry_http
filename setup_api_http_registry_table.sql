-- API HTTP Registry Table Schema
-- This table stores API metadata using SQL-based HTTP Connections with Databricks Secret Scopes
-- Credentials are stored in Secret Scopes, referenced by connections via secret() function
-- Supports three authentication flavors: none, api_key, bearer_token

CREATE TABLE IF NOT EXISTS {catalog}.{schema}.api_http_registry (
  -- Unique identifier for the API
  api_id STRING NOT NULL,

  -- API metadata
  api_name STRING NOT NULL,
  description STRING,

  -- Connection configuration
  connection_name STRING NOT NULL COMMENT 'Name of the UC HTTP Connection (created via SQL)',
  host STRING NOT NULL COMMENT 'API host (e.g., "api.stlouisfed.org")',
  base_path STRING COMMENT 'Base path for API endpoints (e.g., "/fred")',
  api_path STRING COMMENT 'Specific endpoint path (e.g., "/series/observations")',

  -- Authentication configuration
  auth_type STRING NOT NULL COMMENT 'Authentication type: "none", "api_key", or "bearer_token"',
  secret_scope STRING COMMENT 'Secret scope name: "mcp_api_keys" for api_key auth, "mcp_bearer_tokens" for bearer_token auth, NULL for auth_type=none',

  -- Request configuration
  http_method STRING DEFAULT 'GET',
  request_headers STRING COMMENT 'JSON string of additional headers to send',
  documentation_url STRING,

  -- Parameter definitions for dynamic API calls
  parameters STRING COMMENT 'JSON string defining available parameters: {"query_params": [{"name": "series_id", "type": "string", "required": true, "description": "Series identifier", "examples": ["GDPC1", "UNRATE"]}]}',

  -- Status tracking
  status STRING,
  validation_message STRING,

  -- Audit fields
  user_who_requested STRING,
  created_at TIMESTAMP,
  modified_date TIMESTAMP,

  -- Primary key
  CONSTRAINT api_http_registry_pk PRIMARY KEY (api_id)
)
COMMENT 'API Registry using SQL-based HTTP Connections with Secret Scopes. Three auth flavors: none (public), api_key (query param), bearer_token (Authorization header).'
-- Default value features
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'delta.feature.allowColumnDefaults' = 'supported'
);
