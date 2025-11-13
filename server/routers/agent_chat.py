"""Agent chat router - uses notebook MCP agent for orchestration.

This router provides a simple chat interface that delegates all orchestration
to the notebook agent pattern. The notebook handles:
- Connecting to MCP server
- Calling Foundation Models
- Executing tools via MCP
- MLflow tracing

The frontend just sends messages and gets responses back.
"""

import asyncio
import os
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from databricks.sdk import WorkspaceClient
from databricks.sdk.core import Config
import httpx
import json

from server.trace_manager import get_trace_manager

router = APIRouter()

# Cache the MCP tools at startup so we don't reload them on every request
_tools_cache: Optional[List[Dict[str, Any]]] = None
_mcp_server_url: Optional[str] = None


def get_workspace_client(request: Request = None) -> WorkspaceClient:
    """Get authenticated Databricks workspace client with on-behalf-of user auth.

    Uses the user's OAuth token from X-Forwarded-Access-Token header when available.
    Falls back to OAuth service principal authentication if user token is not available.

    Args:
        request: FastAPI Request object to extract user token from

    Returns:
        WorkspaceClient configured with appropriate authentication
    """
    host = os.environ.get('DATABRICKS_HOST')

    # Try to get user token from request headers (on-behalf-of authentication)
    user_token = None
    if request:
        user_token = request.headers.get('x-forwarded-access-token')

    if user_token:
        # Use on-behalf-of authentication with user's token
        # auth_type='pat' forces token-only auth and disables auto-detection
        config = Config(host=host, token=user_token, auth_type='pat')
        return WorkspaceClient(config=config)
    else:
        # Fall back to OAuth service principal authentication
        return WorkspaceClient(host=host)


class ChatMessage(BaseModel):
    """A single chat message."""
    role: str  # 'user' or 'assistant'
    content: str


class AgentChatRequest(BaseModel):
    """Request to chat with the agent."""
    messages: List[ChatMessage]
    model: str = 'databricks-claude-sonnet-4'  # Claude Sonnet 4 (best model for tool calling)
    max_tokens: int = 4096
    system_prompt: Optional[str] = None  # Optional custom system prompt
    warehouse_id: Optional[str] = None  # Selected SQL warehouse ID
    catalog_schema: Optional[str] = None  # Selected catalog.schema (format: "catalog_name.schema_name")
    credentials: Optional[Dict[str, str]] = None  # SECURE: Credentials passed as metadata, NOT in message content


class AgentChatResponse(BaseModel):
    """Response from the agent."""
    response: str
    iterations: int
    tool_calls: List[Dict[str, Any]]
    trace_id: Optional[str] = None  # MLflow-style trace ID


async def load_mcp_tools_cached(force_reload: bool = False) -> List[Dict[str, Any]]:
    """Load tools from MCP server (cached).

    Args:
        force_reload: Force reload even if cached

    Returns:
        List of tools in OpenAI format
    """
    global _tools_cache

    # Return cached tools if available
    if _tools_cache is not None and not force_reload:
        return _tools_cache

    # Import the MCP server instance from the app
    from server.app import mcp_server as mcp

    # Get tools directly from the MCP server instance using public API
    # get_tools() returns a dict, so iterate over values
    mcp_tools = await mcp.get_tools()

    # Convert to OpenAI format
    openai_tools = []
    for tool in mcp_tools.values():
        # Extract parameter schema from the tool
        # FastMCP tools have an inputSchema property
        parameters_schema = {
            "type": "object",
            "properties": {},
            "required": []
        }
        
        if hasattr(tool, 'inputSchema') and tool.inputSchema:
            # Use the tool's actual input schema
            parameters_schema = tool.inputSchema
        
        openai_tool = {
            "type": "function",
            "function": {
                "name": tool.key,
                "description": tool.description or tool.key,
                "parameters": parameters_schema
            }
        }
        openai_tools.append(openai_tool)

    # Cache the tools
    _tools_cache = openai_tools
    return openai_tools


