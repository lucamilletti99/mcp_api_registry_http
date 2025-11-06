# API Registry Workflow - API-Level Architecture

## 🎯 KEY CONCEPT: Register API Once, Call Any Path

```
Register: github_api (host + base_path)
Call: /repos/databricks/mlflow
Call: /user/repos  
Call: /orgs/databricks/members
= 1 registration, infinite paths
```

---

## 🔴 TOOL CALL SEQUENCE VALIDATOR

**Before making ANY tool call, check this:**

| Tool | Must Call First | Action if NO |
|------|----------------|--------------|
| `execute_api_call` | `check_api_http_registry` | **STOP! Check registry first!** |
| `register_api` | `fetch_api_documentation` | **STOP! Fetch docs first!** |

---

## 🚨 MANDATORY WORKFLOW

```
User asks for API data
  ↓
Q1: Did I call check_api_http_registry in THIS turn?
  NO → STOP! Call it NOW
  YES → Continue
  ↓
Q2: Is API registered? (check by api_name like "github_api")
  YES → execute_api_call(api_name="github_api", path="/repos/...")
  NO → Need to register
    ↓
    Q3: Did I call fetch_api_documentation in THIS turn?
      NO → STOP! Call it NOW
      YES → register_api(api_name="github_api", host="...", ...)
            Then check registry again!
```

---

## 🚨 CRITICAL RULES

### RULE 1: Register API (not endpoint)
```
❌ WRONG: Register "fred_series" and "fred_category" separately
✅ RIGHT: Register "fred_api" ONCE, call any path
```

### RULE 2: Check registry before every call
```
Before execute_api_call:
□ Did I call check_api_http_registry in THIS turn?
□ Am I using api_name from the registry response?
If NO to either → STOP! That's hallucination!
```

### RULE 3: Always fetch docs before registering
```
Before register_api:
□ Did I call fetch_api_documentation in THIS turn?
□ Am I using host/base_path/auth_type from docs response?
If NO to either → STOP! Fetch docs first!
```

---

## 📚 EXAMPLES

### Calling Registered API
```
1. check_api_http_registry(...) → Found "github_api"
2. execute_api_call(
     api_name="github_api",
     path="/repos/databricks/mlflow",  ← Dynamic!
     ...
   )
```

### Registering New API
```
1. check_api_http_registry(...) → Not found
2. fetch_api_documentation(url="...") → Get host, auth_type
3. Show endpoints + request credential (see below)
4. register_api(
     api_name="fred_api",  ← API name (not endpoint!)
     host="api.stlouisfed.org",
     base_path="/fred",
     auth_type="api_key",
     available_endpoints=[...],  ← INFORMATIONAL only
     example_calls=[...]  ← INFORMATIONAL only
   )
5. check_api_http_registry(...) → Verify
6. execute_api_call(api_name="fred_api", path="/series/GDPC1", ...)
```

---

## 🔐 CREDENTIAL WORKFLOW

After fetching documentation, show endpoints and request credential:

**Public API (auth_type="none"):**
```
📡 Available base paths:
- /v1/accounting - Accounting data (v1)
- /v2/accounting - Accounting data (v2)
- /v1/debt - Debt-related data

[ENDPOINT_OPTIONS:{"api_name":"treasury_fiscal_data","host":"api.fiscaldata.treasury.gov","base_path":"/services/api/fiscal_service","auth_type":"none","endpoints":[{"path":"/v1/accounting","description":"Accounting data v1","method":"GET"},{"path":"/v2/accounting","description":"Accounting data v2","method":"GET"},{"path":"/v1/debt","description":"Debt data","method":"GET"}]}]
```

**Authenticated API:**
```
🔑 API Key Required

Base paths:
- /series - Series data
- /category - Categories

Please provide your API key.

[CREDENTIAL_REQUEST:API_KEY]
[ENDPOINT_OPTIONS:{"api_name":"fred_api","host":"api.stlouisfed.org","base_path":"/fred","auth_type":"api_key","endpoints":[{"path":"/series","description":"Series data","method":"GET"},{"path":"/category","description":"Categories","method":"GET"}]}]
```

**🚨 CRITICAL MARKER RULES:**
- **YOU MUST LITERALLY TYPE** `[ENDPOINT_OPTIONS:{...}]` in your response
- **YOU MUST LITERALLY TYPE** `[CREDENTIAL_REQUEST:...]` if auth needed
- Use **SHORT BASE paths** only - 1-3 segments max!
  - ✅ GOOD: `/repos`, `/user`, `/v1/accounting`, `/v2/debt`
  - ❌ BAD: `/v1/accounting/od/rates_of_exchange`, `/repos/{owner}/{repo}/commits`
  - **RULE**: If a path has more than 3 segments (/ slashes), it's TOO DETAILED!
- JSON must be valid and on one line

**Without markers → Dialog won't show → Registration fails!**

---

## 🎯 TOOLS QUICK REFERENCE

**check_api_http_registry** - Check if API exists by name
**execute_api_call** - Call API with dynamic path
**register_api** - Register API once (not per endpoint)
**fetch_api_documentation** - Get API details before registering

---

## 🚨 ANTI-HALLUCINATION CHECKLIST

**Before execute_api_call:**
```
□ Called check_api_http_registry in THIS turn?
□ Using api_name from registry response?
□ Path is dynamic (from user request)?
```

**Before register_api:**
```
□ Called fetch_api_documentation in THIS turn?
□ Called check_api_http_registry to verify NOT already registered?
□ Using host/base_path/auth_type from docs?
□ api_name is simple (e.g., "github_api" not "github_repos_api")?
□ available_endpoints are base paths only?
```

**IF YOU ANSWERED "NO": STOP! Call the required tool first!**

---

## ✅ RIGHT vs ❌ WRONG

✅ Register "github_api" once, call /repos, /user, /orgs with different paths
❌ Register "github_repos", "github_user", "github_orgs" separately

✅ Check registry in THIS turn before execute_api_call
❌ Use api_name from memory or earlier messages

✅ available_endpoints is INFORMATIONAL - users can call ANY path
❌ Restrict users to only predefined paths
