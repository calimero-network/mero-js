import { HttpClient } from '../../http-client';

// Helper to unwrap { data: T } responses
type ApiResponse<T> = { data: T };

async function unwrap<T>(
  response: Promise<ApiResponse<T>>,
): Promise<T> {
  const result = await response;
  if (!result.data) {
    throw new Error('Response data is null');
  }
  return result.data;
}

export interface Application {
  applicationId: string;
  metadata: string; // base64 encoded
}

export interface InstallApplicationRequest {
  url: string;
  hash?: string;
  metadata: string; // base64 encoded
  package?: string;
  version?: string;
}

export interface InstallDevApplicationRequest {
  path: string;
  metadata: string; // base64 encoded
  package?: string;
  version?: string;
}

export interface InstallApplicationResponse {
  applicationId: string;
}

export interface UninstallApplicationResponse {
  applicationId: string;
}

export interface ListApplicationsResponse {
  apps: Application[];
}

export interface GetApplicationResponse {
  application: Application;
}

export interface ListPackagesResponse {
  packages: string[];
}

export interface ListVersionsResponse {
  versions: string[];
}

export interface GetLatestVersionResponse {
  applicationId: string | null;
}

export class ApplicationsApiClient {
  constructor(private httpClient: HttpClient) {}

  async installApplication(
    request: InstallApplicationRequest,
  ): Promise<InstallApplicationResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<InstallApplicationResponse>>(
        '/admin-api/install-application',
        request,
      ),
    );
  }

  async installDevApplication(
    request: InstallDevApplicationRequest,
  ): Promise<InstallApplicationResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<InstallApplicationResponse>>(
        '/admin-api/install-dev-application',
        request,
      ),
    );
  }

  async listApplications(): Promise<ListApplicationsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<ListApplicationsResponse>>(
        '/admin-api/applications',
      ),
    );
  }

  async getApplication(
    applicationId: string,
  ): Promise<GetApplicationResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<GetApplicationResponse>>(
        `/admin-api/applications/${applicationId}`,
      ),
    );
  }

  async uninstallApplication(
    applicationId: string,
  ): Promise<UninstallApplicationResponse> {
    return unwrap(
      this.httpClient.delete<ApiResponse<UninstallApplicationResponse>>(
        `/admin-api/applications/${applicationId}`,
      ),
    );
  }

  async listPackages(): Promise<ListPackagesResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<ListPackagesResponse>>(
        '/admin-api/packages',
      ),
    );
  }

  async listVersions(packageName: string): Promise<ListVersionsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<ListVersionsResponse>>(
        `/admin-api/packages/${packageName}/versions`,
      ),
    );
  }

  async getLatestVersion(
    packageName: string,
  ): Promise<GetLatestVersionResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<GetLatestVersionResponse>>(
        `/admin-api/packages/${packageName}/latest`,
      ),
    );
  }
}
