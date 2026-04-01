export interface CloudClientConfig {
  cloudBaseUrl?: string;
}

export interface EnableHAOptions {
  groupId: string;
  contextId: string;
  redirectUrl?: string;
}

export interface DisableHAOptions {
  groupId: string;
  contextId: string;
  redirectUrl?: string;
}

export class CloudClient {
  private baseUrl: string;

  constructor(config: CloudClientConfig = {}) {
    this.baseUrl = (config.cloudBaseUrl || 'https://cloud.calimero.network').replace(/\/+$/, '');
  }

  enableHA(options: EnableHAOptions): void {
    const params = new URLSearchParams({
      group_id: options.groupId,
      context_id: options.contextId,
    });
    if (options.redirectUrl) {
      params.set('redirect_url', options.redirectUrl);
    }
    window.open(`${this.baseUrl}/enable-ha?${params.toString()}`);
  }

  disableHA(options: DisableHAOptions): void {
    const params = new URLSearchParams({
      group_id: options.groupId,
      context_id: options.contextId,
    });
    if (options.redirectUrl) {
      params.set('redirect_url', options.redirectUrl);
    }
    window.open(`${this.baseUrl}/disable-ha?${params.toString()}`);
  }
}