async def call_foundation_model(
    messages: List[Dict[str, str]],
    model: str,
    tools: Optional[List[Dict]] = None,
    max_tokens: int = 16384,  # Increased to allow full JSON marker generation (was 4096)
    request: Request = None
) -> Dict[str, Any]:
    """Call a Databricks Foundation Model.

    Args:
        messages: Conversation history
        model: Model endpoint name
        tools: Available tools
        max_tokens: Maximum response tokens
        request: FastAPI Request object for on-behalf-of auth

    Returns:
        Model response
    """
    ws = get_workspace_client(request)
    base_url = ws.config.host.rstrip('/')
    token = ws.config.token

    # Validate we have the required credentials
    if not base_url:
        raise HTTPException(
            status_code=500,
            detail='DATABRICKS_HOST not configured'
        )
    if not token:
        raise HTTPException(
            status_code=500,
            detail='No authentication token available (check OAuth configuration)'
        )

    payload = {
        "messages": messages,
        "max_tokens": max_tokens
    }

    if tools:
        payload["tools"] = tools

    # Log the request payload for debugging
    import sys
    print(f"[Model Call] Sending {len(messages)} messages, {len(tools) if tools else 0} tools", flush=True)
    print(f"[Model Call] Messages structure:", flush=True)
    for i, msg in enumerate(messages):
        role = msg.get('role')
        content_preview = str(msg.get('content', ''))[:100] if 'content' in msg else 'N/A'
        has_tool_calls = 'tool_calls' in msg
        has_tool_call_id = 'tool_call_id' in msg
        print(f"  [{i}] role={role}, content_preview={content_preview}, has_tool_calls={has_tool_calls}, has_tool_call_id={has_tool_call_id}", flush=True)
    sys.stdout.flush()

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f'{base_url}/serving-endpoints/{model}/invocations',
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json',
            },
            json=payload,
            timeout=120.0
        )

        if response.status_code != 200:
            error_detail = f'Model call failed: {response.text}'

            # Provide more helpful error messages for common issues
            if response.status_code == 401:
                error_detail += ' (Authentication failed - check OAuth token)'
            elif response.status_code == 403:
                error_detail += ' (Permission denied - check app.yaml scopes include "all-apis")'
            elif response.status_code == 404:
                error_detail += f' (Model endpoint "{model}" not found)'

            raise HTTPException(
                status_code=response.status_code,
                detail=error_detail
            )

        return response.json()


