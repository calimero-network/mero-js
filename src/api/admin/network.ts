import { HttpClient } from '../../http-client';

export interface GetPeersCountResponse {
  count: number;
}

export class NetworkApiClient {
  constructor(private httpClient: HttpClient) {}

  async getPeersCount(): Promise<GetPeersCountResponse> {
    return this.httpClient.get<GetPeersCountResponse>('/admin-api/peers');
  }
}
