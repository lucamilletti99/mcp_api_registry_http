/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DatabaseService {
    /**
     * List Warehouses
     * List all SQL warehouses in the Databricks workspace.
     *
     * Args:
     * search: Optional search filter (case-insensitive, matches warehouse name)
     *
     * Returns:
     * Dictionary with list of warehouses and their details
     * @param search
     * @returns any Successful Response
     * @throws ApiError
     */
    public static listWarehousesApiDbWarehousesGet(
        search?: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/db/warehouses',
            query: {
                'search': search,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * List Catalogs
     * List all catalogs in the Databricks workspace.
     *
     * Returns:
     * Dictionary with list of catalogs
     * @returns any Successful Response
     * @throws ApiError
     */
    public static listCatalogsApiDbCatalogsGet(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/db/catalogs',
        });
    }
    /**
     * List Schemas
     * List all schemas in a specific catalog.
     *
     * Args:
     * catalog_name: Name of the catalog
     *
     * Returns:
     * Dictionary with list of schemas in the catalog
     * @param catalogName
     * @returns any Successful Response
     * @throws ApiError
     */
    public static listSchemasApiDbSchemasCatalogNameGet(
        catalogName: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/db/schemas/{catalog_name}',
            path: {
                'catalog_name': catalogName,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * List All Catalog Schemas
     * List catalog.schema combinations available in the workspace.
     *
     * This is useful for populating a dropdown that shows catalog_name.schema_name format.
     * Performance optimized with limit and search filtering.
     *
     * Args:
     * limit: Maximum number of results to return (default: 100, helps with performance)
     * search: Optional search filter (case-insensitive, matches catalog or schema name)
     *
     * Returns:
     * Dictionary with list of catalog.schema combinations
     *
     * Note:
     * Permission filtering removed for performance - individual schema permission checks
     * were too slow (N API calls for N schemas). The API will return permission errors
     * when user tries to use a schema they don't have access to.
     * @param limit
     * @param search
     * @returns any Successful Response
     * @throws ApiError
     */
    public static listAllCatalogSchemasApiDbCatalogSchemasGet(
        limit: number = 100,
        search?: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/db/catalog-schemas',
            query: {
                'limit': limit,
                'search': search,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Validate Api Registry Table
     * Validate if api_http_registry table exists in the specified catalog.schema.
     *
     * Args:
     * catalog: Catalog name
     * schema: Schema name
     * warehouse_id: SQL warehouse ID to execute the validation query
     *
     * Returns:
     * Dictionary indicating if the table exists and any error messages
     * @param catalog
     * @param schema
     * @param warehouseId
     * @returns any Successful Response
     * @throws ApiError
     */
    public static validateApiRegistryTableApiDbValidateApiRegistryTableGet(
        catalog: string,
        schema: string,
        warehouseId: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/db/validate-api-registry-table',
            query: {
                'catalog': catalog,
                'schema': schema,
                'warehouse_id': warehouseId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