async def execute_mcp_tool(tool_name: str, tool_args: Dict[str, Any], request: Request = None, credentials: Dict[str, str] = None) -> str:
    """Execute a tool directly via MCP server instance.

    Args:
        tool_name: Name of the tool
        tool_args: Tool arguments
        request: Optional FastAPI Request object for OBO authentication
        credentials: Optional credentials dict (NOT included in messages/traces)

    Returns:
        Tool result as string
    """
    # Import the MCP server instance from the app
    from server.app import mcp_server as mcp
    from fastmcp.server.context import _current_context, Context
    from fastmcp.server.http import _current_http_request

    try:
        # Import the context variables from tools module
        from server.tools import _user_token_context, _credentials_context

        # Set up FastMCP context for tool execution
        context = Context(mcp)
        context_token = _current_context.set(context)

        # Set user token in context variable for tool access
        user_token_var = None
        if request:
            user_token = request.headers.get('x-forwarded-access-token')
            if user_token:
                print(f'🔐 [Tool Execution] Injecting OBO token for tool: {tool_name}')
                print(f'    Token preview: {user_token[:20]}...')
                # Set the token in the context variable that tools can access
                user_token_var = _user_token_context.set(user_token)
            else:
                print(f'⚠️  [Tool Execution] No OBO token available for tool: {tool_name}')

        # SECURE: Set credentials in context (NOT in messages/traces)
        credentials_var = None
        if credentials:
            print(f'🔐 [Tool Execution] Injecting secure credentials for tool: {tool_name}')
            print(f'    Credential keys: {list(credentials.keys())}')
            for key in credentials:
                value_preview = credentials[key][:10] + '...' if len(credentials[key]) > 10 else credentials[key]
                print(f'    {key}: {value_preview}')
            credentials_var = _credentials_context.set(credentials)

        try:
            # Execute the tool with token and credentials available in context
            result = await mcp._tool_manager.call_tool(tool_name, tool_args)
        finally:
            # Always reset contexts
            _current_context.reset(context_token)
            if user_token_var:
                _user_token_context.reset(user_token_var)
            if credentials_var:
                _credentials_context.reset(credentials_var)

        # Convert ToolResult to string
        if hasattr(result, 'model_dump'):
            result_dict = result.model_dump()
            if 'content' in result_dict:
                content_list = result_dict['content']
                if isinstance(content_list, list) and len(content_list) > 0:
                    first_content = content_list[0]
                    if isinstance(first_content, dict) and 'text' in first_content:
                        return first_content['text']
            return json.dumps(result_dict)
        elif hasattr(result, 'content'):
            # FastMCP ToolResult
            content_parts = []
            for content in result.content:
                if hasattr(content, 'text'):
                    content_parts.append(content.text)
            return "".join(content_parts)
        else:
            return str(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return f"Error executing tool {tool_name}: {str(e)}"


async def run_agent_loop(
    user_messages: List[Dict[str, str]],
    model: str,
    tools: List[Dict[str, Any]],
    max_iterations: int = 10,
    request: Request = None,
    custom_system_prompt: Optional[str] = None,
    trace_id: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    catalog_schema: Optional[str] = None,
    credentials: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Run the agentic loop.

    This is the core logic from the notebook, adapted for FastAPI.

    Args:
        user_messages: User conversation history
        model: Model endpoint name
        tools: Available tools
        max_iterations: Max agent iterations
        request: FastAPI Request object for on-behalf-of auth
        custom_system_prompt: Optional custom system prompt from user
        trace_id: Optional trace ID for MLflow tracing

    Returns:
        Final response with traces and trace_id
    """
    # DEBUG: Log credentials at beginning of agent loop
    print(f"🔐 [run_agent_loop] Received credentials: {credentials}")
    if credentials:
        for key, value in credentials.items():
            value_preview = value[:10] + '...' if len(value) > 10 else value
            print(f"    {key}: length={len(value)} chars, preview={value_preview}")
    
    # Use custom system prompt if provided, otherwise load from markdown file
    if custom_system_prompt:
        system_prompt = custom_system_prompt
    else:
        # Load system prompt from api_registry_workflow.md (single source of truth)
        from pathlib import Path
        prompt_file = Path('prompts/api_registry_workflow.md')

        if prompt_file.exists():
            system_prompt = prompt_file.read_text()
            print(f"[Agent Loop] Loaded system prompt from {prompt_file} ({len(system_prompt)} chars)")
        else:
            # Fallback if file doesn't exist
            system_prompt = """You are an API Registry Agent. Please check that prompts/api_registry_workflow.md exists."""
            print(f"[Agent Loop] WARNING: Could not find {prompt_file}, using fallback prompt")

    # Add context about selected warehouse and catalog/schema if provided
    context_additions = []
    if warehouse_id:
        context_additions.append(f"\n\n## Current Database Context\n\n**Selected SQL Warehouse ID:** `{warehouse_id}`")
        context_additions.append(f"\n**IMPORTANT:** Always use this warehouse_id (`{warehouse_id}`) for any SQL operations (execute_dbsql, register_api_in_registry, check_api_registry, etc.) WITHOUT calling list_warehouses first. This is the user's currently selected warehouse.")

    if catalog_schema:
        # Parse catalog.schema
        parts = catalog_schema.split('.')
        if len(parts) == 2:
            catalog_name, schema_name = parts
            context_additions.append(f"\n\n**Selected Catalog.Schema:** `{catalog_name}.{schema_name}`")
            context_additions.append(f"\n**IMPORTANT:** The API registry table `api_http_registry` is located in this catalog.schema. When calling any registry tools, ALWAYS pass:")
            context_additions.append(f"\n- `catalog=\"{catalog_name}\"`")
            context_additions.append(f"\n- `schema=\"{schema_name}\"`")
            context_additions.append(f"\n\n**Tools that need catalog/schema:**")
            context_additions.append(f"\n- `check_api_http_registry(warehouse_id=\"{warehouse_id}\", catalog=\"{catalog_name}\", schema=\"{schema_name}\")`")
            context_additions.append(f"\n- `register_api_with_connection(..., warehouse_id=\"{warehouse_id}\", catalog=\"{catalog_name}\", schema=\"{schema_name}\")`")
            context_additions.append(f"\n- `smart_register_with_connection(..., warehouse_id=\"{warehouse_id}\", catalog=\"{catalog_name}\", schema=\"{schema_name}\")`")
            context_additions.append(f"\n- `execute_dbsql(query=\"...\", warehouse_id=\"{warehouse_id}\", catalog=\"{catalog_name}\", schema=\"{schema_name}\")`")

    if context_additions:
        system_prompt += ''.join(context_additions)

    # Prepend system message to conversation
    messages = [{"role": "system", "content": system_prompt}] + user_messages.copy()
    traces = []
    trace_manager = get_trace_manager()

    for iteration in range(max_iterations):
        # Call the model with tracing
        print(f"[Agent Loop] Iteration {iteration + 1}: Calling model with {len(messages)} messages")

        # Add LLM span
        import time
        llm_span_id = None
        if trace_id:
            llm_span_id = trace_manager.add_span(
                trace_id=trace_id,
                name=f'llm:/serving-endpoints/{model}/invocations',
                inputs={'messages': [{'role': m.get('role'), 'content_preview': str(m.get('content', ''))[:100]} for m in messages]},
                span_type='LLM'
            )

        llm_start_time = time.time()
        response = await call_foundation_model(messages, model=model, tools=tools, request=request)
        llm_duration = time.time() - llm_start_time

        if trace_id and llm_span_id:
            trace_manager.complete_span(
                trace_id=trace_id,
                span_id=llm_span_id,
                outputs={'response': response},
                status='SUCCESS'
            )

        # Extract assistant message
        if 'choices' not in response or len(response['choices']) == 0:
            print(f"[Agent Loop] No choices in response, breaking")
            break

        choice = response['choices'][0]
        message = choice.get('message', {})
        finish_reason = choice.get('finish_reason', 'unknown')

        print(f"[Agent Loop] Model response - finish_reason: {finish_reason}")
        print(f"[Agent Loop] Message keys: {list(message.keys())}")

        # Check for Claude-style tool_use in content
        content = message.get('content', '')
        tool_use_blocks = []
        if isinstance(content, list):
            tool_use_blocks = [item for item in content if isinstance(item, dict) and item.get('type') == 'tool_use']

        # Check for OpenAI-style tool_calls
        tool_calls = message.get('tool_calls')

        print(f"[Agent Loop] Tool calls: {len(tool_calls) if tool_calls else 0}")
        print(f"[Agent Loop] Tool use blocks: {len(tool_use_blocks)}")

        if tool_use_blocks:
            # Claude format: content contains tool_use blocks
            # BUT Databricks requires OpenAI format in requests even for Claude models
            print(f"[Agent Loop] Processing Claude tool_use blocks (converting to OpenAI format)")

            # Convert Claude tool_use to OpenAI tool_calls format for the request
            tool_calls_openai = []
            for i, tool_use in enumerate(tool_use_blocks):
                tool_calls_openai.append({
                    "id": tool_use.get('id'),
                    "type": "function",
                    "function": {
                        "name": tool_use.get('name'),
                        "arguments": json.dumps(tool_use.get('input', {}))
                    }
                })

            # Add assistant message in OpenAI format (required by Databricks)
            assistant_msg = {
                "role": "assistant",
                "tool_calls": tool_calls_openai
            }
            # Include text content if present (not just tool_use blocks)
            text_content = ""
            if isinstance(content, list):
                text_blocks = [item.get('text', '') for item in content if isinstance(item, dict) and item.get('type') == 'text']
                text_content = ''.join(text_blocks)
            if text_content:
                assistant_msg["content"] = text_content

            messages.append(assistant_msg)

            # Execute each tool and add results in OpenAI format
            for tool_use in tool_use_blocks:
                tool_name = tool_use.get('name')
                tool_args = tool_use.get('input', {})
                tool_id = tool_use.get('id')

                print(f"[Agent Loop] Executing tool: {tool_name}")

                # Add tool span
                tool_span_id = None
                if trace_id:
                    tool_span_id = trace_manager.add_span(
                        trace_id=trace_id,
                        name=tool_name,
                        inputs=tool_args,
                        parent_id=llm_span_id,
                        span_type='TOOL'
                    )

                # Execute via MCP with user request context for OBO auth
                tool_start_time = time.time()
                result = await execute_mcp_tool(tool_name, tool_args, request, credentials)
                tool_duration = time.time() - tool_start_time

                if trace_id and tool_span_id:
                    trace_manager.complete_span(
                        trace_id=trace_id,
                        span_id=tool_span_id,
                        outputs={'result': result[:500] if len(str(result)) > 500 else result},
                        status='SUCCESS'
                    )

                # Ensure result is not empty
                if not result or result.strip() == "":
                    result = f"Tool {tool_name} completed successfully (no output)"

                # Add tool result in OpenAI format (required by Databricks)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_id,
                    "content": result
                })

                traces.append({
                    "iteration": iteration + 1,
                    "tool": tool_name,
                    "args": tool_args,
                    "result": result
                })

        elif tool_calls:
            # OpenAI/GPT format: tool_calls array
            print(f"[Agent Loop] Processing OpenAI tool_calls")

            # IMPORTANT: Do NOT include content when tool_calls are present!
            # Claude includes tool_use blocks in content which conflicts with tool_calls format
            assistant_msg = {
                "role": "assistant",
                "tool_calls": tool_calls
            }
            # Note: Intentionally NOT including content field even if present
            # because it may contain Claude-formatted tool_use blocks

            messages.append(assistant_msg)

            # Execute each tool
            for tc in tool_calls:
                tool_name = tc['function']['name']
                tool_args = json.loads(tc['function']['arguments'])

                # Add tool span
                tool_span_id = None
                if trace_id:
                    tool_span_id = trace_manager.add_span(
                        trace_id=trace_id,
                        name=tool_name,
                        inputs=tool_args,
                        parent_id=llm_span_id,
                        span_type='TOOL'
                    )

                # Execute via MCP with user request context for OBO auth
                tool_start_time = time.time()
                result = await execute_mcp_tool(tool_name, tool_args, request, credentials)
                tool_duration = time.time() - tool_start_time

                if trace_id and tool_span_id:
                    trace_manager.complete_span(
                        trace_id=trace_id,
                        span_id=tool_span_id,
                        outputs={'result': result[:500] if len(str(result)) > 500 else result},
                        status='SUCCESS'
                    )

                # Ensure result is not empty
                if not result or result.strip() == "":
                    result = f"Tool {tool_name} completed successfully (no output)"

                # Add tool result to conversation (OpenAI format)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc['id'],
                    "content": result
                })

                traces.append({
                    "iteration": iteration + 1,
                    "tool": tool_name,
                    "args": tool_args,
                    "result": result
                })

        else:
            # Final answer from model
            final_content = message.get('content', '')

            # Complete the trace
            if trace_id:
                trace_manager.complete_trace(trace_id, status='SUCCESS')

            return {
                "response": final_content,
                "iterations": iteration + 1,
                "traces": traces,
                "finish_reason": finish_reason,
                "trace_id": trace_id
            }

    # Complete the trace with max_iterations status
    if trace_id:
        trace_manager.complete_trace(trace_id, status='SUCCESS')

    return {
        "response": "Agent reached maximum iterations",
        "iterations": max_iterations,
        "traces": traces,
        "finish_reason": "max_iterations",
        "trace_id": trace_id
    }


@router.post('/chat', response_model=AgentChatResponse)
async def agent_chat(chat_request: AgentChatRequest, request: Request) -> AgentChatResponse:
    """Chat with the agent using MCP orchestration.

    This endpoint uses the notebook agent pattern under the hood.
    The frontend just sends messages and gets responses back.

    Args:
        chat_request: Chat request with messages and model
        request: FastAPI Request object for on-behalf-of auth

    Returns:
        Agent response with tool call traces
    """
    # DEBUG: Log credentials received from frontend
    print(f"=" * 80)
    print(f"🔐 [agent_chat] RAW REQUEST DEBUGGING")
    print(f"=" * 80)
    print(f"Credentials object: {chat_request.credentials}")
    print(f"Credentials type: {type(chat_request.credentials)}")
    if chat_request.credentials:
        for key, value in chat_request.credentials.items():
            print(f"\n📝 Key: '{key}'")
            print(f"   Type: {type(value)}")
            print(f"   Length: {len(value)} chars")
            print(f"   First 20 chars: {repr(value[:20])}")
            print(f"   Last 10 chars: {repr(value[-10:])}")
            print(f"   Full value (repr): {repr(value)}")
    print(f"=" * 80)
    
    try:
        # Create a trace for this conversation
        trace_manager = get_trace_manager()

        # Get the most recent user message (the current question)
        current_user_message = ""
        for msg in reversed(chat_request.messages):
            if msg.role == "user":
                current_user_message = msg.content[:100]
                break

        trace_id = trace_manager.create_trace(
            request_metadata={
                "model": chat_request.model,
                "message_count": len(chat_request.messages),
                "current_user_message": current_user_message
            }
        )

        # Add root span for the agent
        root_span_id = trace_manager.add_span(
            trace_id=trace_id,
            name="agent",
            inputs={"messages": [{"role": msg.role, "content": msg.content[:100]} for msg in chat_request.messages]},
            span_type='AGENT'
        )

        # Load tools (cached after first call)
        tools = await load_mcp_tools_cached()

        # Convert Pydantic messages to dict
        messages = [{"role": msg.role, "content": msg.content} for msg in chat_request.messages]

        # Run the agent loop (this is the notebook pattern)
        result = await run_agent_loop(
            user_messages=messages,
            model=chat_request.model,
            tools=tools,
            max_iterations=10,
            request=request,
            custom_system_prompt=chat_request.system_prompt,
            trace_id=trace_id,
            warehouse_id=chat_request.warehouse_id,
            catalog_schema=chat_request.catalog_schema,
            credentials=chat_request.credentials  # SECURE: Pass credentials as metadata
        )

        # Complete root span
        trace_manager.complete_span(
            trace_id=trace_id,
            span_id=root_span_id,
            outputs={"response": result["response"][:500]},
            status='SUCCESS'
        )

        return AgentChatResponse(
            response=result["response"],
            iterations=result["iterations"],
            tool_calls=result["traces"],
            trace_id=trace_id
        )

    except Exception as e:
        # Log the full exception for debugging
        import traceback
        error_traceback = traceback.format_exc()
        print(f"[Agent Chat Error] {error_traceback}", flush=True)
        raise HTTPException(
            status_code=500,
            detail=f'Agent chat failed: {str(e)}'
        )


@router.get('/tools')
async def list_agent_tools() -> Dict[str, Any]:
    """List available tools from MCP server.

    Returns:
        Dictionary with tools list
    """
    try:
        tools = await load_mcp_tools_cached()
        return {
            "tools": tools,
            "count": len(tools),
            "server_url": _mcp_server_url
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f'Failed to list tools: {str(e)}'
        )


@router.post('/tools/reload')
async def reload_tools() -> Dict[str, Any]:
    """Force reload tools from MCP server.

    Useful when you deploy new tools to the MCP server.

    Returns:
        Dictionary with reloaded tools
    """
    try:
        tools = await load_mcp_tools_cached(force_reload=True)
        return {
            "message": "Tools reloaded successfully",
            "count": len(tools),
            "tools": [t["function"]["name"] for t in tools]
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f'Failed to reload tools: {str(e)}'
        )
