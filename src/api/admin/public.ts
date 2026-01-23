import { HttpClient } from '../../http-client';
import { unwrap, type ApiResponse } from '../utils';

export interface HealthResponse {
  status: string;
}

export interface IsAuthedResponse {
  status: string;
}

export class PublicApiClient {
  constructor(private httpClient: HttpClient) {}

  async health(): Promise<HealthResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<HealthResponse>>('/admin-api/health'),
    );
  }

  async isAuthed(): Promise<IsAuthedResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<IsAuthedResponse>>(
        '/admin-api/is-authed',
      ),
    );
  }

  async getCertificate(): Promise<string> {
    return this.httpClient.get<string>('/admin-api/certificate', {
      parse: 'text',
    });
  }
}
