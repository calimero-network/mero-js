/**
 * Smoke Tests - Quick validation that the SDK works
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestContext, resetTestContext, type TestContext } from './setup/index';

describe('Smoke Tests', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await getTestContext();
  }, 120000);

  afterAll(async () => {
    await resetTestContext();
  });

  describe('Health & Auth', () => {
    it('node is healthy', async () => {
      const health = await ctx.meroJs.admin.public.health();
      expect(['healthy', 'alive']).toContain(health.status);
    });

    it('is authenticated', async () => {
      expect(ctx.meroJs.isAuthenticated()).toBe(true);
      expect(ctx.meroJs.getTokenData()?.access_token).toBeDefined();
    });

    it('auth service is healthy', async () => {
      const health = await ctx.meroJs.auth.getHealth();
      expect(health.status).toBe('healthy');
    });
  });

  describe('Admin API', () => {
    it('list applications', async () => {
      const apps = await ctx.meroJs.admin.applications.listApplications();
      expect(Array.isArray(apps.apps)).toBe(true);
    });

    it('list contexts', async () => {
      const contexts = await ctx.meroJs.admin.contexts.listContexts();
      expect(Array.isArray(contexts.contexts)).toBe(true);
    });

    it('generate identity', async () => {
      const identity = await ctx.meroJs.admin.identity.generateContextIdentity();
      expect(identity.publicKey).toBeDefined();
    });
  });

  describe('Blob Operations', () => {
    it('upload and download blob', async () => {
      const testData = 'Hello, Calimero!';
      const blob = new Blob([testData]);

      // Upload
      const result = await ctx.meroJs.admin.blobs.uploadBlob(blob);
      expect(result.blobId).toBeDefined();
      expect(result.size).toBe(testData.length);

      // Download
      const downloaded = await ctx.meroJs.admin.blobs.getBlob(result.blobId);
      const text = await downloaded.text();
      expect(text).toBe(testData);
    });
  });
});
