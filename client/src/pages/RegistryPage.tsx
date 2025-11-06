/**
 * RegistryPage - View and manage all registered APIs
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Edit2, Trash2, Save, X, ExternalLink, Check, AlertCircle } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';

interface RegisteredAPI {
  api_id: string;
  api_name: string;
  description: string;
  connection_name: string;      // UC HTTP Connection name
  host: string;                 // API host (e.g., "api.github.com")
  base_path?: string;           // Base path for API (e.g., "/v1", "/api")
  auth_type: string;            // "none", "api_key", or "bearer_token"
  secret_scope?: string;        // "mcp_api_keys" or "mcp_bearer_tokens"
  documentation_url?: string;
  available_endpoints?: string; // JSON array of available endpoints
  example_calls?: string;       // JSON array of example calls
  status: string;
  validation_message?: string;
  user_who_requested?: string;
  created_at?: string;
  modified_date?: string;
}

interface RegistryPageProps {
  selectedWarehouse: string;
  selectedCatalogSchema: string;
}

// Helper function to redact sensitive query parameters for display
const redactSensitiveParams = (path: string): string => {
  if (!path) return '';

  const sensitiveParams = ['api_key', 'apikey', 'token', 'access_token', 'secret', 'password', 'key'];
  let redactedPath = path;

  sensitiveParams.forEach(param => {
    // Match parameter in query string with any value
    const patterns = [
      new RegExp(`([?&])${param}=([^&]+)`, 'gi'),
      new RegExp(`([?&])${param}%3D([^&]+)`, 'gi'), // URL encoded =
    ];

    patterns.forEach(pattern => {
      redactedPath = redactedPath.replace(pattern, `$1${param}=[REDACTED]`);
    });
  });

  return redactedPath;
};

export function RegistryPage({ selectedWarehouse, selectedCatalogSchema }: RegistryPageProps) {
  const [apis, setApis] = useState<RegisteredAPI[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<RegisteredAPI>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  useEffect(() => {
    if (selectedWarehouse && selectedCatalogSchema) {
      loadApis();
    } else {
      // Clear error if warehouse/catalog not selected
      setError(null);
      setApis([]);
    }
  }, [selectedWarehouse, selectedCatalogSchema]);

  const loadApis = async () => {
    if (!selectedWarehouse || !selectedCatalogSchema) {
      setError('Please select a warehouse and catalog.schema');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Parse catalog and schema from full_name
      const [catalog, schema] = selectedCatalogSchema.split('.');

      const params = new URLSearchParams({
        catalog,
        schema,
        warehouse_id: selectedWarehouse,
      });

      const response = await fetch(`/api/registry/list?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to load APIs' }));
        const errorMessage = errorData.detail || 'Failed to load APIs';
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setApis(data.apis || []);
    } catch (error) {
      console.error('Failed to load APIs:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load APIs';
      setError(errorMessage);
      setApis([]);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (api: RegisteredAPI) => {
    setEditingId(api.api_id);
    setEditForm(api);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSaveEdit = async () => {
    if (!selectedWarehouse || !selectedCatalogSchema) {
      alert('Please select a warehouse and catalog.schema');
      return;
    }

    try {
      // Parse catalog and schema from full_name
      const [catalog, schema] = selectedCatalogSchema.split('.');

      const params = new URLSearchParams({
        catalog,
        schema,
        warehouse_id: selectedWarehouse,
        api_name: editForm.api_name || '',
        description: editForm.description || '',
      });

      // Add documentation_url if provided
      if (editForm.documentation_url) {
        params.append('documentation_url', editForm.documentation_url);
      }

      const response = await fetch(`/api/registry/update/${editingId}?${params.toString()}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to update API');
      }

      // Reload APIs to get fresh data
      await loadApis();
      setEditingId(null);
      setEditForm({});
    } catch (error) {
      console.error('Failed to save API:', error);
      alert('Failed to update API. Please try again.');
    }
  };

  const handleDelete = async (apiId: string) => {
    if (!confirm('Are you sure you want to delete this API?')) return;

    if (!selectedWarehouse || !selectedCatalogSchema) {
      alert('Please select a warehouse and catalog.schema');
      return;
    }

    try {
      // Parse catalog and schema from full_name
      const [catalog, schema] = selectedCatalogSchema.split('.');

      const params = new URLSearchParams({
        catalog,
        schema,
        warehouse_id: selectedWarehouse,
      });

      const response = await fetch(`/api/registry/delete/${apiId}?${params.toString()}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete API');
      }

      // Reload APIs to get fresh data
      await loadApis();
    } catch (error) {
      console.error('Failed to delete API:', error);
      alert('Failed to delete API. Please try again.');
    }
  };

  const handleTestHealth = async (api: RegisteredAPI) => {
    try {
      setTestingId(api.api_id);

      // Call the API using the new execute_api_call tool
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Test the API "${api.api_name}" by calling it` }],
          model: 'databricks-claude-sonnet-4',
        }),
      });

      await response.json();

      // Update status
      setApis(apis.map(a =>
        a.api_id === api.api_id
          ? { ...a, status: 'valid', modified_date: new Date().toISOString() }
          : a
      ));
    } catch (error) {
      console.error('Failed to test API health:', error);
      setApis(apis.map(a =>
        a.api_id === api.api_id
          ? { ...a, status: 'error' }
          : a
      ));
    } finally {
      setTestingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'valid':
        return (
          <Badge className="bg-green-500/20 text-green-300 border-green-500/30">
            <Check className="h-3 w-3 mr-1" />
            Healthy
          </Badge>
        );
      case 'error':
        return (
          <Badge className="bg-[#FF3621]/20 text-[#FF8A80] border-[#FF3621]/30">
            <AlertCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
      case 'pending':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30">
            Pending
          </Badge>
        );
      default:
        return (
          <Badge className="bg-gray-500/20 text-gray-300 border-gray-500/30">
            Unknown
          </Badge>
        );
    }
  };

  return (
    <div className={`h-full ${
      isDark
        ? 'bg-gradient-to-br from-[#1C3D42] via-[#24494F] to-[#2C555C]'
        : 'bg-gradient-to-br from-gray-50 via-white to-gray-100'
    }`}>
      {/* Header */}
      <div className={`p-6 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              API Registry
            </h1>
            <p className={`text-sm mt-1 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
              Manage your registered API endpoints
            </p>
          </div>
          <Button
            onClick={loadApis}
            disabled={loading}
            className={`gap-2 ${
              isDark
                ? 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                : 'bg-white border-gray-300 text-gray-900 hover:bg-gray-100'
            }`}
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* API Cards */}
      <div className="p-6 overflow-y-auto" style={{ height: 'calc(100% - 100px)' }}>
        {!selectedWarehouse || !selectedCatalogSchema ? (
          <div className="flex flex-col items-center justify-center h-64">
            <AlertCircle className={`h-12 w-12 mb-4 ${isDark ? 'text-white/40' : 'text-gray-400'}`} />
            <p className={`text-lg ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
              Please select a warehouse and catalog.schema
            </p>
            <p className={`text-sm mt-2 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
              Go to Chat Playground to configure your database settings
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64">
            <AlertCircle className={`h-12 w-12 mb-4 ${isDark ? 'text-[#FF8A80]' : 'text-[#FF3621]'}`} />
            <p className={`text-lg font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {error}
            </p>
            <div className={`text-sm mt-2 text-center max-w-md ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
              {error.toLowerCase().includes('table') || error.toLowerCase().includes('api_http_registry') ? (
                <>
                  <p>Switch to a catalog.schema with the api_http_registry table,</p>
                  <p className="mt-1">or run setup_api_http_registry_table.sql to create it in <span className="font-mono">{selectedCatalogSchema}</span></p>
                </>
              ) : (
                <p>Please check your warehouse and catalog.schema selection</p>
              )}
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className={`h-8 w-8 animate-spin ${isDark ? 'text-white/60' : 'text-gray-400'}`} />
          </div>
        ) : apis.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <p className={`text-lg ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
              No APIs registered yet
            </p>
            <p className={`text-sm mt-2 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
              Use the Chat Playground to register your first API
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {apis.map((api) => (
              <Card
                key={api.api_id}
                className={`${
                  isDark
                    ? 'bg-white/10 border-white/20 backdrop-blur-md'
                    : 'bg-white border-gray-200'
                } transition-all hover:shadow-lg flex flex-col`}
              >
                <CardContent className="p-6 flex-1 flex flex-col">
                  {editingId === api.api_id ? (
                    // Edit Mode
                    <div className="flex-1 flex flex-col">
                      <div className="space-y-4 flex-1">
                        <div>
                          <label className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            Name
                          </label>
                          <Input
                            value={editForm.api_name || ''}
                            onChange={(e) => setEditForm({ ...editForm, api_name: e.target.value })}
                            className={isDark ? 'bg-white/5 border-white/20 text-white' : ''}
                          />
                        </div>
                        <div>
                          <label className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            Description
                          </label>
                          <Textarea
                            value={editForm.description || ''}
                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                            className={isDark ? 'bg-white/5 border-white/20 text-white' : ''}
                            rows={3}
                          />
                        </div>
                        <div>
                          <label className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            Documentation URL
                          </label>
                          <Input
                            value={editForm.documentation_url || ''}
                            onChange={(e) => setEditForm({ ...editForm, documentation_url: e.target.value })}
                            className={isDark ? 'bg-white/5 border-white/20 text-white' : ''}
                            placeholder="https://api.example.com/docs"
                          />
                        </div>
                        <div className={`text-xs ${isDark ? 'text-white/60' : 'text-gray-500'}`}>
                          Note: Connection details (host, base_path, auth) are set during registration and cannot be edited.
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <Button
                          size="sm"
                          onClick={handleSaveEdit}
                          className="flex-1 bg-[#FF3621] hover:bg-[#E02E1A] text-white"
                        >
                          <Save className="h-4 w-4 mr-1" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelEdit}
                          className={isDark ? 'border-white/20 text-white hover:bg-white/10' : ''}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View Mode
                    <div className="flex-1 flex flex-col">
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                              {api.api_name}
                            </h3>
                            <p className={`text-sm mt-1 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                              {api.description}
                            </p>
                          </div>
                          {getStatusBadge(api.status)}
                        </div>

                        <div className={`text-xs space-y-2 ${isDark ? 'text-white/80' : 'text-gray-700'}`}>
                          <div>
                            <span className="font-medium">Connection:</span>
                            <div className="mt-1 font-mono text-xs bg-black/20 px-2 py-1 rounded">
                              {api.connection_name}
                            </div>
                          </div>
                          <div>
                            <span className="font-medium">Host:</span>
                            <div className="mt-1 font-mono text-xs bg-black/20 px-2 py-1 rounded break-all">
                              {api.host}
                            </div>
                          </div>
                          {api.base_path && (
                            <div>
                              <span className="font-medium">Base Path:</span>
                              <div className="mt-1 font-mono text-xs bg-black/20 px-2 py-1 rounded break-all">
                                {api.base_path}
                              </div>
                            </div>
                          )}
                          <div>
                            <span className="font-medium">Auth Type:</span> {api.auth_type}
                          </div>
                          {api.secret_scope && (
                            <div>
                              <span className="font-medium">Secret Scope:</span> {api.secret_scope}
                            </div>
                          )}
                          {api.documentation_url && (
                            <div>
                              <span className="font-medium">Documentation:</span>
                              <a
                                href={api.documentation_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-start gap-1 hover:underline mt-1 group"
                              >
                                <span className="break-all">{api.documentation_url}</span>
                                <ExternalLink className="h-3 w-3 flex-shrink-0 mt-0.5 opacity-60 group-hover:opacity-100" />
                              </a>
                            </div>
                          )}
                          {api.available_endpoints && (() => {
                            try {
                              const endpoints = JSON.parse(api.available_endpoints);
                              if (endpoints && endpoints.length > 0) {
                                return (
                                  <div>
                                    <span className="font-medium">Available Endpoints:</span>
                                    <div className="mt-1 space-y-1">
                                      {endpoints.map((endpoint: any, idx: number) => (
                                        <div key={idx} className={`text-xs ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
                                          <span className="font-mono">{endpoint.method || 'GET'}</span>
                                          <span className="ml-1 font-mono">{endpoint.path}</span>
                                          {endpoint.description && <span className="ml-2">- {endpoint.description}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              }
                            } catch (e) {
                              return null;
                            }
                            return null;
                          })()}
                          {api.example_calls && (() => {
                            try {
                              const examples = JSON.parse(api.example_calls);
                              if (examples && examples.length > 0) {
                                return (
                                  <div>
                                    <span className="font-medium">Example Calls:</span>
                                    <div className="mt-1 space-y-1">
                                      {examples.map((example: any, idx: number) => (
                                        <div key={idx} className={`text-xs ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
                                          <div className="font-mono">{example.path}</div>
                                          {example.description && <div className="ml-2 text-xs">{example.description}</div>}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              }
                            } catch (e) {
                              return null;
                            }
                            return null;
                          })()}
                          {api.user_who_requested && (
                            <div className={isDark ? 'text-white/60' : 'text-gray-500'}>
                              <span className="font-medium">Requested by:</span> {api.user_who_requested}
                            </div>
                          )}
                          {api.created_at && (
                            <div className={isDark ? 'text-white/40' : 'text-gray-400'}>
                              Created: {new Date(api.created_at).toLocaleDateString()}
                            </div>
                          )}
                          {api.modified_date && (
                            <div className={isDark ? 'text-white/40' : 'text-gray-400'}>
                              Last modified: {new Date(api.modified_date).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 pt-4 mt-auto">
                        <Button
                          size="sm"
                          onClick={() => handleTestHealth(api)}
                          disabled={testingId === api.api_id}
                          className={`flex-1 ${
                            isDark
                              ? 'bg-white/10 hover:bg-white/20 text-white'
                              : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                          }`}
                          variant="outline"
                        >
                          <RefreshCw className={`h-4 w-4 mr-1 ${testingId === api.api_id ? 'animate-spin' : ''}`} />
                          Test Health
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleEdit(api)}
                          className={`${
                            isDark
                              ? 'bg-white/10 hover:bg-white/20 text-white'
                              : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                          }`}
                          variant="outline"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleDelete(api.api_id)}
                          className="bg-[#FF3621]/20 hover:bg-[#FF3621]/30 text-[#FF8A80] border-[#FF3621]/30"
                          variant="outline"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
