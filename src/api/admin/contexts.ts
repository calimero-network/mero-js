import { HttpClient } from '../../http-client';
import { unwrap, type ApiResponseWrapper } from '../utils';

export interface Context {
  contextId: string;
  applicationId: string;
  protocol: string;
}

export interface CreateContextRequest {
  protocol: string;
  applicationId: string;
  contextSeed?: string;
  initializationParams: string; // base64 encoded
}

export interface CreateContextResponse {
  contextId: string;
  memberPublicKey: string;
}

export interface DeleteContextResponse {
  isDeleted: boolean;
}

export interface GetContextResponse {
  contextId: string;
  applicationId: string;
  protocol: string;
}

export interface GetContextStorageResponse {
  sizeInBytes: number;
}

export interface GetContextIdentitiesResponse {
  identities: string[];
}

export interface GetContextsResponse {
  contexts: Context[];
}

export interface InviteToContextRequest {
  contextId: string;
  inviterId: string;
  inviteeId: string;
}

export interface InviteToContextResponse {
  [key: string]: unknown;
}

export interface InviteToContextOpenInvitationRequest {
  contextId: string;
  inviterId: string;
  validForBlocks: number;
}

export interface InviteToContextOpenInvitationResponse {
  [key: string]: unknown;
}

export interface InviteSpecializedNodeRequest {
  contextId: string;
  inviterId?: string;
}

export interface InviteSpecializedNodeResponse {
  nonce: string;
}

export interface JoinContextRequest {
  invitationPayload: Record<string, unknown>;
}

export interface JoinContextByOpenInvitationRequest {
  invitation: Record<string, unknown>;
  newMemberPublicKey: string;
}

export interface JoinContextResponse {
  contextId?: string;
  memberPublicKey?: string;
}

export interface UpdateContextApplicationRequest {
  applicationId: string;
  executorPublicKey: string;
}

export interface UpdateContextApplicationResponse {
  [key: string]: unknown;
}

export interface GetProxyContractResponse {
  [key: string]: unknown;
}

export interface SyncContextResponse {
  [key: string]: unknown;
}

export class ContextsApiClient {
  constructor(private httpClient: HttpClient) {}

  async listContexts(): Promise<GetContextsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<GetContextsResponse>>(
        '/admin-api/contexts',
      ),
    );
  }

  async createContext(
    request: CreateContextRequest,
  ): Promise<CreateContextResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<CreateContextResponse>>(
        '/admin-api/contexts',
        request,
      ),
    );
  }

  async getContext(contextId: string): Promise<GetContextResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<GetContextResponse>>(
        `/admin-api/contexts/${contextId}`,
      ),
    );
  }

  async deleteContext(contextId: string): Promise<DeleteContextResponse> {
    return unwrap(
      this.httpClient.delete<ApiResponseWrapper<DeleteContextResponse>>(
        `/admin-api/contexts/${contextId}`,
      ),
    );
  }

  async getContextStorage(
    contextId: string,
  ): Promise<GetContextStorageResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<GetContextStorageResponse>>(
        `/admin-api/contexts/${contextId}/storage`,
      ),
    );
  }

  async getContextIdentities(
    contextId: string,
  ): Promise<GetContextIdentitiesResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<GetContextIdentitiesResponse>>(
        `/admin-api/contexts/${contextId}/identities`,
      ),
    );
  }

  async getContextIdentitiesOwned(
    contextId: string,
  ): Promise<GetContextIdentitiesResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<GetContextIdentitiesResponse>>(
        `/admin-api/contexts/${contextId}/identities-owned`,
      ),
    );
  }

  async inviteToContext(
    request: InviteToContextRequest,
  ): Promise<InviteToContextResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<InviteToContextResponse>>(
        '/admin-api/contexts/invite',
        request,
      ),
    );
  }

  async inviteToContextOpenInvitation(
    request: InviteToContextOpenInvitationRequest,
  ): Promise<InviteToContextOpenInvitationResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<InviteToContextOpenInvitationResponse>>(
        '/admin-api/contexts/invite_by_open_invitation',
        request,
      ),
    );
  }

  async inviteSpecializedNode(
    request: InviteSpecializedNodeRequest,
  ): Promise<InviteSpecializedNodeResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<InviteSpecializedNodeResponse>>(
        '/admin-api/contexts/invite-specialized-node',
        request,
      ),
    );
  }

  async joinContext(request: JoinContextRequest): Promise<JoinContextResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<JoinContextResponse>>(
        '/admin-api/contexts/join',
        request,
      ),
    );
  }

  async joinContextByOpenInvitation(
    request: JoinContextByOpenInvitationRequest,
  ): Promise<JoinContextResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<JoinContextResponse>>(
        '/admin-api/contexts/join_by_open_invitation',
        request,
      ),
    );
  }

  async updateContextApplication(
    contextId: string,
    request: UpdateContextApplicationRequest,
  ): Promise<UpdateContextApplicationResponse> {
    return unwrap(
      this.httpClient.put<ApiResponseWrapper<UpdateContextApplicationResponse>>(
        `/admin-api/contexts/${contextId}/application`,
        request,
      ),
    );
  }

  async getContextsForApplication(
    applicationId: string,
  ): Promise<GetContextsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<GetContextsResponse>>(
        `/admin-api/contexts/for-application/${applicationId}`,
      ),
    );
  }

  async getContextsWithExecutorsForApplication(
    applicationId: string,
  ): Promise<GetContextsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<GetContextsResponse>>(
        `/admin-api/contexts/with-executors/for-application/${applicationId}`,
      ),
    );
  }

  async getProxyContract(
    contextId: string,
  ): Promise<GetProxyContractResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<GetProxyContractResponse>>(
        `/admin-api/contexts/${contextId}/proxy-contract`,
      ),
    );
  }

  async syncContext(): Promise<SyncContextResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<SyncContextResponse>>(
        '/admin-api/contexts/sync',
        {},
      ),
    );
  }

  async syncContextById(contextId: string): Promise<SyncContextResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<SyncContextResponse>>(
        `/admin-api/contexts/sync/${contextId}`,
        {},
      ),
    );
  }
}
