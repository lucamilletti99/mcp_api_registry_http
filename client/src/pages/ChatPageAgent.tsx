import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  Loader2,
  Sparkles,
  Database,
  Search,
  TestTube,
  FileJson,
  Home,
  Plus,
  Wrench,
  HelpCircle,
  Activity,
  Copy,
  Check,
  Edit2,
  AlertCircle,
  User,
  Bot,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DatabaseService } from "@/fastapi_client";

interface Model {
  id: string;
  name: string;
  provider: string;
  supports_tools: boolean;
  context_window: number;
  type: string;
}

interface Warehouse {
  id: string;
  name: string;
  state: string;
  size?: string;
  type?: string;
}

interface CatalogSchema {
  catalog_name: string;
  schema_name: string;
  full_name: string;
  comment?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  tool_calls?: Array<{
    tool: string;
    args: any;
    result: any;
  }>;
  trace_id?: string; // MLflow trace ID for "View Trace" link
}

interface ChatPageAgentProps {
  onViewTrace?: (traceId: string) => void;
  selectedWarehouse: string;
  setSelectedWarehouse: (value: string) => void;
  selectedCatalogSchema: string;
  setSelectedCatalogSchema: (value: string) => void;
}

export function ChatPageAgent({
  onViewTrace,
  selectedWarehouse,
  setSelectedWarehouse,
  selectedCatalogSchema,
  setSelectedCatalogSchema,
}: ChatPageAgentProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseFilter, setWarehouseFilter] = useState<string>("");
  const [catalogSchemas, setCatalogSchemas] = useState<CatalogSchema[]>([]);
  const [catalogSchemaFilter, setCatalogSchemaFilter] = useState<string>("");
  const [tableValidation, setTableValidation] = useState<{
    exists: boolean;
    error?: string;
    message?: string;
    checking: boolean;
  }>({ exists: true, checking: false });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [tempSystemPrompt, setTempSystemPrompt] = useState<string>("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  // Filtered lists based on search
  const filteredWarehouses = warehouses.filter((w) =>
    w.name.toLowerCase().includes(warehouseFilter.toLowerCase())
  );

  const filteredCatalogSchemas = catalogSchemas.filter((cs) =>
    cs.full_name.toLowerCase().includes(catalogSchemaFilter.toLowerCase())
  );

  useEffect(() => {
    fetchModels();
    fetchWarehouses();
    fetchCatalogSchemas();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchModels = async () => {
    try {
      const response = await fetch("/api/chat/models");
      const data = await response.json();
      setModels(data.models);
      setSelectedModel(data.default);
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
  };

  const fetchWarehouses = async () => {
    try {
      const data = await DatabaseService.listWarehousesApiDbWarehousesGet();
      setWarehouses(data.warehouses || []);
      // Set first warehouse as default if available
      if (data.warehouses && data.warehouses.length > 0) {
        setSelectedWarehouse(data.warehouses[0].id);
      }
    } catch (error) {
      console.error("Failed to fetch warehouses:", error);
    }
  };

  const fetchCatalogSchemas = async () => {
    try {
      const data = await DatabaseService.listAllCatalogSchemasApiDbCatalogSchemasGet();
      setCatalogSchemas(data.catalog_schemas || []);
      // Set first catalog.schema as default if available
      if (data.catalog_schemas && data.catalog_schemas.length > 0) {
        setSelectedCatalogSchema(data.catalog_schemas[0].full_name);
      }
    } catch (error) {
      console.error("Failed to fetch catalog schemas:", error);
    }
  };

  const validateApiRegistryTable = async (catalogSchema: string, warehouseId: string) => {
    if (!catalogSchema || !warehouseId) {
      setTableValidation({ exists: false, message: "Please select warehouse and catalog.schema", checking: false });
      return;
    }

    const parts = catalogSchema.split('.');
    if (parts.length !== 2) {
      setTableValidation({ exists: false, error: "Invalid catalog.schema format", checking: false });
      return;
    }

    const [catalog, schema] = parts;

    setTableValidation({ exists: true, checking: true });

    try {
      const data = await DatabaseService.validateApiRegistryTableApiDbValidateApiRegistryTableGet(
        catalog,
        schema,
        warehouseId
      );

      setTableValidation({
        exists: data.exists || false,
        error: data.error,
        message: data.message,
        checking: false,
      });
    } catch (error) {
      console.error("Failed to validate api_http_registry table:", error);
      setTableValidation({
        exists: false,
        error: "Validation failed",
        message: "Could not validate table existence",
        checking: false,
      });
    }
  };

  // Validate table when warehouse or catalog/schema changes
  useEffect(() => {
    if (selectedWarehouse && selectedCatalogSchema) {
      validateApiRegistryTable(selectedCatalogSchema, selectedWarehouse);
    }
  }, [selectedWarehouse, selectedCatalogSchema]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: "user",
      content: input,
    };

    // Add user message and a temporary "thinking" message
    setMessages((prev) => [...prev, userMessage, {
      role: "assistant",
      content: "Thinking...",
    }]);
    setInput("");
    setLoading(true);

    try {
      // Call the NEW agent endpoint - it does all the orchestration!
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...messages.map(m => ({ role: m.role, content: m.content })), userMessage],
          model: selectedModel,
          system_prompt: systemPrompt || undefined, // Include custom system prompt if set
          warehouse_id: selectedWarehouse || undefined, // Pass selected warehouse
          catalog_schema: selectedCatalogSchema || undefined, // Pass selected catalog.schema
        }),
      });

      const data = await response.json();

      // Remove the temporary "thinking" message
      setMessages((prev) => prev.slice(0, -1));

      // Check for API errors
      if (data.detail) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${data.detail}`,
          },
        ]);
        return;
      }

      // Add the assistant's response
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
          tool_calls: data.tool_calls, // Show which tools were used
          trace_id: data.trace_id, // MLflow trace ID for "View Trace" link
        },
      ]);

    } catch (error) {
      console.error("Failed to send message:", error);
      // Remove thinking message
      setMessages((prev) => prev.slice(0, -1));
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error processing your request.",
        },
      ]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const resetChat = () => {
    setMessages([]);
    setInput("");
  };

  const handleOpenSystemPrompt = () => {
    setTempSystemPrompt(systemPrompt);
    setShowSystemPrompt(true);
  };

  const handleSaveSystemPrompt = () => {
    setSystemPrompt(tempSystemPrompt);
    setShowSystemPrompt(false);
  };

  const handleCancelSystemPrompt = () => {
    setTempSystemPrompt(systemPrompt);
    setShowSystemPrompt(false);
  };

  const handleResetSystemPrompt = () => {
    setTempSystemPrompt("");
  };

  const handleCopyMessage = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleEditMessage = (index: number, content: string) => {
    setEditingIndex(index);
    setEditingContent(content);
  };

  const handleSaveEdit = async (index: number) => {
    if (!editingContent.trim()) return;

    // Remove all messages after the edited one
    const updatedMessages = messages.slice(0, index);
    setMessages(updatedMessages);
    setEditingIndex(null);

    // Set the edited content as the new input and send it
    setInput(editingContent);
    setEditingContent("");

    // Trigger send with the new content
    const userMessage: Message = {
      role: "user",
      content: editingContent,
    };

    setMessages((prev) => [...prev, userMessage, {
      role: "assistant",
      content: "Thinking...",
    }]);
    setLoading(true);

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...updatedMessages.map(m => ({ role: m.role, content: m.content })), userMessage],
          model: selectedModel,
          system_prompt: systemPrompt || undefined,
          warehouse_id: selectedWarehouse || undefined, // Pass selected warehouse
          catalog_schema: selectedCatalogSchema || undefined, // Pass selected catalog.schema
        }),
      });

      const data = await response.json();
      setMessages((prev) => prev.slice(0, -1));

      if (data.detail) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${data.detail}`,
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
          tool_calls: data.tool_calls,
          trace_id: data.trace_id,
        },
      ]);
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => prev.slice(0, -1));
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error processing your request.",
        },
      ]);
    } finally {
      setLoading(false);
      setInput("");
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditingContent("");
  };

  const suggestedActions = [
    {
      icon: <Search className="h-4 w-4" />,
      label: "Discover",
      prompt: "Discover the Alpha Vantage API for stock data",
    },
    {
      icon: <Database className="h-4 w-4" />,
      label: "Register",
      prompt: "Help me register a new API in the registry",
    },
    {
      icon: <FileJson className="h-4 w-4" />,
      label: "Query",
      prompt: "Show me all registered APIs in the registry",
    },
    {
      icon: <TestTube className="h-4 w-4" />,
      label: "Test",
      prompt: "Test if my registered API is still healthy",
    },
    {
      icon: <Wrench className="h-4 w-4" />,
      label: "Tools",
      prompt: "What tools do I have available?",
    },
  ];

  const isDark = theme === "dark";

  return (
    <div
      className={`flex flex-col h-full ${
        isDark
          ? "bg-gradient-to-br from-[#1C3D42] via-[#24494F] to-[#2C555C]"
          : "bg-gradient-to-br from-gray-50 via-white to-gray-100"
      } transition-all duration-500`}
    >
      {/* Top Bar */}
      <div className={`flex items-center justify-between p-4 ${
        isDark ? "bg-black/20" : "bg-white/60"
      } backdrop-blur-sm border-b ${
        isDark ? "border-white/10" : "border-gray-200"
      }`}>
        <div className="flex items-center gap-3">
          <Sparkles className={`h-5 w-5 ${isDark ? "text-[#FF8A80]" : "text-[#FF3621]"}`} />
          <span className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
            API Registry Agent
          </span>
          <span className={`text-xs px-2 py-1 rounded ${isDark ? "bg-[#FF3621]/20 text-[#FF8A80]" : "bg-[#FF3621]/10 text-[#FF3621]"}`}>
            MCP Powered
          </span>
          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={resetChat}
              className={`gap-2 ${
                isDark
                  ? "bg-white/5 border-white/20 text-white hover:bg-white/10"
                  : "bg-white border-gray-300 text-gray-900 hover:bg-gray-100"
              }`}
            >
              <Home className="h-4 w-4" />
              New Chat
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className={`w-[240px] ${
              isDark
                ? "bg-black/20 border-white/20 text-white"
                : "bg-white border-gray-300 text-gray-900"
            } backdrop-blur-sm`}>
              <SelectValue placeholder="Select model">
                {models.find((m) => m.id === selectedModel)?.name || "Select model"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem
                  key={model.id}
                  value={model.id}
                  disabled={!model.supports_tools}
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${!model.supports_tools ? 'text-muted-foreground' : ''}`}>
                        {model.name}
                      </span>
                      {!model.supports_tools && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                          Not tool-enabled
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {model.provider} • {model.context_window.toLocaleString()} tokens
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select 
            value={selectedWarehouse} 
            onValueChange={(value) => {
              setSelectedWarehouse(value);
              setWarehouseFilter(""); // Clear filter on selection
            }}
            onOpenChange={(open) => {
              if (!open) setWarehouseFilter(""); // Clear filter on close
            }}
          >
            <SelectTrigger className={`w-[200px] ${
              isDark
                ? "bg-black/20 border-white/20 text-white"
                : "bg-white border-gray-300 text-gray-900"
            } backdrop-blur-sm`}>
              <SelectValue placeholder="Select warehouse">
                {warehouses.find((w) => w.id === selectedWarehouse)?.name || "Select warehouse"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <div className="flex items-center px-2 pb-2 sticky top-0 bg-background">
                <Search className="h-4 w-4 mr-2 text-muted-foreground" />
                <Input
                  placeholder="Search warehouses..."
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                  className="h-8 text-sm"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {filteredWarehouses.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No warehouses found
                  </div>
                ) : (
                  filteredWarehouses.map((warehouse) => (
                    <SelectItem
                      key={warehouse.id}
                      value={warehouse.id}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{warehouse.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {warehouse.size} • {warehouse.state}
                        </span>
                      </div>
                    </SelectItem>
                  ))
                )}
              </div>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Select 
              value={selectedCatalogSchema} 
              onValueChange={(value) => {
                setSelectedCatalogSchema(value);
                setCatalogSchemaFilter(""); // Clear filter on selection
              }}
              onOpenChange={(open) => {
                if (!open) setCatalogSchemaFilter(""); // Clear filter on close
              }}
            >
              <SelectTrigger className={`w-[280px] ${
                isDark
                  ? "bg-black/20 text-white"
                  : "bg-white text-gray-900"
              } ${
                !tableValidation.exists && !tableValidation.checking
                  ? "border-red-500 border-2"
                  : isDark
                  ? "border-white/20"
                  : "border-gray-300"
              } backdrop-blur-sm`}>
                <SelectValue placeholder="Select catalog.schema">
                  {selectedCatalogSchema || "Select catalog.schema"}
                </SelectValue>
              </SelectTrigger>
            <SelectContent>
              <div className="flex items-center px-2 pb-2 sticky top-0 bg-background">
                <Search className="h-4 w-4 mr-2 text-muted-foreground" />
                <Input
                  placeholder="Search catalog.schema..."
                  value={catalogSchemaFilter}
                  onChange={(e) => setCatalogSchemaFilter(e.target.value)}
                  className="h-8 text-sm"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {filteredCatalogSchemas.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No catalog.schema found
                  </div>
                ) : (
                  filteredCatalogSchemas.map((cs) => (
                    <SelectItem
                      key={cs.full_name}
                      value={cs.full_name}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{cs.full_name}</span>
                        {cs.comment && (
                          <span className="text-xs text-muted-foreground">{cs.comment}</span>
                        )}
                      </div>
                    </SelectItem>
                  ))
                )}
              </div>
            </SelectContent>
            </Select>
            {!tableValidation.exists && !tableValidation.checking && (
              <div className="flex items-center gap-1 text-red-500" title={`No api_http_registry table exists in ${selectedCatalogSchema}. Switch to a catalog.schema with the api_http_registry table, or run setup_api_http_registry_table.sql to create it.`}>
                <AlertCircle className="h-4 w-4" />
                <span className="text-xs">No api_http_registry table in this schema</span>
              </div>
            )}
            {tableValidation.checking && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {/* Error Banner for Missing Table */}
      {!tableValidation.exists && !tableValidation.checking && selectedCatalogSchema && (
        <div className={`mx-6 mt-3 rounded-lg border-2 p-4 ${
          isDark
            ? "bg-red-500/5 border-red-500/30"
            : "bg-red-50/50 border-red-200"
        }`}>
          <div className="flex items-start gap-3">
            <AlertCircle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
              isDark ? "text-[#FF8A80]" : "text-[#FF3621]"
            }`} />
            <div className="flex-1">
              <h3 className={`font-semibold text-sm mb-1 ${
                isDark ? "text-white" : "text-gray-900"
              }`}>
                No api_http_registry table exists in {selectedCatalogSchema}
              </h3>
              <div className={`text-xs space-y-0.5 ${
                isDark ? "text-white/70" : "text-gray-700"
              }`}>
                <p>Switch to a catalog.schema with the api_http_registry table,</p>
                <p>or run setup_api_http_registry_table.sql to create it in <span className="font-mono font-medium">{selectedCatalogSchema}</span></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center min-h-full px-6 py-20">
            <div className="max-w-3xl w-full space-y-8">
              <div className="text-center space-y-4">
                <h1 className={`text-5xl font-bold ${
                  isDark ? "text-white" : "text-gray-900"
                }`}>
                  What can I help you with today?
                </h1>
                <p className={`text-lg ${
                  isDark ? "text-white/80" : "text-gray-600"
                }`}>
                  I can help you discover, register, and manage API endpoints
                </p>
              </div>

              {/* Search Input */}
              <div className="relative">
                <Textarea
                  ref={textareaRef}
                  placeholder="Explore APIs, register endpoints, or query the registry..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className={`min-h-[100px] text-lg ${
                    isDark
                      ? "bg-white/10 border-white/20 text-white placeholder:text-white/60"
                      : "bg-white border-gray-300 text-gray-900 placeholder:text-gray-500"
                  } backdrop-blur-md resize-none focus:ring-2 ${
                    isDark ? "focus:ring-[#FF3621]" : "focus:ring-[#FF3621]"
                  } transition-all shadow-lg`}
                  disabled={loading}
                />
                <Button
                  onClick={sendMessage}
                  disabled={loading || !input.trim()}
                  size="lg"
                  className={`absolute bottom-4 right-4 rounded-full text-white shadow-lg ${
                    isDark
                      ? "bg-[#2C555C] hover:bg-[#24494F]"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </Button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 flex-wrap justify-center">
                {suggestedActions.map((action) => (
                  <Button
                    key={action.label}
                    variant="outline"
                    className={`gap-2 ${
                      isDark
                        ? "bg-white/10 border-white/20 text-white hover:bg-white/20"
                        : "bg-white border-gray-300 text-gray-900 hover:bg-gray-100"
                    } backdrop-blur-sm shadow-md transition-all`}
                    onClick={() => setInput(action.prompt)}
                  >
                    {action.icon}
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Conversation View */
          <div className="max-w-4xl mx-auto py-8 px-6 space-y-6">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {/* Icon - shown on left for assistant, right for user */}
                {message.role === "assistant" && (
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    isDark ? "bg-white/10 text-white" : "bg-gray-200 text-gray-700"
                  }`}>
                    <Bot className="h-5 w-5" />
                  </div>
                )}

                <div
                  className={`max-w-[80%] rounded-2xl px-6 py-4 shadow-lg relative group ${
                    message.role === "user"
                      ? isDark
                        ? "bg-[#2C555C] text-white border border-white/10"
                        : "bg-[#E3F2FD] text-gray-900 border border-blue-200"
                      : isDark
                      ? "bg-white/10 backdrop-blur-md text-white border border-white/20"
                      : "bg-white text-gray-900 border border-gray-200"
                  }`}
                >
                  {/* Action Buttons */}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {message.role === "assistant" && message.content !== "Thinking..." && (
                      <button
                        onClick={() => handleCopyMessage(message.content, index)}
                        className={`p-1.5 rounded-lg transition-all ${
                          isDark
                            ? "hover:bg-white/10 text-white/60 hover:text-white"
                            : "hover:bg-gray-100 text-gray-500 hover:text-gray-900"
                        }`}
                        title="Copy message"
                      >
                        {copiedIndex === index ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    {message.role === "user" && editingIndex !== index && (
                      <button
                        onClick={() => handleEditMessage(index, message.content)}
                        className={`p-1.5 rounded-lg transition-all ${
                          isDark
                            ? "hover:bg-white/10 text-white/60 hover:text-white"
                            : "hover:bg-black/5 text-gray-500 hover:text-gray-900"
                        }`}
                        title="Edit and resend"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Message Content */}
                  {editingIndex === index ? (
                    <div className="space-y-3">
                      <Textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className={`min-h-[100px] ${
                          isDark
                            ? "bg-white/10 border-white/20 text-white"
                            : "bg-white border-gray-300 text-gray-900"
                        }`}
                        autoFocus
                      />
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelEdit}
                          className={isDark ? "border-white/20 text-white hover:bg-white/10" : ""}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSaveEdit(index)}
                          className={
                            isDark
                              ? "bg-[#2C555C] hover:bg-[#24494F] text-white"
                              : "bg-blue-600 hover:bg-blue-700 text-white"
                          }
                        >
                          Send
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        className={`prose prose-invert max-w-none ${message.content === "Thinking..." ? "typing-indicator" : ""}`}
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            marked.parse(message.content, { breaks: true, gfm: true }) as string,
                            {
                              ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'del', 'input'],
                              ALLOWED_ATTR: ['href', 'target', 'class', 'style', 'type', 'checked', 'disabled']
                            }
                          )
                        }}
                      />
                      {message.tool_calls && message.tool_calls.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.tool_calls.map((toolCall, tcIndex) => (
                            <span
                              key={tcIndex}
                              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                                message.role === "user"
                                  ? "bg-white/20"
                                  : isDark
                                  ? "bg-[#FF3621]/20 text-[#FF8A80]"
                                  : "bg-[#FF3621]/10 text-[#FF3621]"
                              }`}
                            >
                              <Sparkles className="h-3 w-3" />
                              {toolCall.tool}
                            </span>
                          ))}
                        </div>
                      )}
                      {message.trace_id && (
                        <div className="mt-3">
                          <button
                            onClick={() => onViewTrace && onViewTrace(message.trace_id!)}
                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all hover:scale-105 ${
                              isDark
                                ? "bg-green-500/20 text-green-300 hover:bg-green-500/30"
                                : "bg-green-100 text-green-700 hover:bg-green-200"
                            }`}
                          >
                            <Activity className="h-3 w-3" />
                            View Trace
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* User Icon - shown on right for user messages */}
                {message.role === "user" && (
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    isDark ? "bg-[#2C555C] text-white border border-white/10" : "bg-[#E3F2FD] text-gray-700 border border-blue-200"
                  }`}>
                    <User className="h-5 w-5" />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className={`max-w-[80%] rounded-2xl px-6 py-4 shadow-lg ${
                  isDark
                    ? "bg-white/10 backdrop-blur-md border border-white/20"
                    : "bg-white border border-gray-200"
                }`}>
                  <div className={`flex items-center gap-2 ${
                    isDark ? "text-white/80" : "text-gray-600"
                  }`}>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm font-medium">Agent is thinking and using tools...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* System Prompt Trigger Button - Fixed on Right Edge */}
      <button
        onClick={handleOpenSystemPrompt}
        onMouseEnter={() => setShowSystemPrompt(true)}
        className={`fixed right-0 top-1/2 -translate-y-1/2 z-20 px-2 py-6 rounded-l-lg shadow-lg transition-all duration-300 ${
          isDark
            ? "bg-white/10 border-l border-t border-b border-white/20 text-white hover:bg-white/20"
            : "bg-white border-l border-t border-b border-gray-200 text-gray-900 hover:bg-gray-50"
        } backdrop-blur-md flex items-center gap-2 text-sm writing-mode-vertical`}
        style={{ writingMode: 'vertical-rl' }}
      >
        <Plus className="h-4 w-4" />
        <span>{systemPrompt ? "Edit System Prompt" : "Add System Prompt"}</span>
      </button>

      {/* System Prompt Panel - Slides from Right */}
      <div
        className={`fixed right-0 top-0 h-full w-96 z-30 transition-transform duration-300 ${
          showSystemPrompt ? "translate-x-0" : "translate-x-full"
        } ${
          isDark ? "bg-black/90" : "bg-white/95"
        } backdrop-blur-lg border-l ${
          isDark ? "border-white/20" : "border-gray-200"
        } shadow-2xl`}
        onMouseLeave={() => !tempSystemPrompt && setShowSystemPrompt(false)}
      >
        <div className="flex flex-col h-full p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className={`text-lg font-semibold ${
              isDark ? "text-white" : "text-gray-900"
            }`}>
              System Prompt
            </h3>
            <button
              onClick={handleCancelSystemPrompt}
              className={`p-2 rounded-lg transition-colors ${
                isDark
                  ? "hover:bg-white/10 text-white"
                  : "hover:bg-gray-100 text-gray-900"
              }`}
            >
              <span className="text-xl">&times;</span>
            </button>
          </div>

          <div className="flex-1 flex flex-col gap-4">
            <label className={`text-sm font-medium ${
              isDark ? "text-white/80" : "text-gray-700"
            }`}>
              Customize the agent's behavior and role:
            </label>
            <Textarea
              value={tempSystemPrompt}
              onChange={(e) => setTempSystemPrompt(e.target.value)}
              placeholder="Optionally override the system prompt. Define the agent's role, capabilities, and behavior here..."
              className={`flex-1 ${
                isDark
                  ? "bg-white/5 border-[#FF3621]/50 text-white placeholder:text-white/40 focus:border-[#FF3621]"
                  : "bg-white border-[#FF3621]/50 text-gray-900 placeholder:text-gray-400 focus:border-[#FF3621]"
              } resize-none`}
            />
          </div>

          <div className={`flex items-center justify-end gap-2 mt-6 pt-6 border-t ${
            isDark ? "border-white/20" : "border-gray-200"
          }`}>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetSystemPrompt}
              className={isDark ? "text-[#FF8A80] hover:text-[#FF3621] hover:bg-white/10" : "text-[#FF3621] hover:text-[#E02E1A]"}
            >
              Reset
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelSystemPrompt}
              className={isDark ? "border-white/20 text-white hover:bg-white/10" : ""}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveSystemPrompt}
              className={
                isDark
                  ? "bg-[#2C555C] hover:bg-[#24494F] text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }
            >
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Bottom Input (shown when in conversation) */}
      {messages.length > 0 && (
        <div className={`p-4 ${
          isDark ? "bg-black/20" : "bg-white/60"
        } backdrop-blur-sm border-t ${
          isDark ? "border-white/10" : "border-gray-200"
        }`}>
          <div className="max-w-4xl mx-auto">
            {/* Quick Action Buttons - Horizontal row above input */}
            <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-2">
              {suggestedActions.map((action, index) => (
                <button
                  key={action.label}
                  onClick={() => setInput(action.prompt)}
                  className={`group flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300 hover:scale-105 whitespace-nowrap ${
                    isDark
                      ? "bg-white/10 border border-white/20 text-white hover:bg-white/20"
                      : "bg-white border border-gray-200 text-gray-900 hover:bg-gray-50"
                  } backdrop-blur-md shadow-md`}
                  style={{
                    animation: `fadeInRight 0.3s ease-out ${index * 0.1}s both`,
                  }}
                >
                  {action.icon}
                  <span className="text-sm font-medium">{action.label}</span>
                </button>
              ))}
            </div>

            <div className="relative">
              <Textarea
                ref={textareaRef}
                placeholder="Continue the conversation..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className={`min-h-[60px] pr-14 ${
                  isDark
                    ? "bg-white/10 border-white/20 text-white placeholder:text-white/60"
                    : "bg-white border-gray-300 text-gray-900 placeholder:text-gray-500"
                } backdrop-blur-md resize-none shadow-lg`}
                disabled={loading}
              />
              <Button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                size="icon"
                className={`absolute bottom-3 right-3 rounded-full text-white shadow-lg ${
                  isDark
                    ? "bg-[#2C555C] hover:bg-[#24494F]"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* FAQ/Help Button - Bottom Left */}
      <Dialog>
        <DialogTrigger asChild>
          <button
            className={`fixed bottom-6 left-6 z-20 flex items-center gap-3 px-4 py-3 rounded-full shadow-lg transition-all duration-300 hover:scale-105 ${
              isDark
                ? "bg-white/10 border border-white/20 text-white hover:bg-white/20"
                : "bg-white border border-gray-200 text-gray-900 hover:bg-gray-50"
            } backdrop-blur-md`}
            title="Help & FAQ"
          >
            <HelpCircle className="h-6 w-6" />
            <span className="text-sm font-medium">User Guide</span>
          </button>
        </DialogTrigger>
        <DialogContent className={`max-w-2xl max-h-[80vh] overflow-y-auto ${
          isDark ? "bg-gray-900 text-white border-white/20" : "bg-white text-gray-900"
        }`}>
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">How to Use the API Registry Agent</DialogTitle>
            <DialogDescription className={isDark ? "text-gray-400" : "text-gray-600"}>
              Your AI-powered assistant for managing and testing APIs
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 mt-4">
            <section>
              <h3 className="text-lg font-semibold mb-2">🚀 Getting Started</h3>
              <p className={isDark ? "text-gray-300" : "text-gray-700"}>
                The API Registry Agent uses MCP (Model Context Protocol) tools to help you discover, register, query, and test API endpoints. Simply chat with the agent using natural language!
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">🎯 Quick Actions</h3>
              <p className={isDark ? "text-gray-300 mb-2" : "text-gray-700 mb-2"}>
                Use the quick action buttons for common tasks:
              </p>
              <ul className={`list-disc list-inside space-y-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                <li><strong>Discover:</strong> Find and explore new APIs from the web</li>
                <li><strong>Register:</strong> Add APIs to your centralized registry</li>
                <li><strong>Query:</strong> Check what APIs are in your registry</li>
                <li><strong>Test:</strong> Verify API health and functionality</li>
                <li><strong>Tools:</strong> See all available MCP tools</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">💬 Example Prompts</h3>
              <ul className={`list-disc list-inside space-y-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                <li>"Discover APIs related to weather data"</li>
                <li>"Register the API at https://api.example.com"</li>
                <li>"What APIs are in my registry?"</li>
                <li>"Test if my weather API is healthy"</li>
                <li>"Execute a SQL query to count all registered APIs"</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">🛠️ Available Tools</h3>
              <ul className={`list-disc list-inside space-y-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                <li><strong>create_http_connection:</strong> Create UC HTTP connections (secure credentials)</li>
                <li><strong>smart_register_with_connection:</strong> One-step API registration (creates connection + registers API)</li>
                <li><strong>discover_api_endpoint:</strong> Test and validate API endpoints</li>
                <li><strong>fetch_api_documentation:</strong> Parse API documentation</li>
                <li><strong>check_api_http_registry:</strong> View registered APIs</li>
                <li><strong>call_registered_api:</strong> Call registered APIs via UC connections</li>
                <li><strong>execute_dbsql:</strong> Run SQL queries on Databricks</li>
                <li><strong>list_warehouses:</strong> List SQL warehouses</li>
                <li><strong>list_http_connections:</strong> List UC HTTP connections</li>
                <li><strong>list_dbfs_files:</strong> Browse DBFS files</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">⚙️ Custom System Prompt</h3>
              <p className={isDark ? "text-gray-300" : "text-gray-700"}>
                Click the "Add System Prompt" button on the right edge to customize the agent's behavior and role for your specific use case.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">✨ Features</h3>
              <ul className={`list-disc list-inside space-y-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                <li>Markdown rendering for formatted responses</li>
                <li>Real-time tool execution tracking</li>
                <li>Model selection (Claude, Llama, etc.)</li>
                <li>Dark/Light theme toggle</li>
                <li>Conversation history management</li>
              </ul>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
