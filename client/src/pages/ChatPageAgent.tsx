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
  const [debouncedWarehouseFilter, setDebouncedWarehouseFilter] = useState<string>("");
  
  // TWO-DROPDOWN ARCHITECTURE: Separate catalog and schema
  const [catalogs, setCatalogs] = useState<{name: string; comment?: string}[]>([]);
  const [schemas, setSchemas] = useState<{name: string; comment?: string}[]>([]);
  const [selectedCatalog, setSelectedCatalog] = useState<string>("");
  const [selectedSchema, setSelectedSchema] = useState<string>("");
  const [catalogFilter, setCatalogFilter] = useState<string>("");
  const [schemaFilter, setSchemaFilter] = useState<string>("");
  const [debouncedCatalogFilter, setDebouncedCatalogFilter] = useState<string>("");
  const [debouncedSchemaFilter, setDebouncedSchemaFilter] = useState<string>("");
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
  const [showCredentialDialog, setShowCredentialDialog] = useState(false);
  const [credentialType, setCredentialType] = useState<"api_key" | "bearer_token">("api_key");
  const [credentialValue, setCredentialValue] = useState<string>("");
  const [pendingApiName, setPendingApiName] = useState<string>("");
  const [pendingEndpoints, setPendingEndpoints] = useState<Array<{
    path: string;
    description: string;
    method: string;
  }>>([]);
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<number>>(new Set());
  const [endpointRegistrationData, setEndpointRegistrationData] = useState<{
    api_name?: string;
    host?: string;
    base_path?: string;
    auth_type?: string;
  } | null>(null);
  
  // Secure credential storage - stored in session, not in messages!
  const [storedCredentials, setStoredCredentials] = useState<{
    api_key?: string;
    bearer_token?: string;
  }>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  // Sync separate catalog + schema to parent's combined state
  useEffect(() => {
    if (selectedCatalog && selectedSchema) {
      const combined = `${selectedCatalog}.${selectedSchema}`;
      if (combined !== selectedCatalogSchema) {
        setSelectedCatalogSchema(combined);
      }
    }
  }, [selectedCatalog, selectedSchema]);

  // Parse parent's combined state on mount/change
  useEffect(() => {
    if (selectedCatalogSchema && selectedCatalogSchema.includes('.')) {
      const [catalog, schema] = selectedCatalogSchema.split('.');
      if (catalog !== selectedCatalog) setSelectedCatalog(catalog);
      if (schema !== selectedSchema) setSelectedSchema(schema);
    }
  }, [selectedCatalogSchema]);

  // Fetch schemas when catalog changes
  useEffect(() => {
    if (selectedCatalog) {
      fetchSchemas(selectedCatalog);
    } else {
      setSchemas([]);
      setSelectedSchema("");
    }
  }, [selectedCatalog]);

  // Server-side search with debounce - WAREHOUSES
  useEffect(() => {
    const timer = setTimeout(() => {
      if (warehouseFilter !== debouncedWarehouseFilter) {
        setDebouncedWarehouseFilter(warehouseFilter);
        fetchWarehouses(warehouseFilter);
      }
    }, 750);
    return () => clearTimeout(timer);
  }, [warehouseFilter]);

  // Server-side search with debounce - CATALOGS
  useEffect(() => {
    const timer = setTimeout(() => {
      if (catalogFilter !== debouncedCatalogFilter) {
        setDebouncedCatalogFilter(catalogFilter);
        fetchCatalogs(catalogFilter);
      }
    }, 750);
    return () => clearTimeout(timer);
  }, [catalogFilter]);

  // Server-side search with debounce - SCHEMAS
  useEffect(() => {
    const timer = setTimeout(() => {
      if (schemaFilter !== debouncedSchemaFilter) {
        setDebouncedSchemaFilter(schemaFilter);
        if (selectedCatalog) {
          fetchSchemas(selectedCatalog, schemaFilter);
        }
      }
    }, 750);
    return () => clearTimeout(timer);
  }, [schemaFilter]);

  // No client-side filtering needed - using server-side filtering
  const filteredWarehouses = warehouses;
  const filteredCatalogs = catalogs;
  const filteredSchemas = schemas;

  useEffect(() => {
    fetchModels();
    fetchWarehouses(); // Initial load without search
    fetchCatalogs(); // Load catalogs first
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

  const fetchWarehouses = async (search?: string) => {
    try {
      console.log(`🔍 Fetching warehouses${search ? ` (search: "${search}")` : ''}...`);
      const queryParams = new URLSearchParams();
      if (search) queryParams.append('search', search);
      
      const response = await fetch(`/api/db/warehouses?${queryParams}`);
      const data = await response.json();
      
      console.log("✅ Warehouses data:", data);
      setWarehouses(data.warehouses || []);
      
      // Set first warehouse as default if available and not already set
      if (data.warehouses && data.warehouses.length > 0 && !selectedWarehouse) {
        console.log(`📊 Setting default warehouse: ${data.warehouses[0].name} (${data.warehouses[0].id})`);
        setSelectedWarehouse(data.warehouses[0].id);
      } else if (!data.warehouses || data.warehouses.length === 0) {
        console.warn("⚠️ No warehouses returned from API");
      }
    } catch (error) {
      console.error("❌ Failed to fetch warehouses:", error);
      setWarehouses([]);
    }
  };

  const fetchCatalogs = async (search?: string) => {
    try {
      console.log(`🔍 Fetching catalogs${search ? ` (search: "${search}")` : ''}...`);
      const response = await fetch('/api/db/catalogs');
      const data = await response.json();
      
      console.log("✅ Catalogs data:", data);
      const catalogList = data.catalogs || [];
      
      // Apply client-side search filter if provided
      const filtered = search 
        ? catalogList.filter((c: any) => c.name.toLowerCase().includes(search.toLowerCase()))
        : catalogList;
      
      setCatalogs(filtered);
      
      // Set first catalog as default if available and not already set
      if (filtered.length > 0 && !selectedCatalog) {
        console.log(`📊 Setting default catalog: ${filtered[0].name}`);
        setSelectedCatalog(filtered[0].name);
      } else if (filtered.length === 0) {
        console.warn("⚠️ No catalogs returned from API");
      }
    } catch (error) {
      console.error("❌ Failed to fetch catalogs:", error);
      setCatalogs([]);
    }
  };

  const fetchSchemas = async (catalogName: string, search?: string) => {
    try {
      console.log(`🔍 Fetching schemas for catalog "${catalogName}"${search ? ` (search: "${search}")` : ''}...`);
      const response = await fetch(`/api/db/schemas/${encodeURIComponent(catalogName)}`);
      const data = await response.json();
      
      console.log("✅ Schemas data:", data);
      const schemaList = data.schemas || [];
      
      // Apply client-side search filter if provided
      const filtered = search
        ? schemaList.filter((s: any) => s.name.toLowerCase().includes(search.toLowerCase()))
        : schemaList;
      
      setSchemas(filtered);
      
      // Set first schema as default if available and not already set
      if (filtered.length > 0 && !selectedSchema) {
        console.log(`📊 Setting default schema: ${filtered[0].name}`);
        setSelectedSchema(filtered[0].name);
      } else if (filtered.length === 0) {
        console.warn(`⚠️ No schemas found in catalog "${catalogName}"`);
      }
    } catch (error) {
      console.error(`❌ Failed to fetch schemas for catalog "${catalogName}":`, error);
      setSchemas([]);
    }
  };

  // DEPRECATED: Old combined fetch - keeping for reference, will remove
  const fetchCatalogSchemas_OLD = async (search?: string, limit: number = 100) => {
    try {
      console.log(`🔍 Fetching catalog schemas${search ? ` (search: "${search}")` : ''} (limit: ${limit})...`);
      // Use fetch with query params for server-side filtering and limiting
      const queryParams = new URLSearchParams();
      queryParams.append('limit', limit.toString());
      if (search) queryParams.append('search', search);
      
      const response = await fetch(`/api/db/catalog-schemas?${queryParams}`);
      const data = await response.json();
      
      console.log("✅ Catalog schemas data:", data);
      setCatalogSchemas(data.catalog_schemas || []);
      
      // Warn if there are more results
      if (data.has_more) {
        console.log(`ℹ️ Showing first ${data.count} results. Use search to narrow down.`);
      }
      
      // Set first catalog.schema as default if available and not already set
      if (data.catalog_schemas && data.catalog_schemas.length > 0 && !selectedCatalogSchema) {
        console.log(`📊 Setting default catalog.schema: ${data.catalog_schemas[0].full_name}`);
        setSelectedCatalogSchema(data.catalog_schemas[0].full_name);
      } else if (!data.catalog_schemas || data.catalog_schemas.length === 0) {
        console.warn("⚠️ No catalog schemas returned from API");
      }
    } catch (error) {
      console.error("❌ Failed to fetch catalog schemas:", error);
      setCatalogSchemas([]);
    }
  };

  const validateApiRegistryTable = async (catalog: string, schema: string, warehouseId: string) => {
    if (!catalog || !schema || !warehouseId) {
      setTableValidation({ exists: false, message: "Please select warehouse, catalog, and schema", checking: false });
      return;
    }

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
    if (selectedWarehouse && selectedCatalog && selectedSchema) {
      validateApiRegistryTable(selectedCatalog, selectedSchema, selectedWarehouse);
    }
  }, [selectedWarehouse, selectedCatalog, selectedSchema]);

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
          // Pass credentials as metadata, NOT in message content!
          credentials: storedCredentials,
        }),
      });

      if (!response.ok) {
        // Handle HTTP errors
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
        console.error("❌ [ERROR] API request failed:", response.status, errorData);
        
        // Remove the temporary "thinking" message
        setMessages((prev) => prev.slice(0, -1));
        
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${errorData.detail || "Request failed"}`,
          },
        ]);
        return;
      }

      const data = await response.json();

      // Remove the temporary "thinking" message
      setMessages((prev) => prev.slice(0, -1));

      // Check for API errors in successful response
      if (data.detail) {
        console.error("❌ [ERROR] Error in response data:", data.detail);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${data.detail}`,
          },
        ]);
        return;
      }

      // Check if response contains markers
      const responseText = data.response;
      console.log("🔍 [DEBUG] Full response text:", responseText);
      
      const needsApiKey = responseText.includes("[CREDENTIAL_REQUEST:API_KEY]");
      const needsBearerToken = responseText.includes("[CREDENTIAL_REQUEST:BEARER_TOKEN]");
      const hasEndpointOptions = responseText.includes("[ENDPOINT_OPTIONS:");
      
      console.log("🔍 [DEBUG] Marker detection:", { needsApiKey, needsBearerToken, hasEndpointOptions });
      
      // Extract API name if mentioned (look for it in the response)
      let apiName = "";
      const apiNameMatch = responseText.match(/for\s+([A-Za-z0-9_\s-]+?)[\.\n\[]|provide your (?:API key|bearer token) for ([A-Za-z0-9_\s-]+)|register.*?([A-Za-z0-9_\s-]+)\s+(?:API|api|endpoint)/i);
      if (apiNameMatch) {
        apiName = (apiNameMatch[1] || apiNameMatch[2] || apiNameMatch[3] || "").trim();
      }

      // Extract endpoint options information if present
      let endpoints: Array<{path: string; description: string; method: string}> = [];
      let registrationData: any = null;
      
      // Extract JSON by finding balanced braces
      // This handles nested objects/arrays properly
      const markerStart = responseText.indexOf("[ENDPOINT_OPTIONS:");
      if (markerStart !== -1) {
        const jsonStart = responseText.indexOf("{", markerStart);
        if (jsonStart !== -1) {
          // Find the matching closing brace by counting
          let braceCount = 0;
          let jsonEnd = jsonStart;
          for (let i = jsonStart; i < responseText.length; i++) {
            if (responseText[i] === '{') braceCount++;
            if (responseText[i] === '}') braceCount--;
            if (braceCount === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
          
          const jsonStr = responseText.substring(jsonStart, jsonEnd);
          console.log("🔍 [DEBUG] Extracted JSON (first 200 chars):", jsonStr.substring(0, 200));
          
          try {
            const optionsData = JSON.parse(jsonStr);
            console.log("🔍 [DEBUG] Parsed options data:", optionsData);
            
            if (optionsData.endpoints && Array.isArray(optionsData.endpoints)) {
              endpoints = optionsData.endpoints;
              registrationData = {
                api_name: optionsData.api_name,
                host: optionsData.host,
                base_path: optionsData.base_path,
                auth_type: optionsData.auth_type,
              };
              console.log("🔍 [DEBUG] Found endpoints:", endpoints.length, "Auth type:", optionsData.auth_type);
              // Use auth_type from data if API name not found in text
              if (!apiName && optionsData.api_name) {
                apiName = optionsData.api_name.replace(/_/g, ' ');
              }
            }
          } catch (e) {
            console.error("❌ [ERROR] Failed to parse endpoint options data:", e);
            console.error("❌ [ERROR] Raw JSON:", jsonStr);
          }
        }
      } else {
        console.log("⚠️ [WARN] No ENDPOINT_OPTIONS marker found in response");
      }

      // Remove the markers from the displayed message
      let displayedResponse = responseText
        .replace(/\[CREDENTIAL_REQUEST:API_KEY\]/g, "")
        .replace(/\[CREDENTIAL_REQUEST:BEARER_TOKEN\]/g, "");
      
      // Remove ENDPOINT_OPTIONS with balanced brace matching
      const removeMarkerStart = displayedResponse.indexOf("[ENDPOINT_OPTIONS:");
      if (removeMarkerStart !== -1) {
        const removeJsonStart = displayedResponse.indexOf("{", removeMarkerStart);
        if (removeJsonStart !== -1) {
          let braceCount = 0;
          let removeJsonEnd = removeJsonStart;
          for (let i = removeJsonStart; i < displayedResponse.length; i++) {
            if (displayedResponse[i] === '{') braceCount++;
            if (displayedResponse[i] === '}') braceCount--;
            if (braceCount === 0) {
              removeJsonEnd = i + 1;
              break;
            }
          }
          // Check if there's a closing ] after the }
          if (displayedResponse[removeJsonEnd] === ']') {
            removeJsonEnd++;
          }
          displayedResponse = displayedResponse.substring(0, removeMarkerStart) + displayedResponse.substring(removeJsonEnd);
        }
      }
      
      displayedResponse = displayedResponse.trim();

      // Add the assistant's response
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: displayedResponse,
          tool_calls: data.tool_calls, // Show which tools were used
          trace_id: data.trace_id, // MLflow trace ID for "View Trace" link
        },
      ]);

      // Show endpoint selection dialog if endpoints are available
      // Dialog will show credential input ONLY if authentication is required
      if (hasEndpointOptions && endpoints.length > 0) {
        const requiresAuth = needsApiKey || needsBearerToken;
        setCredentialType(needsBearerToken ? "bearer_token" : "api_key");
        setPendingApiName(apiName);
        setPendingEndpoints(endpoints);
        setEndpointRegistrationData(registrationData);
        setSelectedEndpoints(new Set(endpoints.map((_, idx) => idx))); // Select all by default
        setShowCredentialDialog(true);
      }

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
          // Pass credentials as metadata, NOT in message content!
          credentials: storedCredentials,
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

      // Check if response contains credential request markers
      const responseText = data.response;
      const needsApiKey = responseText.includes("[CREDENTIAL_REQUEST:API_KEY]");
      const needsBearerToken = responseText.includes("[CREDENTIAL_REQUEST:BEARER_TOKEN]");
      
      // Extract API name if mentioned (look for it in the response)
      let apiName = "";
      const apiNameMatch = responseText.match(/for\s+([A-Za-z0-9_\s-]+?)[\.\n\[]|provide your (?:API key|bearer token) for ([A-Za-z0-9_\s-]+)/i);
      if (apiNameMatch) {
        apiName = (apiNameMatch[1] || apiNameMatch[2] || "").trim();
      }

      // Remove the marker from the displayed message
      let displayedResponse = responseText
        .replace(/\[CREDENTIAL_REQUEST:API_KEY\]/g, "")
        .replace(/\[CREDENTIAL_REQUEST:BEARER_TOKEN\]/g, "")
        .trim();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: displayedResponse,
          tool_calls: data.tool_calls,
          trace_id: data.trace_id,
        },
      ]);

      // Show credential dialog if credentials are needed
      if (needsApiKey || needsBearerToken) {
        setCredentialType(needsBearerToken ? "bearer_token" : "api_key");
        setPendingApiName(apiName);
        setShowCredentialDialog(true);
      }
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

          {/* CATALOG DROPDOWN */}
          <Select 
            value={selectedCatalog} 
            onValueChange={(value) => {
              setSelectedCatalog(value);
              setCatalogFilter(""); // Clear filter on selection
            }}
            onOpenChange={(open) => {
              if (!open) setCatalogFilter(""); // Clear filter on close
            }}
          >
            <SelectTrigger className={`w-[180px] ${
              isDark
                ? "bg-black/20 border-white/20 text-white"
                : "bg-white border-gray-300 text-gray-900"
            } backdrop-blur-sm`}>
              <SelectValue placeholder="Select catalog">
                {catalogs.find((c) => c.name === selectedCatalog)?.name || "Select catalog"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <div className="flex items-center px-2 pb-2 sticky top-0 bg-background">
                <Search className="h-4 w-4 mr-2 text-muted-foreground" />
                <Input
                  placeholder="Search catalogs..."
                  value={catalogFilter}
                  onChange={(e) => setCatalogFilter(e.target.value)}
                  className="h-8 text-sm"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {filteredCatalogs.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No catalogs found
                  </div>
                ) : (
                  filteredCatalogs.map((catalog) => (
                    <SelectItem
                      key={catalog.name}
                      value={catalog.name}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{catalog.name}</span>
                        {catalog.comment && (
                          <span className="text-xs text-muted-foreground">{catalog.comment}</span>
                        )}
                      </div>
                    </SelectItem>
                  ))
                )}
              </div>
            </SelectContent>
          </Select>

          {/* SCHEMA DROPDOWN */}
          <div className="flex items-center gap-2">
            <Select 
              value={selectedSchema} 
              onValueChange={(value) => {
                setSelectedSchema(value);
                setSchemaFilter(""); // Clear filter on selection
              }}
              onOpenChange={(open) => {
                if (!open) setSchemaFilter(""); // Clear filter on close
              }}
              disabled={!selectedCatalog}
            >
              <SelectTrigger className={`w-[180px] ${
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
                <SelectValue placeholder="Select schema">
                  {schemas.find((s) => s.name === selectedSchema)?.name || "Select schema"}
                </SelectValue>
              </SelectTrigger>
            <SelectContent>
              <div className="flex items-center px-2 pb-2 sticky top-0 bg-background">
                <Search className="h-4 w-4 mr-2 text-muted-foreground" />
                <Input
                  placeholder="Search schemas..."
                  value={schemaFilter}
                  onChange={(e) => setSchemaFilter(e.target.value)}
                  className="h-8 text-sm"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {filteredSchemas.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    {selectedCatalog ? "No schemas found" : "Select a catalog first"}
                  </div>
                ) : (
                  filteredSchemas.map((schema) => (
                    <SelectItem
                      key={schema.name}
                      value={schema.name}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{schema.name}</span>
                        {schema.comment && (
                          <span className="text-xs text-muted-foreground">{schema.comment}</span>
                        )}
                      </div>
                    </SelectItem>
                  ))
                )}
              </div>
            </SelectContent>
            </Select>
            {!tableValidation.exists && !tableValidation.checking && selectedCatalog && selectedSchema && (
              <div className="flex items-center gap-1 text-red-500" title={`No api_http_registry table exists in ${selectedCatalog}.${selectedSchema}. Switch to a different catalog.schema or run setup_api_http_registry_table.sql to create it.`}>
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
      {!tableValidation.exists && !tableValidation.checking && selectedCatalog && selectedSchema && (
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
                No api_http_registry table exists in {selectedCatalog}.{selectedSchema}
              </h3>
              <div className={`text-xs space-y-0.5 ${
                isDark ? "text-white/70" : "text-gray-700"
              }`}>
                <p>Switch to a different catalog.schema with the api_http_registry table,</p>
                <p>or run setup_api_http_registry_table.sql to create it in <span className="font-mono font-medium">{selectedCatalog}.{selectedSchema}</span></p>
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
            <div className="max-w-5xl w-full space-y-8">
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
          <div className="max-w-7xl mx-auto py-8 px-6 space-y-6">
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
                        className={`prose ${isDark ? 'prose-invert' : 'prose-gray'} max-w-none break-words ${message.content === "Thinking..." ? "typing-indicator" : ""} ${
                          isDark 
                            ? "[&_a]:text-blue-400 [&_a]:underline [&_a:hover]:text-blue-300" 
                            : "[&_a]:text-blue-600 [&_a]:underline [&_a:hover]:text-blue-700 [&_a]:font-medium"
                        }`}
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            marked.parse(message.content, { breaks: true, gfm: true }) as string,
                            {
                              ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'del', 'input'],
                              ALLOWED_ATTR: ['href', 'target', 'class', 'style', 'type', 'checked', 'disabled', 'rel']
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
          <div className="max-w-7xl mx-auto">
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

      {/* Secure Credential Input Dialog */}
      <Dialog open={showCredentialDialog} onOpenChange={setShowCredentialDialog}>
        <DialogContent className={`sm:max-w-4xl max-h-[90vh] overflow-y-auto ${
          isDark 
            ? "bg-[#1C3D42] border-white/20 text-white" 
            : "bg-white border-gray-200 text-gray-900"
        }`}>
          <DialogHeader>
            <DialogTitle className={isDark ? "text-white" : "text-gray-900"}>
              {endpointRegistrationData?.auth_type && endpointRegistrationData.auth_type !== "none" 
                ? "🔐 Endpoint Selection & Credential Input"
                : "📡 Select Endpoints to Register"}
            </DialogTitle>
            <DialogDescription className={isDark ? "text-white/60" : "text-gray-600"}>
              {pendingApiName && `For ${pendingApiName} API - `}
              {endpointRegistrationData?.auth_type && endpointRegistrationData.auth_type !== "none"
                ? `Select endpoints to register and provide your ${credentialType === "api_key" ? "API Key" : "Bearer Token"}.`
                : "Select which endpoints you want to register."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Show endpoint selection if provided */}
            {pendingEndpoints.length > 0 && (
              <div className={`rounded-lg border p-4 space-y-3 ${
                isDark ? "border-white/20 bg-black/10" : "border-gray-200 bg-gray-50"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📡</span>
                    <h4 className={`font-semibold text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
                      Select Endpoints to Register ({selectedEndpoints.size}/{pendingEndpoints.length})
                    </h4>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedEndpoints(new Set(pendingEndpoints.map((_, idx) => idx)))}
                      className={`text-xs px-2 py-1 rounded ${
                        isDark ? "hover:bg-white/10 text-blue-400" : "hover:bg-gray-200 text-blue-600"
                      }`}
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setSelectedEndpoints(new Set())}
                      className={`text-xs px-2 py-1 rounded ${
                        isDark ? "hover:bg-white/10 text-gray-400" : "hover:bg-gray-200 text-gray-600"
                      }`}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {pendingEndpoints.map((endpoint, idx) => (
                    <label
                      key={idx}
                      className={`flex items-start gap-3 p-3 rounded cursor-pointer transition-colors ${
                        selectedEndpoints.has(idx)
                          ? isDark ? "bg-blue-500/20 border border-blue-500/50" : "bg-blue-50 border border-blue-200"
                          : isDark ? "bg-white/5 hover:bg-white/10" : "bg-white hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedEndpoints.has(idx)}
                        onChange={(e) => {
                          const newSelected = new Set(selectedEndpoints);
                          if (e.target.checked) {
                            newSelected.add(idx);
                          } else {
                            newSelected.delete(idx);
                          }
                          setSelectedEndpoints(newSelected);
                        }}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <code className={`font-mono font-medium text-xs ${
                            isDark ? "text-blue-400" : "text-blue-600"
                          }`}>
                            {endpoint.method}
                          </code>
                          <code className={`font-mono text-xs ${
                            isDark ? "text-green-400" : "text-green-600"
                          }`}>
                            {endpoint.path}
                          </code>
                        </div>
                        <p className={`text-xs ${isDark ? "text-white/60" : "text-gray-600"}`}>
                          {endpoint.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
                <p className={`text-xs pt-2 border-t ${
                  isDark ? "text-white/40 border-white/10" : "text-gray-500 border-gray-200"
                }`}>
                  💡 Select the endpoints you want to register. You can always register more later.
                </p>
              </div>
            )}
            
            {/* Show credential input ONLY if authentication is required */}
            {endpointRegistrationData?.auth_type && endpointRegistrationData.auth_type !== "none" && (
              <div className="space-y-2">
                <label className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                  {credentialType === "api_key" ? "API Key" : "Bearer Token"} <span className="text-red-500">*</span>
                </label>
                <Input
                  type="password"
                  placeholder={credentialType === "api_key" ? "Enter your API key..." : "Enter your bearer token..."}
                  value={credentialValue}
                  onChange={(e) => setCredentialValue(e.target.value)}
                  className={`font-mono ${
                    isDark
                      ? "bg-black/20 border-white/20 text-white placeholder:text-white/40"
                      : "bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400"
                  }`}
                  autoFocus
                />
                <p className={`text-xs ${isDark ? "text-white/40" : "text-gray-500"}`}>
                  • Your credential is masked for security
                  <br />
                  • Stored encrypted in Databricks secret scopes
                  <br />
                  • Never logged or displayed in plain text
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowCredentialDialog(false);
                setCredentialValue("");
              }}
              className={isDark ? "border-white/20 text-white hover:bg-white/10" : ""}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                // Require credential only if auth is needed
                const requiresAuth = endpointRegistrationData?.auth_type && endpointRegistrationData.auth_type !== "none";
                if (requiresAuth && !credentialValue.trim()) return;
                
                // DEBUG: Log credential before sending
                console.log(`🔐 [Frontend] Credential type: ${credentialType}`);
                console.log(`🔐 [Frontend] Credential value length: ${credentialValue.length} chars`);
                console.log(`🔐 [Frontend] Credential preview: ${credentialValue.substring(0, 10)}...`);
                
                // SECURE: Store credential in session state, NOT in message content!
                // Build updated credentials object
                const updatedCredentials = requiresAuth ? {
                  ...storedCredentials,
                  [credentialType]: credentialValue,
                } : storedCredentials;
                
                console.log(`🔐 [Frontend] Updated credentials:`, {
                  ...updatedCredentials,
                  [credentialType]: updatedCredentials[credentialType]?.substring(0, 10) + '...'
                });
                
                // Only update state if auth is required
                if (requiresAuth) {
                  setStoredCredentials(updatedCredentials);
                }
                
                setShowCredentialDialog(false);
                setCredentialValue("");
                
                // Build message with selected endpoints info
                const selectedEndpointsList = Array.from(selectedEndpoints)
                  .map(idx => pendingEndpoints[idx])
                  .map(ep => ep.path)
                  .join(", ");
                
                // Build appropriate message based on auth requirement (requiresAuth already declared above)
                const safeMessage = selectedEndpoints.size > 0
                  ? requiresAuth
                    ? `I've securely provided my ${credentialType === "api_key" ? "API key" : "bearer token"}${pendingApiName ? ` for ${pendingApiName}` : ""}. Please register these ${selectedEndpoints.size} endpoint(s): ${selectedEndpointsList}`
                    : `Please register these ${selectedEndpoints.size} endpoint(s) for ${pendingApiName || "the API"}: ${selectedEndpointsList}`
                  : requiresAuth
                    ? `I've securely provided my ${credentialType === "api_key" ? "API key" : "bearer token"}${pendingApiName ? ` for ${pendingApiName}` : ""}.`
                    : `Ready to register ${pendingApiName || "the API"}.`;
                
                const userMessage: Message = {
                  role: "user",
                  content: safeMessage,
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
                      messages: [...messages.map(m => ({ role: m.role, content: m.content })), userMessage],
                      model: selectedModel,
                      system_prompt: systemPrompt || undefined,
                      warehouse_id: selectedWarehouse || undefined,
                      catalog_schema: selectedCatalogSchema || undefined,
                      // Pass credentials as metadata, NOT in message content!
                      credentials: updatedCredentials,
                    }),
                  });

                  if (!response.ok) {
                    // Handle HTTP errors
                    const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
                    console.error("❌ [ERROR] API request failed:", response.status, errorData);
                    
                    setMessages((prev) => prev.slice(0, -1));
                    setMessages((prev) => [
                      ...prev,
                      {
                        role: "assistant",
                        content: `Error: ${errorData.detail || "Request failed"}`,
                      },
                    ]);
                    return;
                  }

                  const data = await response.json();
                  setMessages((prev) => prev.slice(0, -1));

                  if (data.detail) {
                    console.error("❌ [ERROR] Error in response data:", data.detail);
                    setMessages((prev) => [
                      ...prev,
                      {
                        role: "assistant",
                        content: `Error: ${data.detail}`,
                      },
                    ]);
                    return;
                  }

                  // Strip any credential markers from response
                  const cleanedResponse = data.response
                    .replace(/\[CREDENTIAL_REQUEST:API_KEY\]/g, "")
                    .replace(/\[CREDENTIAL_REQUEST:BEARER_TOKEN\]/g, "")
                    .trim();

                  setMessages((prev) => [
                    ...prev,
                    {
                      role: "assistant",
                      content: cleanedResponse,
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
              }}
              disabled={
                (endpointRegistrationData?.auth_type && endpointRegistrationData.auth_type !== "none" && !credentialValue.trim()) ||
                (pendingEndpoints.length > 0 && selectedEndpoints.size === 0)
              }
              className={`${
                isDark
                  ? "bg-[#2C555C] hover:bg-[#24494F] text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              Submit Securely
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
