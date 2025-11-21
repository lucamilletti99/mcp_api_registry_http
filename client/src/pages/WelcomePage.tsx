import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { McpService } from "@/fastapi_client";
import {
  Code,
  ExternalLink,
  FileText,
  Play,
  Wrench,
  User,
  Sparkles,
  Bot,
  Terminal,
} from "lucide-react";

interface UserInfo {
  userName: string;
  displayName?: string;
  active: boolean;
  emails: string[];
}

interface HealthCheckInfo {
  status: string;
  service: string;
  databricks_configured: boolean;
  auth_mode: "on-behalf-of" | "service-principal";
  user_auth_available: boolean;
  user_token_preview: string | null;
  authenticated_user: {
    username?: string;
    display_name?: string;
    active?: boolean;
    error?: string;
  } | null;
  headers_present: string[];
}

async function fetchUserInfo(): Promise<UserInfo> {
  const response = await fetch("/api/user/me");
  if (!response.ok) {
    throw new Error("Failed to fetch user info");
  }
  return response.json();
}

async function fetchHealthCheck(): Promise<HealthCheckInfo> {
  // Note: This would need a proper API endpoint or MCP call to fetch health check
  // For now, returning a placeholder structure
  // You would typically add an API endpoint like /api/health that internally calls the MCP health tool
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error("Failed to fetch health check");
  }
  return response.json();
}

