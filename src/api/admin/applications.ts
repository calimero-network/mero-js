import { HttpClient } from '../../http-client';
import { unwrap, type ApiResponseWrapper } from '../utils';

export interface Application {
  applicationId: string;
  metadata: string; // base64 encoded
}

export interface InstallApplicationRequest {
  url: string;
  hash?: string;
  metadata: number[] | string; // byte array or base64 string (API accepts both but prefers array)
  package?: string;
  version?: string;
}

export interface InstallDevApplicationRequest {
  path: string;
  metadata: number[] | string; // byte array or base64 string (API accepts both but prefers array)
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
      this.httpClient.post<ApiResponseWrapper<InstallApplicationResponse>>(
        '/admin-api/install-application',
        request,
      ),
    );
  }

  async installDevApplication(
    request: InstallDevApplicationRequest,
  ): Promise<InstallApplicationResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<InstallApplicationResponse>>(
        '/admin-api/install-dev-application',
        request,
      ),
    );
  }

  async listApplications(): Promise<ListApplicationsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<ListApplicationsResponse>>(
        '/admin-api/applications',
      ),
    );
  }

  async getApplication(
    applicationId: string,
  ): Promise<GetApplicationResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<GetApplicationResponse>>(
        `/admin-api/applications/${applicationId}`,
      ),
    );
  }

  async uninstallApplication(
    applicationId: string,
  ): Promise<UninstallApplicationResponse> {
    return unwrap(
      this.httpClient.delete<ApiResponseWrapper<UninstallApplicationResponse>>(
        `/admin-api/applications/${applicationId}`,
      ),
    );
  }

  async listPackages(): Promise<ListPackagesResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<ListPackagesResponse>>(
        '/admin-api/packages',
      ),
    );
  }

  async listVersions(packageName: string): Promise<ListVersionsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<ListVersionsResponse>>(
        `/admin-api/packages/${packageName}/versions`,
      ),
    );
  }

  async getLatestVersion(
    packageName: string,
  ): Promise<GetLatestVersionResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<GetLatestVersionResponse>>(
        `/admin-api/packages/${packageName}/latest`,
      ),
    );
  }
}
