/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Model for a registered API using UC HTTP Connections (API-level registration).
 */
export type RegisteredAPI = {
    api_id: string;
    api_name: string;
    description?: (string | null);
    connection_name: string;
    host: string;
    base_path?: (string | null);
    auth_type: string;
    secret_scope?: (string | null);
    documentation_url?: (string | null);
    available_endpoints?: (string | null);
    example_calls?: (string | null);
    status?: string;
    user_who_requested?: (string | null);
    created_at?: (string | null);
    modified_date?: (string | null);
    validation_message?: (string | null);
};

