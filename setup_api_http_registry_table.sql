-- API HTTP Registry Table Schema
-- This table stores API metadata using Unity Catalog HTTP Connections for secure credential management
-- Credentials are stored in UC HTTP Connections, NOT in this table

CREATE TABLE IF NOT EXISTS {catalog}.{schema}.api_http_registry (
  -- Unique identifier for the API
  api_id STRING NOT NULL,

  -- API metadata
  api_name STRING NOT NULL,
  description STRING,

  -- Unity Catalog HTTP Connection reference (NO credentials stored here!)
  connection_name STRING NOT NULL COMMENT 'Name of the UC HTTP Connection to use',
  api_path STRING COMMENT 'Path to append to connection base URL (e.g., "/query?function=TIME_SERIES_INTRADAY")',

  -- Request configuration
  http_method STRING DEFAULT 'GET',
  request_headers STRING COMMENT 'JSON string of additional headers to send',
  documentation_url STRING,

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
COMMENT 'API Registry using Unity Catalog HTTP Connections for secure credential management. Credentials are stored in UC Connections, not in this table.'
-- Default value features
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'delta.feature.allowColumnDefaults' = 'supported'
);
