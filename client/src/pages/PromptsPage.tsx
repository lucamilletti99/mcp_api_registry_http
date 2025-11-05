import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  FileCode,
  Wrench,
  Terminal,
  Copy,
  ExternalLink,
} from "lucide-react";
import { PromptsService, McpService } from "@/fastapi_client";
import { useTheme } from "@/components/theme-provider";

interface Prompt {
  name: string;
  description: string;
  filename: string;
}

interface PromptDetail {
  name: string;
  content: string;
}

interface MCPItem {
  name: string;
  description: string;
}

interface MCPConfig {
  servername: string;
  databricks_host: string;
  is_databricks_app: boolean;
  client_path: string;
}

export function PromptsPage() {
  const { theme } = useTheme();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [mcpPrompts, setMcpPrompts] = useState<MCPItem[]>([]);
  const [mcpTools, setMcpTools] = useState<MCPItem[]>([]);
  const [servername, setServername] = useState<string>("");
  const [mcpConfig, setMcpConfig] = useState<MCPConfig | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isDark = theme === "dark";

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch prompts from prompts directory
      const promptsResponse = await PromptsService.listPromptsApiPromptsGet();
      setPrompts(promptsResponse);

      // Fetch MCP discovery info
      const mcpResponse =
        await McpService.getMcpDiscoveryApiMcpInfoDiscoveryGet();
      if (mcpResponse.prompts) {
        setMcpPrompts(mcpResponse.prompts);
      }
      if (mcpResponse.tools) {
        setMcpTools(mcpResponse.tools);
      }
      if (mcpResponse.servername) {
        setServername(mcpResponse.servername);
      }

      // Fetch MCP config for setup instructions
      const configResponse = await McpService.getMcpConfigApiMcpInfoConfigGet();
      setMcpConfig(configResponse);
    } catch (err) {
      setError("Failed to load data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPromptDetail = async (promptName: string) => {
    try {
      const response =
        await PromptsService.getPromptApiPromptsPromptNameGet(promptName);
      setSelectedPrompt(response);
    } catch (err) {
      setError("Failed to load prompt detail");
      console.error(err);
    }
  };

  const fetchMcpPromptDetail = async (promptName: string) => {
    try {
      const response = await fetch(`/api/mcp_info/prompt/${promptName}`);
      if (!response.ok) throw new Error("Failed to fetch prompt");
      const data = await response.json();
      setSelectedPrompt(data);
    } catch (err) {
      setError("Failed to load MCP prompt detail");
      console.error(err);
    }
  };

  const handleBack = () => {
    setSelectedPrompt(null);
    setError(null);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // You could add a toast notification here
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  if (loading) {
    return (
      <div className={`flex flex-col h-full ${
        isDark ? "bg-gradient-to-br from-[#0f2027] via-[#203a43] to-[#2c5364]"
        : "bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50"
      }`}>
        <div className="flex-1 overflow-y-auto">
          <div className="container mx-auto py-8">
            <div className={`text-center ${isDark ? "text-white" : "text-gray-900"}`}>
              Loading prompts...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex flex-col h-full ${
        isDark ? "bg-gradient-to-br from-[#0f2027] via-[#203a43] to-[#2c5364]"
        : "bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50"
      }`}>
        <div className="flex-1 overflow-y-auto">
          <div className="container mx-auto py-8">
            <div className={`text-center ${isDark ? "text-red-400" : "text-red-600"}`}>
              {error}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedPrompt) {
    return (
      <div className={`flex flex-col h-full ${
        isDark ? "bg-gradient-to-br from-[#0f2027] via-[#203a43] to-[#2c5364]"
        : "bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50"
      }`}>
        <div className="flex-1 overflow-y-auto">
          <div className="container mx-auto py-8 max-w-4xl">
            <Button
              variant="ghost"
              onClick={handleBack}
              className={`mb-6 ${
                isDark ? "text-white hover:bg-white/10" : "text-gray-900 hover:bg-gray-100"
              }`}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back to prompts
            </Button>

            <Card className={isDark ? "bg-white/5 border-white/10" : "bg-white border-gray-200"}>
              <CardHeader>
                <CardTitle className={isDark ? "text-white" : "text-gray-900"}>
                  {selectedPrompt.name
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase())}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className={`whitespace-pre-wrap font-mono text-sm p-4 rounded-lg ${
                  isDark ? "bg-black/30 text-white/90" : "bg-gray-100 text-gray-900"
                }`}>
                  {selectedPrompt.content}
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  const getMcpSetupCommand = () => {
    if (!mcpConfig) return "";

    // Use the current URL as the Databricks app URL
    const databricksAppUrl = window.location.origin;

    // Use the actual values from the API
    const databricksHost = mcpConfig.databricks_host;

    // Use the correct uvx command from the README with actual values
    return `claude mcp add ${mcpConfig.servername} --scope user -- \\
  uvx --refresh --from git+ssh://git@github.com/databricks-solutions/custom-mcp-databricks-app.git dba-mcp-proxy \\
  --databricks-host ${databricksHost} \\
  --databricks-app-url ${databricksAppUrl}`;
  };

  return (
    <div className={`flex flex-col h-full ${
      isDark ? "bg-gradient-to-br from-[#0f2027] via-[#203a43] to-[#2c5364]" : "bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50"
    }`}>
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto py-8">
          <h1 className={`text-3xl font-bold mb-8 ${isDark ? "text-white" : "text-gray-900"}`}>MCP Discovery</h1>
      
      {/* MCP Tools Section */}
      <div className="mb-12">
        <h2 className={`text-2xl font-semibold mb-4 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
          <Wrench className={`h-6 w-6 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
          MCP Tools
        </h2>

        {mcpTools.length === 0 ? (
          <div className={`text-center mb-8 ${isDark ? "text-white/60" : "text-gray-600"}`}>
            No MCP tools found.
          </div>
        ) : (
          <>
            {/* Core API Management Tools */}
            <div className="mb-8">
              <h3 className={`text-xl font-semibold mb-3 ${isDark ? "text-white/90" : "text-gray-800"}`}>
                🎯 Core API Management
              </h3>
              <p className={`text-sm mb-4 ${isDark ? "text-white/60" : "text-gray-600"}`}>
                Main tools for discovering, registering, and calling external APIs via Unity Catalog HTTP Connections
              </p>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {mcpTools
                  .filter((tool) =>
                    [
                      "register_api",
                      "check_api_http_registry",
                      "call_parameterized_api",
                      "fetch_api_documentation",
                    ].includes(tool.name)
                  )
                  .map((tool) => (
                    <Card key={tool.name} className={isDark ? "bg-blue-900/20 border-blue-500/30" : "bg-blue-50 border-blue-200"}>
                      <CardHeader>
                        <CardTitle className="text-lg">{tool.name}</CardTitle>
                        <CardDescription className="whitespace-pre-line">
                          {tool.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          Available as MCP tool
                        </p>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </div>

            {/* Connection Management Tools */}
            <div className="mb-8">
              <h3 className={`text-xl font-semibold mb-3 ${isDark ? "text-white/90" : "text-gray-800"}`}>
                🔌 HTTP Connection Management
              </h3>
              <p className={`text-sm mb-4 ${isDark ? "text-white/60" : "text-gray-600"}`}>
                Tools for managing Unity Catalog HTTP Connections
              </p>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {mcpTools
                  .filter((tool) =>
                    [
                      "list_http_connections",
                      "test_http_connection",
                      "delete_http_connection",
                    ].includes(tool.name)
                  )
                  .map((tool) => (
                    <Card key={tool.name}>
                      <CardHeader>
                        <CardTitle className="text-lg">{tool.name}</CardTitle>
                        <CardDescription className="whitespace-pre-line">
                          {tool.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          Available as MCP tool
                        </p>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </div>

            {/* System & Databricks Tools */}
            <div className="mb-8">
              <h3 className={`text-xl font-semibold mb-3 ${isDark ? "text-white/90" : "text-gray-800"}`}>
                ⚙️ System & Databricks Utilities
              </h3>
              <p className={`text-sm mb-4 ${isDark ? "text-white/60" : "text-gray-600"}`}>
                General Databricks workspace and system tools
              </p>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {mcpTools
                  .filter((tool) =>
                    [
                      "health",
                      "execute_dbsql",
                      "list_warehouses",
                      "list_dbfs_files",
                    ].includes(tool.name)
                  )
                  .map((tool) => (
                    <Card key={tool.name} className={isDark ? "bg-white/5" : "bg-gray-50"}>
                      <CardHeader>
                        <CardTitle className="text-lg">{tool.name}</CardTitle>
                        <CardDescription className="whitespace-pre-line">
                          {tool.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          Available as MCP tool
                        </p>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </div>

            {/* Advanced/Alternative Tools (collapsed by default) */}
            <details className="mb-4">
              <summary className={`cursor-pointer text-lg font-semibold mb-3 ${isDark ? "text-white/70 hover:text-white/90" : "text-gray-600 hover:text-gray-800"}`}>
                🔧 Advanced & Alternative Tools (click to expand)
              </summary>
              <p className={`text-sm mb-4 ${isDark ? "text-white/60" : "text-gray-600"}`}>
                Advanced tools and alternative registration methods. Most users won't need these.
              </p>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {mcpTools
                  .filter((tool) =>
                    [
                      "register_api_with_connection",
                      "call_registered_api",
                      "discover_api_endpoint",
                      "smart_register_with_connection",
                    ].includes(tool.name)
                  )
                  .map((tool) => (
                    <Card key={tool.name} className={isDark ? "bg-white/5 opacity-75" : "bg-gray-50 opacity-75"}>
                      <CardHeader>
                        <CardTitle className="text-lg">{tool.name}</CardTitle>
                        <CardDescription className="whitespace-pre-line">
                          {tool.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          Available as MCP tool
                        </p>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </details>
          </>
        )}
      </div>

      {/* MCP Setup Instructions Section */}
      {mcpConfig && (
        <div className="mb-12">
          <h2 className={`text-2xl font-semibold mb-4 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
            <Terminal className={`h-6 w-6 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
            Claude Code MCP Setup
          </h2>

          <Card>
            <CardHeader>
              <CardTitle>Add this MCP server to Claude Code</CardTitle>
              <CardDescription>
                Run this command in your terminal to add the MCP server to
                Claude Code CLI using uvx
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-muted p-4 rounded-lg font-mono text-sm relative group">
                <pre className="whitespace-pre-wrap">
                  {getMcpSetupCommand()}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => copyToClipboard(getMcpSetupCommand())}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-3">
                This command uses uvx to run the dba-mcp-proxy from the git
                repository. After adding, restart Claude Code to enable the MCP
                integration. Then you can use slash commands like{" "}
                <code>/{servername}:ping_google</code>.
              </p>
              <div className="mt-4 pt-3 border-t">
                <a
                  href="https://github.com/databricks-solutions/custom-mcp-databricks-app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  <ExternalLink className="h-4 w-4" />
                  View documentation and source code on GitHub
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Unified Prompts Section */}
      <div className="mb-12">
        <h2 className={`text-2xl font-semibold mb-4 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
          <FileCode className={`h-6 w-6 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
          MCP Prompts (Slash Commands)
        </h2>

        {mcpPrompts.length === 0 ? (
          <div className={`text-center mb-8 ${isDark ? "text-white/60" : "text-gray-600"}`}>
            No MCP prompts found.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
            {mcpPrompts.map((prompt) => (
              <Card
                key={prompt.name}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => fetchMcpPromptDetail(prompt.name)}
              >
                <CardHeader>
                  <CardTitle className="text-lg">
                    /{servername}:{prompt.name}
                  </CardTitle>
                  <CardDescription>{prompt.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Click to view prompt content
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

        </div>
      </div>
    </div>
  );
}
