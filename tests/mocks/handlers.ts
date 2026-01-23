import { http, HttpResponse } from 'msw';

/**
 * Base handlers matching OpenAPI spec structure
 * These provide default successful responses for common endpoints
 */
export const baseHandlers = [
  // Admin API - Public endpoints
  http.get('*/admin-api/health', () => {
    return HttpResponse.json({ data: { status: 'ok' } });
  }),

  http.get('*/admin-api/is-authed', () => {
    return HttpResponse.json({ data: { authed: true } });
  }),

  // Admin API - Applications
  http.get('*/admin-api/applications', () => {
    return HttpResponse.json({
      data: [
        { id: 'app1', name: 'Test App', version: '1.0.0' },
      ],
    });
  }),

  http.get('*/admin-api/applications/:id', ({ params }) => {
    return HttpResponse.json({
      data: { id: params.id, name: 'Test App', version: '1.0.0' },
    });
  }),

  http.post('*/admin-api/install-application', () => {
    return HttpResponse.json({ data: { applicationId: 'app-123' } });
  }),

  http.post('*/admin-api/install-dev-application', () => {
    return HttpResponse.json({ data: { applicationId: 'app-dev-123' } });
  }),

  http.delete('*/admin-api/applications/:id', () => {
    return HttpResponse.json({ data: { deleted: true } });
  }),

  // Admin API - Contexts
  http.get('*/admin-api/contexts', () => {
    return HttpResponse.json({
      data: [{ id: 'ctx-1', name: 'Test Context' }],
    });
  }),

  http.get('*/admin-api/contexts/:id', ({ params }) => {
    return HttpResponse.json({
      data: { id: params.id, name: 'Test Context' },
    });
  }),

  http.post('*/admin-api/contexts', () => {
    return HttpResponse.json({ data: { contextId: 'ctx-new' } });
  }),

  http.delete('*/admin-api/contexts/:id', () => {
    return HttpResponse.json({ data: { deleted: true } });
  }),

  // Admin API - Proposals
  http.get('*/admin-api/contexts/:id/proposals/count', () => {
    return HttpResponse.json({ data: 0 });
  }),

  // Admin API - Blobs
  http.get('*/admin-api/blobs', () => {
    return HttpResponse.json({
      data: { blobs: [{ blobId: 'blob1', size: 100, hash: null }] },
    });
  }),

  http.get('*/admin-api/blobs/:id', () => {
    return HttpResponse.json({ data: { blobId: 'blob1', size: 100, hash: null } });
  }),

  // Auth API
  http.get('*/auth/health', () => {
    return HttpResponse.json({ data: { status: 'ok' } });
  }),

  http.get('*/auth/challenge', () => {
    return HttpResponse.json({
      data: { challenge: 'challenge123', nonce: 'nonce123', timestamp: Date.now() },
    });
  }),

  http.post('*/auth/token', () => {
    return HttpResponse.json({
      data: {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_in: 3600,
      },
    });
  }),

  http.post('*/auth/refresh', () => {
    return HttpResponse.json({
      data: {
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      },
    });
  }),
];
