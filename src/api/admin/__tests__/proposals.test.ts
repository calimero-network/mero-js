import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../tests/mocks/server';
import { ProposalsApiClient } from '../proposals';
import { createBrowserHttpClient } from '../../../http-client';

describe('ProposalsApiClient', () => {
  let client: ProposalsApiClient;

  beforeEach(() => {
    const httpClient = createBrowserHttpClient({
      baseUrl: 'http://localhost:8080',
      timeoutMs: 5000,
    });
    client = new ProposalsApiClient(httpClient);
  });

  describe('getProposals', () => {
    it('should get proposals', async () => {
      const request = { offset: 0, limit: 10 };

      server.use(
        http.post('*/admin-api/contexts/ctx-1/proposals', () => {
          return HttpResponse.json({
            data: [{ proposalId: 'prop-1' }, { proposalId: 'prop-2' }],
          });
        }),
      );

      const result = await client.getProposals('ctx-1', request);

      expect(result).toHaveLength(2);
    });
  });

  describe('getProposal', () => {
    it('should get proposal by id', async () => {
      server.use(
        http.get('*/admin-api/contexts/ctx-1/proposals/prop-1', () => {
          return HttpResponse.json({
            data: { proposalId: 'prop-1', data: 'test' },
          });
        }),
      );

      const result = await client.getProposal('ctx-1', 'prop-1');

      expect(result).toEqual({ proposalId: 'prop-1', data: 'test' });
    });
  });

  describe('approveProposal', () => {
    it('should approve proposal', async () => {
      const request = { signerId: 'signer', proposalId: 'prop-1' };

      server.use(
        http.post('*/admin-api/contexts/ctx-1/proposals/approve', () => {
          return HttpResponse.json({
            data: { proposalId: 'prop-1', approved: true },
          });
        }),
      );

      const result = await client.approveProposal('ctx-1', request);

      expect(result).toBeDefined();
    });
  });

  describe('getNumberOfActiveProposals', () => {
    it('should get number of active proposals', async () => {
      server.use(
        http.get('*/admin-api/contexts/ctx-1/proposals/count', () => {
          return HttpResponse.json({ data: 5 });
        }),
      );

      const result = await client.getNumberOfActiveProposals('ctx-1');

      expect(result).toBe(5);
    });

    it('should handle zero active proposals', async () => {
      // Zero is a valid response for count endpoints
      // The unwrap function should correctly handle 0 (not treat it as falsy)
      server.use(
        http.get('*/admin-api/contexts/ctx-1/proposals/count', () => {
          return HttpResponse.json({ data: 0 });
        }),
      );

      const result = await client.getNumberOfActiveProposals('ctx-1');
      expect(result).toBe(0);
    });
  });

  describe('getNumberOfProposalApprovals', () => {
    it('should get number of proposal approvals', async () => {
      server.use(
        http.get(
          '*/admin-api/contexts/ctx-1/proposals/prop-1/approvals/count',
          () => {
            return HttpResponse.json({
              data: { proposalId: 'prop-1', approvals: 3 },
            });
          },
        ),
      );

      const result = await client.getNumberOfProposalApprovals(
        'ctx-1',
        'prop-1',
      );

      expect(result).toBeDefined();
    });
  });

  describe('getProposalApprovers', () => {
    it('should get proposal approvers', async () => {
      server.use(
        http.get(
          '*/admin-api/contexts/ctx-1/proposals/prop-1/approvals/users',
          () => {
            return HttpResponse.json({
              data: [{ identity: 'id1' }, { identity: 'id2' }],
            });
          },
        ),
      );

      const result = await client.getProposalApprovers('ctx-1', 'prop-1');

      expect(result).toHaveLength(2);
    });

    it('should handle empty approvers list', async () => {
      server.use(
        http.get(
          '*/admin-api/contexts/ctx-1/proposals/prop-1/approvals/users',
          () => {
            return HttpResponse.json({ data: [] });
          },
        ),
      );

      const result = await client.getProposalApprovers('ctx-1', 'prop-1');

      expect(result).toHaveLength(0);
    });
  });

  describe('getContextValue', () => {
    it('should get context value', async () => {
      const request = { key: 'test-key' };

      server.use(
        http.post(
          '*/admin-api/contexts/ctx-1/proposals/get-context-value',
          () => {
            return HttpResponse.json({ data: [1, 2, 3, 4, 5] });
          },
        ),
      );

      const result = await client.getContextValue('ctx-1', request);

      expect(result).toEqual([1, 2, 3, 4, 5]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle empty context value', async () => {
      const request = { key: 'empty-key' };

      server.use(
        http.post(
          '*/admin-api/contexts/ctx-1/proposals/get-context-value',
          () => {
            return HttpResponse.json({ data: [] });
          },
        ),
      );

      const result = await client.getContextValue('ctx-1', request);

      expect(result).toEqual([]);
    });
  });

  describe('getContextStorageEntries', () => {
    it('should get context storage entries', async () => {
      const request = { offset: 0, limit: 10 };

      server.use(
        http.post(
          '*/admin-api/contexts/ctx-1/proposals/context-storage-entries',
          () => {
            return HttpResponse.json({
              data: [{ key: 'key1', value: 'value1' }],
            });
          },
        ),
      );

      const result = await client.getContextStorageEntries('ctx-1', request);

      expect(result).toHaveLength(1);
    });

    it('should handle pagination', async () => {
      const request = { offset: 10, limit: 20 };

      server.use(
        http.post(
          '*/admin-api/contexts/ctx-1/proposals/context-storage-entries',
          () => {
            return HttpResponse.json({ data: [] });
          },
        ),
      );

      const result = await client.getContextStorageEntries('ctx-1', request);

      expect(result).toHaveLength(0);
    });
  });

  describe('createAndApproveProposal', () => {
    it('should create and approve proposal', async () => {
      const request = {
        signerId: 'signer',
        proposal: { action: 'test' },
      };

      server.use(
        http.post(
          '*/admin-api/contexts/ctx-1/proposals/create-and-approve',
          () => {
            return HttpResponse.json({
              data: { proposalId: 'prop-new', approved: true },
            });
          },
        ),
      );

      const result = await client.createAndApproveProposal('ctx-1', request);

      expect(result).toBeDefined();
    });
  });
});
