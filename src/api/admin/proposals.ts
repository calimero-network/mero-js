import { HttpClient } from '../../http-client';
import { unwrap, type ApiResponse } from '../utils';

export interface Proposal {
  [key: string]: unknown;
}

export interface GetProposalsRequest {
  offset: number;
  limit: number;
}

export type GetProposalsResponse = Proposal[];

export type GetProposalResponse = Proposal;

export type GetNumberOfActiveProposalsResponse = number;

export interface ProposalWithApprovals {
  [key: string]: unknown;
}

export type GetNumberOfProposalApprovalsResponse = ProposalWithApprovals;

export type GetProposalApproversResponse = Record<string, unknown>[];

export interface CreateAndApproveProposalRequest {
  signerId: string;
  proposal: Proposal;
}

export type CreateAndApproveProposalResponse = ProposalWithApprovals;

export interface ApproveProposalRequest {
  signerId: string;
  proposalId: string;
}

export type ApproveProposalResponse = ProposalWithApprovals;

export interface GetContextValueRequest {
  key: string;
}

export type GetContextValueResponse = number[];

export interface GetContextStorageEntriesRequest {
  offset: number;
  limit: number;
}

export type GetContextStorageEntriesResponse = Record<string, unknown>[];

export class ProposalsApiClient {
  constructor(private httpClient: HttpClient) {}

  async getProposals(
    contextId: string,
    request: GetProposalsRequest,
  ): Promise<GetProposalsResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<GetProposalsResponse>>(
        `/admin-api/contexts/${contextId}/proposals`,
        request,
      ),
    );
  }

  async getProposal(
    contextId: string,
    proposalId: string,
  ): Promise<GetProposalResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<GetProposalResponse>>(
        `/admin-api/contexts/${contextId}/proposals/${proposalId}`,
      ),
    );
  }

  async createAndApproveProposal(
    contextId: string,
    request: CreateAndApproveProposalRequest,
  ): Promise<CreateAndApproveProposalResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<CreateAndApproveProposalResponse>>(
        `/admin-api/contexts/${contextId}/proposals/create-and-approve`,
        request,
      ),
    );
  }

  async approveProposal(
    contextId: string,
    request: ApproveProposalRequest,
  ): Promise<ApproveProposalResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<ApproveProposalResponse>>(
        `/admin-api/contexts/${contextId}/proposals/approve`,
        request,
      ),
    );
  }

  async getNumberOfActiveProposals(
    contextId: string,
  ): Promise<GetNumberOfActiveProposalsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<GetNumberOfActiveProposalsResponse>>(
        `/admin-api/contexts/${contextId}/proposals/count`,
      ),
    );
  }

  async getNumberOfProposalApprovals(
    contextId: string,
    proposalId: string,
  ): Promise<GetNumberOfProposalApprovalsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<GetNumberOfProposalApprovalsResponse>>(
        `/admin-api/contexts/${contextId}/proposals/${proposalId}/approvals/count`,
      ),
    );
  }

  async getProposalApprovers(
    contextId: string,
    proposalId: string,
  ): Promise<GetProposalApproversResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<GetProposalApproversResponse>>(
        `/admin-api/contexts/${contextId}/proposals/${proposalId}/approvals/users`,
      ),
    );
  }

  async getContextValue(
    contextId: string,
    request: GetContextValueRequest,
  ): Promise<GetContextValueResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<GetContextValueResponse>>(
        `/admin-api/contexts/${contextId}/proposals/get-context-value`,
        request,
      ),
    );
  }

  async getContextStorageEntries(
    contextId: string,
    request: GetContextStorageEntriesRequest,
  ): Promise<GetContextStorageEntriesResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<GetContextStorageEntriesResponse>>(
        `/admin-api/contexts/${contextId}/proposals/context-storage-entries`,
        request,
      ),
    );
  }
}
