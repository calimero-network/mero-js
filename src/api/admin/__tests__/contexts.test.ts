import { describe, it, expect, beforeEach } from 'vitest';
import { ContextsApiClient } from '../contexts';
import { MockHttpClient } from './mock-http-client';

describe('ContextsApiClient', () => {
  let client: ContextsApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new ContextsApiClient(mockHttp);
  });

  describe('listContexts', () => {
    it('should list contexts', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/contexts', {
        data: {
          contexts: [
            {
              contextId: 'ctx-1',
              applicationId: 'app-1',
              protocol: 'near',
            },
          ],
        },
      });

      const result = await client.listContexts();

      expect(result.contexts).toHaveLength(1);
      expect(result.contexts[0].contextId).toBe('ctx-1');
    });
  });

  describe('createContext', () => {
    it('should create context', async () => {
      const request = {
        protocol: 'near',
        applicationId: 'app-1',
        initializationParams: Buffer.from('init').toString('base64'),
      };

      mockHttp.setMockResponse('POST', '/admin-api/contexts', {
        data: {
          contextId: 'ctx-new',
          memberPublicKey: 'pubkey-123',
        },
      });

      const result = await client.createContext(request);

      expect(result).toEqual({
        contextId: 'ctx-new',
        memberPublicKey: 'pubkey-123',
      });
    });
  });

  describe('getContext', () => {
    it('should get context by id', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/contexts/ctx-1', {
        data: {
          contextId: 'ctx-1',
          applicationId: 'app-1',
          protocol: 'near',
        },
      });

      const result = await client.getContext('ctx-1');

      expect(result.contextId).toBe('ctx-1');
    });
  });

  describe('deleteContext', () => {
    it('should delete context', async () => {
      mockHttp.setMockResponse('DELETE', '/admin-api/contexts/ctx-1', {
        data: { isDeleted: true },
      });

      const result = await client.deleteContext('ctx-1');

      expect(result.isDeleted).toBe(true);
    });
  });

  describe('getContextStorage', () => {
    it('should get context storage', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/contexts/ctx-1/storage', {
        data: { sizeInBytes: 1024 },
      });

      const result = await client.getContextStorage('ctx-1');

      expect(result.sizeInBytes).toBe(1024);
    });
  });

  describe('getContextIdentities', () => {
    it('should get context identities', async () => {
      mockHttp.setMockResponse(
        'GET',
        '/admin-api/contexts/ctx-1/identities',
        {
          data: { identities: ['id1', 'id2'] },
        },
      );

      const result = await client.getContextIdentities('ctx-1');

      expect(result.identities).toEqual(['id1', 'id2']);
    });

    it('should handle empty identities list', async () => {
      mockHttp.setMockResponse(
        'GET',
        '/admin-api/contexts/ctx-1/identities',
        {
          data: { identities: [] },
        },
      );

      const result = await client.getContextIdentities('ctx-1');

      expect(result.identities).toEqual([]);
    });
  });

  describe('getContextIdentitiesOwned', () => {
    it('should get owned context identities', async () => {
      mockHttp.setMockResponse(
        'GET',
        '/admin-api/contexts/ctx-1/identities-owned',
        {
          data: { identities: ['owned-id1'] },
        },
      );

      const result = await client.getContextIdentitiesOwned('ctx-1');

      expect(result.identities).toEqual(['owned-id1']);
    });
  });

  describe('inviteToContext', () => {
    it('should invite to context', async () => {
      const request = {
        contextId: 'ctx-1',
        inviterId: 'inviter',
        inviteeId: 'invitee',
      };

      mockHttp.setMockResponse('POST', '/admin-api/contexts/invite', {
        data: { invitation: 'invitation-data' },
      });

      const result = await client.inviteToContext(request);

      expect(result).toBeDefined();
    });
  });

  describe('inviteToContextOpenInvitation', () => {
    it('should create open invitation', async () => {
      const request = {
        contextId: 'ctx-1',
        inviterId: 'inviter',
        validForBlocks: 1000,
      };

      mockHttp.setMockResponse(
        'POST',
        '/admin-api/contexts/invite_by_open_invitation',
        {
          data: { invitation: 'open-invitation-data' },
        },
      );

      const result = await client.inviteToContextOpenInvitation(request);

      expect(result).toBeDefined();
    });
  });

  describe('inviteSpecializedNode', () => {
    it('should invite specialized node', async () => {
      const request = {
        contextId: 'ctx-1',
        inviterId: 'inviter',
      };

      mockHttp.setMockResponse(
        'POST',
        '/admin-api/contexts/invite-specialized-node',
        {
          data: { nonce: 'nonce123' },
        },
      );

      const result = await client.inviteSpecializedNode(request);

      expect(result.nonce).toBe('nonce123');
    });

    it('should invite specialized node without inviterId', async () => {
      const request = {
        contextId: 'ctx-1',
      };

      mockHttp.setMockResponse(
        'POST',
        '/admin-api/contexts/invite-specialized-node',
        {
          data: { nonce: 'nonce456' },
        },
      );

      const result = await client.inviteSpecializedNode(request);

      expect(result.nonce).toBe('nonce456');
    });
  });

  describe('joinContext', () => {
    it('should join context', async () => {
      const request = {
        invitationPayload: { invitation: 'data' },
      };

      mockHttp.setMockResponse('POST', '/admin-api/contexts/join', {
        data: {
          contextId: 'ctx-1',
          memberPublicKey: 'pubkey',
        },
      });

      const result = await client.joinContext(request);

      expect(result.contextId).toBe('ctx-1');
      expect(result.memberPublicKey).toBe('pubkey');
    });

    it('should throw error when join response data is null', async () => {
      const request = {
        invitationPayload: { invitation: 'data' },
      };

      mockHttp.setMockResponse('POST', '/admin-api/contexts/join', {
        data: null,
      });

      await expect(client.joinContext(request)).rejects.toThrow(
        'Response data is null',
      );
    });
  });

  describe('joinContextByOpenInvitation', () => {
    it('should join context by open invitation', async () => {
      const request = {
        invitation: { signed: 'invitation' },
        newMemberPublicKey: 'new-pubkey',
      };

      mockHttp.setMockResponse(
        'POST',
        '/admin-api/contexts/join_by_open_invitation',
        {
          data: {
            contextId: 'ctx-1',
            memberPublicKey: 'new-pubkey',
          },
        },
      );

      const result = await client.joinContextByOpenInvitation(request);

      expect(result.contextId).toBe('ctx-1');
    });
  });

  describe('updateContextApplication', () => {
    it('should update context application', async () => {
      const request = {
        applicationId: 'app-1',
        executorPublicKey: 'executor-key',
      };

      mockHttp.setMockResponse(
        'PUT',
        '/admin-api/contexts/ctx-1/application',
        {
          data: { success: true },
        },
      );

      const result = await client.updateContextApplication('ctx-1', request);

      expect(result).toBeDefined();
    });
  });

  describe('getContextsForApplication', () => {
    it('should get contexts for application', async () => {
      mockHttp.setMockResponse(
        'GET',
        '/admin-api/contexts/for-application/app-1',
        {
          data: {
            contexts: [
              {
                contextId: 'ctx-1',
                applicationId: 'app-1',
                protocol: 'near',
              },
            ],
          },
        },
      );

      const result = await client.getContextsForApplication('app-1');

      expect(result.contexts).toHaveLength(1);
      expect(result.contexts[0].applicationId).toBe('app-1');
    });
  });

  describe('getContextsWithExecutorsForApplication', () => {
    it('should get contexts with executors for application', async () => {
      mockHttp.setMockResponse(
        'GET',
        '/admin-api/contexts/with-executors/for-application/app-1',
        {
          data: {
            contexts: [
              {
                contextId: 'ctx-1',
                applicationId: 'app-1',
                protocol: 'near',
              },
            ],
          },
        },
      );

      const result = await client.getContextsWithExecutorsForApplication(
        'app-1',
      );

      expect(result.contexts).toHaveLength(1);
    });
  });

  describe('getProxyContract', () => {
    it('should get proxy contract', async () => {
      mockHttp.setMockResponse(
        'GET',
        '/admin-api/contexts/ctx-1/proxy-contract',
        {
          data: { contract: 'contract-address' },
        },
      );

      const result = await client.getProxyContract('ctx-1');

      expect(result).toBeDefined();
    });
  });

  describe('syncContext', () => {
    it('should sync all contexts', async () => {
      mockHttp.setMockResponse('POST', '/admin-api/contexts/sync', {
        data: { synced: true },
      });

      const result = await client.syncContext();

      expect(result).toBeDefined();
    });
  });

  describe('syncContextById', () => {
    it('should sync specific context', async () => {
      mockHttp.setMockResponse('POST', '/admin-api/contexts/sync/ctx-1', {
        data: { synced: true },
      });

      const result = await client.syncContextById('ctx-1');

      expect(result).toBeDefined();
    });
  });
});