export function WelcomePage() {
  const { data: userInfo } = useQuery({
    queryKey: ["userInfo"],
    queryFn: fetchUserInfo,
    retry: false,
  });

  const { data: mcpInfo } = useQuery({
    queryKey: ["mcpInfo"],
    queryFn: () => McpService.getMcpInfoApiMcpInfoInfoGet(),
    retry: false,
  });

  const { data: healthCheck } = useQuery({
    queryKey: ["healthCheck"],
    queryFn: fetchHealthCheck,
    retry: false,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex justify-center items-center gap-3 mb-4">
            <Sparkles className="h-10 w-10 text-blue-600" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Welcome to your Databricks FastAPI app!
            </h1>
          </div>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            AI-powered API registry leveraging Unity Catalog HTTP Connections
            for secure external API integration via natural language
          </p>
        </div>

        {/* User Info Card */}
        {userInfo && (
          <Card className="mb-8 border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Current User
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-semibold">
                    {userInfo.displayName || userInfo.userName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {userInfo.emails[0] || userInfo.userName}
                  </p>
                </div>
                <Badge variant={userInfo.active ? "default" : "secondary"}>
                  {userInfo.active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Authentication Status Card */}
        {healthCheck && (
          <Card className="mb-8 border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                Authentication Status
              </CardTitle>
              <CardDescription>
                On-behalf-of (OBO) authentication information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Authentication Mode:</span>
                <Badge variant={healthCheck.auth_mode === "on-behalf-of" ? "default" : "secondary"}>
                  {healthCheck.auth_mode === "on-behalf-of" ? "🔐 On-Behalf-Of" : "🤖 Service Principal"}
                </Badge>
              </div>

              {healthCheck.authenticated_user && (
                <div className="space-y-2 pt-2 border-t">
                  <h4 className="text-sm font-semibold">Authenticated As:</h4>
                  <div className="ml-2 space-y-1">
                    <p className="text-sm">
                      <span className="font-medium">Username:</span> {healthCheck.authenticated_user.username}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Display Name:</span> {healthCheck.authenticated_user.display_name}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Status:</span>{" "}
                      <Badge variant={healthCheck.authenticated_user.active ? "default" : "secondary"} className="text-xs">
                        {healthCheck.authenticated_user.active ? "Active" : "Inactive"}
                      </Badge>
                    </p>
                  </div>
                </div>
              )}

              {healthCheck.user_token_preview && (
                <div className="space-y-1 pt-2 border-t">
                  <h4 className="text-sm font-semibold">User Token Preview:</h4>
                  <code className="block bg-muted px-2 py-1 rounded text-xs font-mono">
                    {healthCheck.user_token_preview}
                  </code>
                </div>
              )}

              {!healthCheck.user_auth_available && (
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    ℹ️ On-behalf-of authentication is not active. The app is using service principal credentials.
                    To enable OBO auth, access this app through your browser while authenticated to Databricks.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Main Content Grid - First Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Quick Start Guide */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-5 w-5" />
                Quick Start Guide
              </CardTitle>
              <CardDescription>
                How to use the API Registry to discover and call external APIs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold mb-3">Step 1: Select Your Resources</h4>
                <div className="space-y-2 text-sm ml-2">
                  <div className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">1.</span>
                    <div>
                      <span className="font-medium">Choose a SQL Warehouse</span>
                      <p className="text-muted-foreground text-xs">Executes API calls and manages HTTP connections</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">2.</span>
                    <div>
                      <span className="font-medium">Select a Catalog</span>
                      <p className="text-muted-foreground text-xs">Unity Catalog namespace for your APIs</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">3.</span>
                    <div>
                      <span className="font-medium">Pick a Schema</span>
                      <p className="text-muted-foreground text-xs">Where your api_http_registry table lives</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Step 2: Discover API Documentation & Register APIs</h4>
                <div className="space-y-2 text-sm ml-2">
                  <p className="text-muted-foreground">Ask the AI agent in natural language:</p>
                  <div className="bg-muted px-3 py-2 rounded">
                    <code className="text-xs">"Check the FRED economic data API from this URL: https://fred.stlouisfed.org/docs/api/fred/"</code>
                  </div>
                  <div className="bg-muted px-3 py-2 rounded">
                    <code className="text-xs">"I want to register a new api for github: https://docs.github.com/en/rest/repos/repos. Let me know what I need to provide you"</code>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Step 3: Call APIs</h4>
                <p className="text-sm text-muted-foreground">
                  The AI agent automatically checks the registry, registers new APIs if needed,
                  and executes calls via Unity Catalog HTTP Connections.
                </p>
              </div>

              <Button asChild className="w-full">
                <a href="/chat">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Chat Playground
                </a>
              </Button>
            </CardContent>
          </Card>

          {/* Key Pages */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Application Pages
              </CardTitle>
              <CardDescription>
                Navigate the API Registry interface
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold mb-3">Chat Playground</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  AI-powered interface for discovering and calling APIs
                </p>
                <ul className="space-y-1 text-sm ml-4 list-disc text-muted-foreground">
                  <li>Select warehouse, catalog, and schema (two dropdown)</li>
                  <li>Chat with AI to register and call APIs</li>
                  <li>View MLflow traces for debugging</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-3">API Registry</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  View and manage all registered APIs
                </p>
                <ul className="space-y-1 text-sm ml-4 list-disc text-muted-foreground">
                  <li>Browse registered HTTP connections</li>
                  <li>Edit API metadata and documentation</li>
                  <li>Delete unused APIs</li>
                  <li>View connection details and parameters</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-3">MCP Info</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  Explore available MCP tools and prompts
                </p>
                <ul className="space-y-1 text-sm ml-4 list-disc text-muted-foreground">
                  <li>View all MCP tools (categorized)</li>
                  <li>See tool descriptions and parameters</li>
                  <li>Setup instructions for Claude Code</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Traces</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  MLflow tracing for LLM observability
                </p>
                <ul className="space-y-1 text-sm ml-4 list-disc text-muted-foreground">
                  <li>View all LLM interactions</li>
                  <li>Debug tool calls and responses</li>
                  <li>Analyze latency and token usage</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* MCP Configuration */}
        {mcpInfo && (
          <Card className="mb-8 border-purple-200 bg-purple-50/50 dark:border-purple-800 dark:bg-purple-950/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                MCP (Model Context Protocol) Server
              </CardTitle>
              <CardDescription>
                This app provides an MCP server for discovering, registering, and calling external APIs using Unity Catalog HTTP Connections
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">MCP Server URL</h4>
                <code className="bg-muted px-3 py-2 rounded block text-sm font-mono">
                  {mcpInfo.mcp_url}
                </code>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">Claude Code Configuration</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  To use this MCP server with Claude Code, run:
                </p>
                <code className="bg-muted px-3 py-2 rounded block text-sm font-mono">
                  claude mcp add {mcpInfo.server_name || 'mcp-commands'} {mcpInfo.client_path || 'python mcp_databricks_client.py'}
                </code>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <Badge variant="outline">
                    Transport: {mcpInfo.transport}
                  </Badge>
                  {mcpInfo.capabilities?.prompts && (
                    <Badge variant="outline">Prompts ✓</Badge>
                  )}
                  {mcpInfo.capabilities?.tools && (
                    <Badge variant="outline">Tools ✓</Badge>
                  )}
                </div>
                
                <div className="text-sm text-muted-foreground">
                  <p className="font-semibold mb-1">Key Tools:</p>
                  <ul className="list-disc list-inside space-y-0.5 ml-2">
                    <li>register_api - Create Unity Catalog HTTP Connections</li>
                    <li>check_api_http_registry - Query registered APIs</li>
                    <li>call_parameterized_api - Execute http_request() via SQL</li>
                  </ul>
                </div>
              </div>

              <Button asChild className="w-full">
                <a href="/prompts">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View Available Prompts & Tools
                </a>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Second Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* Authentication Types */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Code className="h-5 w-5" />
                Supported Authentication
              </CardTitle>
              <CardDescription>
                Unity Catalog HTTP Connections support multiple auth types
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950">none</Badge>
                    <h4 className="font-semibold text-sm">Public APIs</h4>
                  </div>
                  <p className="text-xs text-muted-foreground ml-2">
                    No authentication required. Use for public endpoints like weather APIs, currency rates, etc.
                  </p>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950">api_key</Badge>
                    <h4 className="font-semibold text-sm">API Key Authentication</h4>
                  </div>
                  <p className="text-xs text-muted-foreground ml-2">
                    API key passed as query parameter. Used by FRED, OpenWeather, and many data APIs.
                    Stored in <code className="text-xs bg-muted px-1 rounded">mcp_api_keys</code> secret scope.
                  </p>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950">bearer_token</Badge>
                    <h4 className="font-semibold text-sm">Bearer Token Authentication</h4>
                  </div>
                  <p className="text-xs text-muted-foreground ml-2">
                    Bearer token in Authorization header. Used by GitHub, many REST APIs.
                    Stored in <code className="text-xs bg-muted px-1 rounded">mcp_bearer_tokens</code> secret scope.
                  </p>
                </div>

                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    <strong>Credential Security:</strong> All API keys and tokens are securely stored in Unity Catalog secret scopes.
                    The app's service principal manages secrets on your behalf - no per-user permissions needed!
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Example Use Cases */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Example Use Cases
              </CardTitle>
              <CardDescription>
                Real-world scenarios for the API Registry
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Economic Data</Badge>
                    FRED API
                  </h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    Access Federal Reserve economic data for GDP, unemployment, inflation, etc.
                  </p>
                  <div className="bg-muted px-3 py-2 rounded text-xs">
                    <code>"Get the latest US GDP data from FRED"</code>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Developer APIs</Badge>
                    GitHub API
                  </h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    List repositories, get commit history, manage issues and PRs.
                  </p>
                  <div className="bg-muted px-3 py-2 rounded text-xs">
                    <code>"List my GitHub repositories"</code>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Weather</Badge>
                    OpenWeather API
                  </h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    Get current weather, forecasts, and historical data.
                  </p>
                  <div className="bg-muted px-3 py-2 rounded text-xs">
                    <code>"What's the weather in San Francisco?"</code>
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    <strong>Tip:</strong> The AI agent automatically discovers API documentation,
                    registers endpoints, and handles authentication - you just ask in natural language!
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Features */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Key Features
            </CardTitle>
            <CardDescription>
              Built-in capabilities to accelerate your development
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Badge className="mt-1">Auto</Badge>
                  <div>
                    <h5 className="font-semibold">
                      TypeScript Client Generation
                    </h5>
                    <p className="text-sm text-muted-foreground">
                      Automatically generates TypeScript API client from FastAPI
                      OpenAPI spec
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Badge className="mt-1">Hot</Badge>
                  <div>
                    <h5 className="font-semibold">Hot Reloading</h5>
                    <p className="text-sm text-muted-foreground">
                      Instant updates for both Python backend and React frontend
                      changes
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Badge className="mt-1">Auth</Badge>
                  <div>
                    <h5 className="font-semibold">Databricks Authentication</h5>
                    <p className="text-sm text-muted-foreground">
                      Integrated with Databricks SDK for seamless workspace
                      integration
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Badge className="mt-1">Deploy</Badge>
                  <div>
                    <h5 className="font-semibold">Databricks Apps Ready</h5>
                    <p className="text-sm text-muted-foreground">
                      Pre-configured for deployment to Databricks Apps platform
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Badge className="mt-1">Quality</Badge>
                  <div>
                    <h5 className="font-semibold">Code Quality Tools</h5>
                    <p className="text-sm text-muted-foreground">
                      Automated formatting with ruff (Python) and prettier
                      (TypeScript)
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Badge className="mt-1">Logs</Badge>
                  <div>
                    <h5 className="font-semibold">Background Development</h5>
                    <p className="text-sm text-muted-foreground">
                      Development servers run in background with comprehensive
                      logging
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center mt-12 pt-8 border-t">
          <p className="text-muted-foreground">
            Ready to build something amazing? Check out the{" "}
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              API documentation
            </a>{" "}
            to get started with your endpoints.
          </p>
        </div>
      </div>
    </div>
  );
}
