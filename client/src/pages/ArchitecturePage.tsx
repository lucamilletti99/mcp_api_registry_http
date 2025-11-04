/**
 * ArchitecturePage - Interactive architecture diagram with flashcard components
 */

import { useState } from 'react';
import { useTheme } from '@/components/theme-provider';
import {
  Layers,
  Database,
  Zap,
  Code,
  Cloud,
  MessageSquare,
  Server,
  Box,
  Network,
  GitBranch
} from 'lucide-react';

interface ComponentCardProps {
  title: string;
  icon: React.ReactNode;
  front: string;
  back: string;
  color: string;
}

function ComponentCard({ title, icon, front, back, color }: ComponentCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div
      className="perspective-1000 cursor-pointer h-[220px]"
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <div
        className={`relative w-full h-full transition-transform duration-500 transform-style-3d ${
          isFlipped ? 'rotate-y-180' : ''
        }`}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Front of card */}
        <div
          className={`absolute w-full h-full rounded-xl border-2 p-6 backface-hidden ${
            isDark
              ? `bg-white/5 border-${color}-500/30 backdrop-blur-md`
              : `bg-white border-${color}-200`
          } shadow-lg hover:shadow-xl transition-shadow`}
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <div className={`${color === 'red' ? 'text-[#FF3621]' : `text-${color}-500`}`}>
              {icon}
            </div>
            <h3 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {title}
            </h3>
            <p className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
              {front}
            </p>
          </div>
        </div>

        {/* Back of card */}
        <div
          className={`absolute w-full h-full rounded-xl border-2 p-6 backface-hidden rotate-y-180 ${
            isDark
              ? `bg-${color}-500/10 border-${color}-500/30 backdrop-blur-md`
              : `bg-${color}-50 border-${color}-200`
          } shadow-lg`}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)'
          }}
        >
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 mb-3">
              <div className={`${color === 'red' ? 'text-[#FF3621]' : `text-${color}-600`}`}>
                {icon}
              </div>
              <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {title}
              </h3>
            </div>
            <p className={`text-xs leading-relaxed ${isDark ? 'text-white/80' : 'text-gray-700'}`}>
              {back}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ArchitecturePage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const components = [
    {
      title: 'React Frontend',
      icon: <Code className="h-10 w-10" />,
      front: 'Modern TypeScript UI built with React + Vite',
      back: 'User interface built with React, TypeScript, and shadcn/ui components. Provides chat interface, API registry management, and real-time updates. Uses React Query for state management and API client auto-generated from FastAPI OpenAPI spec.',
      color: 'blue',
    },
    {
      title: 'FastAPI Backend',
      icon: <Server className="h-10 w-10" />,
      front: 'Python API server with MCP integration',
      back: 'High-performance async Python backend using FastAPI. Handles HTTP requests, manages authentication, and serves both the web UI and MCP protocol. Auto-generates OpenAPI documentation and TypeScript client.',
      color: 'green',
    },
    {
      title: 'MCP Server',
      icon: <Network className="h-10 w-10" />,
      front: 'Model Context Protocol for AI tools',
      back: 'Custom MCP server that exposes specialized tools for API discovery, registration, and management. Enables AI assistants to interact with the API registry through standardized protocols, providing tools for validation, querying, and endpoint management.',
      color: 'purple',
    },
    {
      title: 'Databricks Foundation Models',
      icon: <MessageSquare className="h-10 w-10" />,
      front: 'State-of-the-art LLMs for natural conversations',
      back: 'Databricks Foundation Model APIs provide access to leading LLMs including Claude, Llama, DBRX, and others via Model Serving. Processes natural language requests, executes MCP tools, and provides intelligent responses about API discovery and management.',
      color: 'red',
    },
    {
      title: 'Unity Catalog',
      icon: <Database className="h-10 w-10" />,
      front: 'Centralized data governance and storage',
      back: 'Databricks Unity Catalog provides a unified governance solution. Stores the api_http_registry table and manages Unity Catalog HTTP Connections for secure API integration. Provides full audit logging, access control, and data lineage. Enables multi-catalog/schema deployment flexibility.',
      color: 'orange',
    },
    {
      title: 'SQL Warehouse',
      icon: <Zap className="h-10 w-10" />,
      front: 'Serverless SQL compute engine',
      back: 'Databricks SQL Warehouse provides serverless compute for running queries against Unity Catalog. Automatically scales based on workload and provides fast query performance for API registry operations.',
      color: 'yellow',
    },
    {
      title: 'Databricks Apps',
      icon: <Cloud className="h-10 w-10" />,
      front: 'Hosted application platform',
      back: 'Databricks Apps platform hosts the full-stack application with OAuth authentication, automatic HTTPS, and seamless integration with Databricks workspace. Provides /logz endpoint for debugging and monitoring.',
      color: 'indigo',
    },
    {
      title: 'HTTP Connections',
      icon: <Box className="h-10 w-10" />,
      front: 'Unity Catalog HTTP Connections for APIs',
      back: 'Unity Catalog HTTP Connections provide secure, managed access to external APIs with built-in authentication (public, API key, bearer token). The api_http_registry table tracks connection metadata, parameters, and usage. HTTP connections support http_request() function for SQL-based API calls.',
      color: 'cyan',
    },
    {
      title: 'MLflow Tracing',
      icon: <GitBranch className="h-10 w-10" />,
      front: 'LLM observability and debugging',
      back: 'MLflow tracing captures all LLM interactions including prompts, tool calls, and responses. Enables debugging of AI agent behavior, performance monitoring, and quality assurance for the chat experience.',
      color: 'pink',
    },
  ];

  return (
    <div className={`h-full overflow-y-auto ${
      isDark
        ? 'bg-gradient-to-br from-[#1C3D42] via-[#24494F] to-[#2C555C]'
        : 'bg-gradient-to-br from-gray-50 via-white to-gray-100'
    }`}>
      {/* Header */}
      <div className={`p-6 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="max-w-7xl mx-auto">
          <h1 className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            System Architecture
          </h1>
          <p className={`text-sm mt-2 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
            Click any component to learn more about how it works
          </p>
        </div>
      </div>

      {/* Architecture Diagram */}
      <div className="max-w-7xl mx-auto p-8">
        {/* Presentation Layer */}
        <div className="mb-8 relative">
          <h2 className={`text-xl font-semibold mb-6 text-center flex items-center justify-center gap-2 ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>
            <Layers className="h-5 w-5" />
            Presentation Layer
          </h2>
          <div className="flex justify-center">
            <div className="w-full max-w-md">
              <ComponentCard {...components[0]} />
            </div>
          </div>
          {/* Connecting line down */}
          <div className="flex justify-center mt-6">
            <div className={`w-0.5 h-12 ${isDark ? 'bg-white/20' : 'bg-gray-300'}`}>
              <div className={`w-3 h-3 rounded-full -ml-1.5 ${isDark ? 'bg-white/40' : 'bg-gray-400'} absolute`} style={{ top: '100%' }} />
            </div>
          </div>
        </div>

        {/* Application Layer */}
        <div className="mb-8 relative">
          <h2 className={`text-xl font-semibold mb-6 text-center flex items-center justify-center gap-2 ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>
            <Server className="h-5 w-5" />
            Application Layer
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <ComponentCard {...components[1]} />
            <ComponentCard {...components[2]} />
            <ComponentCard {...components[8]} />
          </div>
          {/* Connecting lines down */}
          <div className="flex justify-center mt-6 relative">
            <div className={`w-0.5 h-12 ${isDark ? 'bg-white/20' : 'bg-gray-300'}`}>
              <div className={`w-3 h-3 rounded-full -ml-1.5 ${isDark ? 'bg-white/40' : 'bg-gray-400'} absolute`} style={{ top: '100%' }} />
            </div>
          </div>
        </div>

        {/* AI & Compute Layer */}
        <div className="mb-8 relative">
          <h2 className={`text-xl font-semibold mb-6 text-center flex items-center justify-center gap-2 ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>
            <MessageSquare className="h-5 w-5" />
            AI & Compute Layer
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <ComponentCard {...components[3]} />
            <ComponentCard {...components[5]} />
          </div>
          {/* Connecting lines down */}
          <div className="flex justify-center mt-6 relative">
            <div className={`w-0.5 h-12 ${isDark ? 'bg-white/20' : 'bg-gray-300'}`}>
              <div className={`w-3 h-3 rounded-full -ml-1.5 ${isDark ? 'bg-white/40' : 'bg-gray-400'} absolute`} style={{ top: '100%' }} />
            </div>
          </div>
        </div>

        {/* Data & Infrastructure Layer */}
        <div className="mb-12 relative">
          <h2 className={`text-xl font-semibold mb-6 text-center flex items-center justify-center gap-2 ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>
            <Database className="h-5 w-5" />
            Data & Infrastructure Layer
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <ComponentCard {...components[4]} />
            <ComponentCard {...components[7]} />
            <ComponentCard {...components[6]} />
          </div>
        </div>

        {/* Architecture Flow */}
        <div className={`mt-12 rounded-xl border-2 p-8 ${
          isDark
            ? 'bg-white/5 border-white/10 backdrop-blur-md'
            : 'bg-white border-gray-200'
        }`}>
          <h2 className={`text-xl font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            How It All Works Together
          </h2>
          <div className={`space-y-4 ${isDark ? 'text-white/80' : 'text-gray-700'}`}>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[#FF3621] text-white flex items-center justify-center text-sm font-bold">
                1
              </span>
              <p>
                <strong>User Interaction:</strong> Users interact with the React frontend to chat with the AI, view registered APIs, or explore the registry. The UI communicates with the FastAPI backend via auto-generated TypeScript client.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[#FF3621] text-white flex items-center justify-center text-sm font-bold">
                2
              </span>
              <p>
                <strong>Backend Processing:</strong> FastAPI receives requests and routes them appropriately. For AI chat, it forwards messages to Databricks Foundation Models with available MCP tools. For direct API operations, it queries Unity Catalog via SQL Warehouse.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[#FF3621] text-white flex items-center justify-center text-sm font-bold">
                3
              </span>
              <p>
                <strong>AI Decision Making:</strong> Databricks Foundation Models (Claude, Llama, DBRX, etc.) analyze the user's request and decide which MCP tools to invoke. The MCP server exposes specialized tools for API discovery, registration, validation, and querying the registry.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[#FF3621] text-white flex items-center justify-center text-sm font-bold">
                4
              </span>
              <p>
                <strong>Data Operations:</strong> MCP tools execute SQL queries against Unity Catalog to create HTTP Connections and call external APIs using http_request(). The api_http_registry table tracks all registered connections. All operations are tracked with MLflow tracing for observability and debugging.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[#FF3621] text-white flex items-center justify-center text-sm font-bold">
                5
              </span>
              <p>
                <strong>Response & Display:</strong> Results flow back through the layers: Unity Catalog → SQL Warehouse → MCP Tools → Foundation Models → FastAPI → React UI. Users see natural language responses with actionable insights about their APIs.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Custom CSS for 3D flip effect */}
      <style>{`
        .perspective-1000 {
          perspective: 1000px;
        }
        .transform-style-3d {
          transform-style: preserve-3d;
        }
        .backface-hidden {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .rotate-y-180 {
          transform: rotateY(180deg);
        }
      `}</style>
    </div>
  );
}
