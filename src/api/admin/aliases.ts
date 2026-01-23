import { HttpClient } from '../../http-client';
import { unwrap, type ApiResponse } from '../utils';

export interface CreateContextAliasRequest {
  alias: string;
  contextId: string;
}

export interface CreateApplicationAliasRequest {
  alias: string;
  applicationId: string;
}

export interface CreateIdentityAliasRequest {
  alias: string;
  identity: string;
}

export interface CreateAliasResponse {
  [key: string]: unknown;
}

export interface DeleteAliasResponse {
  [key: string]: unknown;
}

export interface LookupContextAliasResponse {
  value: string | null;
}

export interface LookupApplicationAliasResponse {
  value: string | null;
}

export interface LookupIdentityAliasResponse {
  value: string | null;
}

export interface ListContextAliasesResponse {
  [alias: string]: string;
}

export interface ListApplicationAliasesResponse {
  [alias: string]: string;
}

export interface ListIdentityAliasesResponse {
  [alias: string]: string;
}

export class AliasesApiClient {
  constructor(private httpClient: HttpClient) {}

  async createContextAlias(
    request: CreateContextAliasRequest,
  ): Promise<CreateAliasResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<CreateAliasResponse>>(
        '/admin-api/alias/create/context',
        request,
      ),
    );
  }

  async createApplicationAlias(
    request: CreateApplicationAliasRequest,
  ): Promise<CreateAliasResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<CreateAliasResponse>>(
        '/admin-api/alias/create/application',
        request,
      ),
    );
  }

  async createIdentityAlias(
    context: string,
    request: CreateIdentityAliasRequest,
  ): Promise<CreateAliasResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<CreateAliasResponse>>(
        `/admin-api/alias/create/identity/${context}`,
        request,
      ),
    );
  }

  async lookupContextAlias(name: string): Promise<LookupContextAliasResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<LookupContextAliasResponse>>(
        `/admin-api/alias/lookup/context/${name}`,
        {},
      ),
    );
  }

  async lookupApplicationAlias(
    name: string,
  ): Promise<LookupApplicationAliasResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<LookupApplicationAliasResponse>>(
        `/admin-api/alias/lookup/application/${name}`,
        {},
      ),
    );
  }

  async lookupIdentityAlias(
    context: string,
    name: string,
  ): Promise<LookupIdentityAliasResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<LookupIdentityAliasResponse>>(
        `/admin-api/alias/lookup/identity/${context}/${name}`,
        {},
      ),
    );
  }

  async listContextAliases(): Promise<ListContextAliasesResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<ListContextAliasesResponse>>(
        '/admin-api/alias/list/context',
      ),
    );
  }

  async listApplicationAliases(): Promise<ListApplicationAliasesResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<ListApplicationAliasesResponse>>(
        '/admin-api/alias/list/application',
      ),
    );
  }

  async listIdentityAliases(
    context: string,
  ): Promise<ListIdentityAliasesResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<ListIdentityAliasesResponse>>(
        `/admin-api/alias/list/identity/${context}`,
      ),
    );
  }

  async deleteContextAlias(name: string): Promise<DeleteAliasResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<DeleteAliasResponse>>(
        `/admin-api/alias/delete/context/${name}`,
        {},
      ),
    );
  }

  async deleteApplicationAlias(name: string): Promise<DeleteAliasResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<DeleteAliasResponse>>(
        `/admin-api/alias/delete/application/${name}`,
        {},
      ),
    );
  }

  async deleteIdentityAlias(
    context: string,
    name: string,
  ): Promise<DeleteAliasResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<DeleteAliasResponse>>(
        `/admin-api/alias/delete/identity/${context}/${name}`,
        {},
      ),
    );
  }
}
