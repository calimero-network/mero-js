import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../tests/mocks/server';
import { ProposalsApiClient } from '../proposals';
import { createBrowserHttpClient } from '../../../http-client';
import { createErrorHandler } from '../../../../tests/mocks/helpers';

describe('ProposalsApiClient - MSW Integration Tests', () => {
  let client: ProposalsApiClient;

  beforeEach(() => {
    const httpClient = createBrowserHttpClient({
      baseUrl: 'http://localhost:8080',
      timeoutMs: 5000,
    });
    client = new ProposalsApiClient(httpClient);
  });

  describe('Success Scenarios', () => {
    it('should get proposals', async () => {
      server.use(
        http.post('*/admin-api/contexts/:id/proposals', () => {
          return HttpResponse.json({
            data: [{ proposalId: 'prop1', status: 'active' }],
          });
        }),
      );

      const result = await client.getProposals('ctx-1', {
        offset: 0,
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should get proposal by id', async () => {
      server.use(
        http.get('*/admin-api/contexts/:id/proposals/:proposalId', () => {
          return HttpResponse.json({
            data: { proposalId: 'prop1', status: 'active' },
          });
        }),
      );

      const result = await client.getProposal('ctx-1', 'prop1');
      expect(result.proposalId).toBe('prop1');
    });
  });

  describe('Edge Cases - Zero Count (Critical)', () => {
    it('should handle zero active proposals correctly', async () => {
      // This test verifies the fix for the falsy value check bug
      // Zero is a valid response and should NOT be treated as null/undefined
      server.use(
        http.get('*/admin-api/contexts/:id/proposals/count', () => {
          return HttpResponse.json({ data: 0 }); // Valid zero response
        }),
      );

      const result = await client.getNumberOfActiveProposals('ctx-1');
      expect(result).toBe(0);
      expect(typeof result).toBe('number');
    });

    it('should handle zero approvals correctly', async () => {
      server.use(
        http.get('*/admin-api/contexts/:id/proposals/:proposalId/approvals/count', () => {
          return HttpResponse.json({ data: { proposalId: 'prop1', approvals: 0 } });
        }),
      );

      const result = await client.getNumberOfProposalApprovals('ctx-1', 'prop1');
      expect(result).toBeDefined();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle 404 Not Found', async () => {
      server.use(
        http.get('*/admin-api/contexts/:id/proposals/nonexistent', () => {
          return HttpResponse.json(
            { error: 'Proposal not found' },
            { status: 404 },
          );
        }),
      );

      await expect(
        client.getProposal('ctx-1', 'nonexistent'),
      ).rejects.toThrow();
    });

    it('should handle 401 Unauthorized', async () => {
      server.use(
        createErrorHandler(
          '*/admin-api/contexts/:id/proposals',
          401,
          'Unauthorized',
        ),
      );

      await expect(
        client.getProposals('ctx-1', { offset: 0, limit: 10 }),
      ).rejects.toThrow();
    });

    it('should handle 500 Internal Server Error', async () => {
      server.use(
        createErrorHandler(
          '*/admin-api/contexts/:id/proposals/count',
          500,
          'Internal server error',
        ),
      );

      await expect(
        client.getNumberOfActiveProposals('ctx-1'),
      ).rejects.toThrow();
    });

    it('should handle 400 Bad Request', async () => {
      server.use(
        http.post('*/admin-api/contexts/:id/proposals/create-and-approve', () => {
          return HttpResponse.json(
            { error: 'Invalid proposal data' },
            { status: 400 },
          );
        }),
      );

      await expect(
        client.createAndApproveProposal('ctx-1', {
          signerId: 'signer1',
          proposal: {},
        }),
      ).rejects.toThrow();
    });
  });

  describe('Empty Responses', () => {
    it('should handle empty proposals list', async () => {
      server.use(
        http.post('*/admin-api/contexts/:id/proposals', () => {
          return HttpResponse.json({ data: [] });
        }),
      );

      const result = await client.getProposals('ctx-1', {
        offset: 0,
        limit: 10,
      });
      expect(result).toEqual([]);
    });

    it('should handle empty approvers list', async () => {
      server.use(
        http.get('*/admin-api/contexts/:id/proposals/:proposalId/approvals/users', () => {
          return HttpResponse.json({ data: [] });
        }),
      );

      const result = await client.getProposalApprovers('ctx-1', 'prop1');
      expect(result).toEqual([]);
    });
  });
});
