# Debug Utilities

Scripts for troubleshooting API registry and secret management.

## check_api_secrets.sql

SQL query to verify which secrets each API uses.

**Usage:**
```sql
-- Update the catalog.schema on line 19 to match your environment
-- Then run in Databricks SQL Editor
```

**Shows:**
- Which secret scope each API uses (`mcp_api_keys` or `mcp_bearer_tokens`)
- Expected secret reference format
- API configuration details

---

## check_connection_secrets.py

Python script to inspect HTTP connections and secret references.

**Usage:**
```bash
# Update catalogs on line 14 to match your environment
uv run python debug_utils/check_connection_secrets.py
```

**Shows:**
- HTTP connections across catalogs and schemas
- Secret references used by connections
- Alternative query for manual inspection

---

## cleanup_bearer_tokens.sh

Cleanup script for removing old per-endpoint bearer token secrets.

**When to use:**
- After migrating to the 2-scope architecture (API-level secrets)
- To remove old per-endpoint secrets that are no longer needed

**Usage:**
```bash
./debug_utils/cleanup_bearer_tokens.sh
```

**What it does:**
- Lists current secrets in `mcp_bearer_tokens` scope
- Prompts for confirmation
- Deletes old per-endpoint secrets (e.g., `github_repo_details`, `github_repos_api`)
- Shows remaining secrets after cleanup

---

## Notes

- **Update hardcoded values:** These scripts have hardcoded catalog/schema names. Update them to match your environment.
- **Secret safety:** These scripts only read secrets (except cleanup script). They never expose secret values.
- **Troubleshooting:** Use these when debugging authentication or secret storage issues.
