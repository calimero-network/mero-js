import { describe, it, expect, beforeEach } from 'vitest';
import { TeeApiClient } from '../tee';
import { MockHttpClient } from './mock-http-client';

describe('TeeApiClient', () => {
  let client: TeeApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new TeeApiClient(mockHttp);
  });

  describe('getTeeInfo', () => {
    it('should get TEE info', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/tee/info', {
        data: {
          cloudProvider: 'gcp',
          osImage: 'ubuntu-2404-tdx-v20250115',
          mrtd: 'abc123...',
        },
      });

      const result = await client.getTeeInfo();

      expect(result).toBeDefined();
      expect(result.cloudProvider).toBe('gcp');
      expect(result.osImage).toBe('ubuntu-2404-tdx-v20250115');
      expect(result.mrtd).toBe('abc123...');
    });

    it('should throw error if response data is null', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/tee/info', { data: null });

      await expect(client.getTeeInfo()).rejects.toThrow('Response data is null');
    });
  });

  describe('attestTee', () => {
    it('should attest TEE with nonce only', async () => {
      const request = {
        nonce: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };

      const mockQuote = {
        header: {
          version: 1,
          attestationKeyType: 2,
          teeType: 0,
          qeVendorId: 'GenuineIntel',
          userData: '',
        },
        body: {
          tdxVersion: '1.0',
          teeTcbSvn: '0',
          mrseam: 'abc',
          mrsignerseam: 'def',
          seamattributes: 'ghi',
          tdattributes: 'jkl',
          xfam: 'mno',
          mrtd: 'pqr',
          mrconfigid: 'stu',
          mrowner: 'vwx',
          mrownerconfig: 'yza',
          rtmr0: 'bcd',
          rtmr1: 'efg',
          rtmr2: 'hij',
          rtmr3: 'klm',
          reportdata: 'nop',
        },
        signature: 'sig123',
        attestationKey: 'key123',
        certificationData: 'cert123',
      };

      mockHttp.setMockResponse('POST', '/admin-api/tee/attest', {
        data: {
          quoteB64: 'base64encodedquote',
          quote: mockQuote,
        },
      });

      const result = await client.attestTee(request);

      expect(result).toBeDefined();
      expect(result.quoteB64).toBe('base64encodedquote');
      expect(result.quote).toEqual(mockQuote);
    });

    it('should attest TEE with nonce and applicationId', async () => {
      const request = {
        nonce: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        applicationId: 'app-123',
      };

      mockHttp.setMockResponse('POST', '/admin-api/tee/attest', {
        data: {
          quoteB64: 'base64encodedquote',
          quote: {
            header: { version: 1, attestationKeyType: 2, teeType: 0, qeVendorId: 'GenuineIntel', userData: '' },
            body: {
              tdxVersion: '1.0',
              teeTcbSvn: '0',
              mrseam: 'abc',
              mrsignerseam: 'def',
              seamattributes: 'ghi',
              tdattributes: 'jkl',
              xfam: 'mno',
              mrtd: 'pqr',
              mrconfigid: 'stu',
              mrowner: 'vwx',
              mrownerconfig: 'yza',
              rtmr0: 'bcd',
              rtmr1: 'efg',
              rtmr2: 'hij',
              rtmr3: 'klm',
              reportdata: 'nop',
            },
            signature: 'sig123',
            attestationKey: 'key123',
            certificationData: 'cert123',
          },
        },
      });

      const result = await client.attestTee(request);

      expect(result).toBeDefined();
      expect(result.quoteB64).toBeDefined();
    });

    it('should throw error if response data is null', async () => {
      const request = { nonce: 'nonce123' };
      mockHttp.setMockResponse('POST', '/admin-api/tee/attest', {
        data: null,
      });

      await expect(client.attestTee(request)).rejects.toThrow(
        'Response data is null',
      );
    });
  });

  describe('verifyTeeQuote', () => {
    it('should verify TEE quote', async () => {
      const request = {
        quoteB64: 'base64encodedquote',
        nonce: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };

      mockHttp.setMockResponse('POST', '/admin-api/tee/verify-quote', {
        data: {
          quoteVerified: true,
          nonceVerified: true,
          quote: {
            header: { version: 1, attestationKeyType: 2, teeType: 0, qeVendorId: 'GenuineIntel', userData: '' },
            body: {
              tdxVersion: '1.0',
              teeTcbSvn: '0',
              mrseam: 'abc',
              mrsignerseam: 'def',
              seamattributes: 'ghi',
              tdattributes: 'jkl',
              xfam: 'mno',
              mrtd: 'pqr',
              mrconfigid: 'stu',
              mrowner: 'vwx',
              mrownerconfig: 'yza',
              rtmr0: 'bcd',
              rtmr1: 'efg',
              rtmr2: 'hij',
              rtmr3: 'klm',
              reportdata: 'nop',
            },
            signature: 'sig123',
            attestationKey: 'key123',
            certificationData: 'cert123',
          },
        },
      });

      const result = await client.verifyTeeQuote(request);

      expect(result).toBeDefined();
      expect(result.quoteVerified).toBe(true);
      expect(result.nonceVerified).toBe(true);
    });

    it('should verify TEE quote with application hash', async () => {
      const request = {
        quoteB64: 'base64encodedquote',
        nonce: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        expectedApplicationHash:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };

      mockHttp.setMockResponse('POST', '/admin-api/tee/verify-quote', {
        data: {
          quoteVerified: true,
          nonceVerified: true,
          applicationHashVerified: true,
          quote: {
            header: { version: 1, attestationKeyType: 2, teeType: 0, qeVendorId: 'GenuineIntel', userData: '' },
            body: {
              tdxVersion: '1.0',
              teeTcbSvn: '0',
              mrseam: 'abc',
              mrsignerseam: 'def',
              seamattributes: 'ghi',
              tdattributes: 'jkl',
              xfam: 'mno',
              mrtd: 'pqr',
              mrconfigid: 'stu',
              mrowner: 'vwx',
              mrownerconfig: 'yza',
              rtmr0: 'bcd',
              rtmr1: 'efg',
              rtmr2: 'hij',
              rtmr3: 'klm',
              reportdata: 'nop',
            },
            signature: 'sig123',
            attestationKey: 'key123',
            certificationData: 'cert123',
          },
        },
      });

      const result = await client.verifyTeeQuote(request);

      expect(result).toBeDefined();
      expect(result.quoteVerified).toBe(true);
      expect(result.nonceVerified).toBe(true);
      expect(result.applicationHashVerified).toBe(true);
    });

    it('should handle failed verification', async () => {
      const request = {
        quoteB64: 'invalidquote',
        nonce: 'invalidnonce',
      };

      mockHttp.setMockResponse('POST', '/admin-api/tee/verify-quote', {
        data: {
          quoteVerified: false,
          nonceVerified: false,
          quote: {
            header: { version: 1, attestationKeyType: 2, teeType: 0, qeVendorId: 'GenuineIntel', userData: '' },
            body: {
              tdxVersion: '1.0',
              teeTcbSvn: '0',
              mrseam: 'abc',
              mrsignerseam: 'def',
              seamattributes: 'ghi',
              tdattributes: 'jkl',
              xfam: 'mno',
              mrtd: 'pqr',
              mrconfigid: 'stu',
              mrowner: 'vwx',
              mrownerconfig: 'yza',
              rtmr0: 'bcd',
              rtmr1: 'efg',
              rtmr2: 'hij',
              rtmr3: 'klm',
              reportdata: 'nop',
            },
            signature: 'sig123',
            attestationKey: 'key123',
            certificationData: 'cert123',
          },
        },
      });

      const result = await client.verifyTeeQuote(request);

      expect(result.quoteVerified).toBe(false);
      expect(result.nonceVerified).toBe(false);
    });
  });
});
