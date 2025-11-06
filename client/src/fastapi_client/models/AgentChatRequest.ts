/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMessage } from './ChatMessage';
/**
 * Request to chat with the agent.
 */
export type AgentChatRequest = {
    messages: Array<ChatMessage>;
    model?: string;
    max_tokens?: number;
    system_prompt?: (string | null);
    warehouse_id?: (string | null);
    catalog_schema?: (string | null);
    credentials?: (Record<string, string> | null);
};

