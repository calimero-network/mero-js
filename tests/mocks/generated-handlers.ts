import { http, HttpResponse } from 'msw';

/**
 * Auto-generated MSW handlers from OpenAPI specification
 * Generated from: core-server-open-api repository
 * Generated at: 2026-01-24T13:01:45.040Z
 * 
 * DO NOT EDIT MANUALLY - Regenerate with: pnpm generate:msw
 * 
 * These handlers return realistic mock data based on the OpenAPI schemas.
 * Override specific handlers in tests with server.use() for custom scenarios.
 */

export const generatedHandlers = [
  // Health Check
  http.get('*/admin-api/health', () => {
    return HttpResponse.json({
      "data": {
        "status": "alive"
      }
    });
  }),

  // Authentication Status
  http.get('*/admin-api/is-authed', () => {
    return HttpResponse.json({
      "data": {
        "status": "alive"
      }
    });
  }),

  // Get Certificate
  http.get('*/admin-api/certificate', () => {
    return new HttpResponse("", {
      headers: { 'Content-Type': 'text/plain' },
    });
  }),

  // Install Application
  http.post('*/admin-api/install-application', () => {
    return HttpResponse.json({
      "data": {
        "applicationId": "mock_string"
      }
    });
  }),

  // Install Dev Application
  http.post('*/admin-api/install-dev-application', () => {
    return HttpResponse.json({
      "data": {
        "applicationId": "mock_string"
      }
    });
  }),

  // List Applications
  http.get('*/admin-api/applications', () => {
    return HttpResponse.json({
      "data": {
        "apps": [
          {
            "applicationId": null,
            "metadata": null
          }
        ]
      }
    });
  }),

  // Get Application
  http.get('*/admin-api/applications/:application_id', () => {
    return HttpResponse.json({
      "data": {
        "application": {
          "applicationId": "mock_string",
          "metadata": []
        }
      }
    });
  }),

  // Uninstall Application
  http.delete('*/admin-api/applications/:application_id', () => {
    return HttpResponse.json({
      "data": {
        "applicationId": "mock_string"
      }
    });
  }),

  // List Packages
  http.get('*/admin-api/packages', () => {
    return HttpResponse.json({
      "data": {
        "packages": [
          "mock_string"
        ]
      }
    });
  }),

  // List Versions
  http.get('*/admin-api/packages/:package/versions', () => {
    return HttpResponse.json({
      "data": {
        "versions": [
          "mock_string"
        ]
      }
    });
  }),

  // Get Latest Version
  http.get('*/admin-api/packages/:package/latest', () => {
    return HttpResponse.json({
      "data": {
        "applicationId": "mock_string"
      }
    });
  }),

  // List Contexts
  http.get('*/admin-api/contexts', () => {
    return HttpResponse.json({
      "data": {
        "contexts": [
          {
            "contextId": null,
            "applicationId": null,
            "protocol": null
          }
        ]
      }
    });
  }),

  // Create Context
  http.post('*/admin-api/contexts', () => {
    return HttpResponse.json({
      "data": {
        "contextId": "mock_string",
        "memberPublicKey": "mock_string"
      }
    });
  }),

  // Get Context
  http.get('*/admin-api/contexts/:context_id', () => {
    return HttpResponse.json({
      "data": {
        "contextId": "mock_string",
        "applicationId": "mock_string",
        "protocol": "mock_string"
      }
    });
  }),

  // Delete Context
  http.delete('*/admin-api/contexts/:context_id', () => {
    return HttpResponse.json({
      "data": {
        "isDeleted": true
      }
    });
  }),

  // Get Context Storage
  http.get('*/admin-api/contexts/:context_id/storage', () => {
    return HttpResponse.json({
      "data": {
        "sizeInBytes": 3600
      }
    });
  }),

  // Get Context Identities
  http.get('*/admin-api/contexts/:context_id/identities', () => {
    return HttpResponse.json({
      "data": {
        "identities": [
          "mock_string"
        ]
      }
    });
  }),

  // Get Owned Context Identities
  http.get('*/admin-api/contexts/:context_id/identities-owned', () => {
    return HttpResponse.json({
      "data": {
        "identities": [
          "mock_string"
        ]
      }
    });
  }),

  // Invite to Context
  http.post('*/admin-api/contexts/invite', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Create Open Invitation
  http.post('*/admin-api/contexts/invite_by_open_invitation', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Invite Specialized Node
  http.post('*/admin-api/contexts/invite-specialized-node', () => {
    return HttpResponse.json({
      "data": {
        "nonce": "random_nonce_xyz"
      }
    });
  }),

  // Join Context
  http.post('*/admin-api/contexts/join', () => {
    return HttpResponse.json({
      "data": {
        "contextId": "mock_string",
        "memberPublicKey": "mock_string"
      }
    });
  }),

  // Join Context by Open Invitation
  http.post('*/admin-api/contexts/join_by_open_invitation', () => {
    return HttpResponse.json({
      "data": {
        "contextId": "mock_string",
        "memberPublicKey": "mock_string"
      }
    });
  }),

  // Update Context Application
  http.post('*/admin-api/contexts/:context_id/application', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Get Contexts for Application
  http.get('*/admin-api/contexts/for-application/:application_id', () => {
    return HttpResponse.json({
      "data": {
        "contexts": [
          {
            "contextId": null,
            "applicationId": null,
            "protocol": null
          }
        ]
      }
    });
  }),

  // Get Contexts with Executors for Application
  http.get('*/admin-api/contexts/with-executors/for-application/:application_id', () => {
    return HttpResponse.json({
      "data": {
        "contexts": [
          {
            "contextId": null,
            "applicationId": null,
            "protocol": null
          }
        ]
      }
    });
  }),

  // Grant Capabilities
  http.post('*/admin-api/contexts/:context_id/capabilities/grant', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Revoke Capabilities
  http.post('*/admin-api/contexts/:context_id/capabilities/revoke', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Get Proposals
  http.post('*/admin-api/contexts/:context_id/proposals', () => {
    return HttpResponse.json({
      "data": [
        {}
      ]
    });
  }),

  // Get Proposal
  http.get('*/admin-api/contexts/:context_id/proposals/:proposal_id', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Create and Approve Proposal
  http.post('*/admin-api/contexts/:context_id/proposals/create-and-approve', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Approve Proposal
  http.post('*/admin-api/contexts/:context_id/proposals/approve', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Get Number of Active Proposals
  http.get('*/admin-api/contexts/:context_id/proposals/count', () => {
    return HttpResponse.json({
      "data": 0
    });
  }),

  // Get Number of Proposal Approvals
  http.get('*/admin-api/contexts/:context_id/proposals/:proposal_id/approvals/count', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Get Proposal Approvers
  http.get('*/admin-api/contexts/:context_id/proposals/:proposal_id/approvals/users', () => {
    return HttpResponse.json({
      "data": [
        {}
      ]
    });
  }),

  // Get Context Value
  http.post('*/admin-api/contexts/:context_id/proposals/get-context-value', () => {
    return HttpResponse.json({
      "data": [
        0
      ]
    });
  }),

  // Get Context Storage Entries
  http.post('*/admin-api/contexts/:context_id/proposals/context-storage-entries', () => {
    return HttpResponse.json({
      "data": [
        {}
      ]
    });
  }),

  // Get Proxy Contract
  http.get('*/admin-api/contexts/:context_id/proxy-contract', () => {
    return HttpResponse.json({
      "data": "mock_string"
    });
  }),

  // Sync Contexts
  http.post('*/admin-api/contexts/sync', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Sync Context
  http.post('*/admin-api/contexts/sync/:context_id', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Generate Context Identity
  http.post('*/admin-api/identity/context', () => {
    return HttpResponse.json({
      "data": {
        "publicKey": "mock_string"
      }
    });
  }),

  // Get Peers Count
  http.get('*/admin-api/peers', () => {
    return HttpResponse.json({
      "data": {
        "count": 0
      }
    });
  }),

  // List Blobs
  http.get('*/admin-api/blobs', () => {
    return HttpResponse.json({
      "data": {
        "blobs": [
          {
            "blob_id": null,
            "size": null,
            "hash": null
          }
        ]
      }
    });
  }),

  // Upload Blob
  http.put('*/admin-api/blobs', () => {
    return HttpResponse.json({
      "data": {
        "blob_id": "mock_string",
        "size": 3600,
        "hash": null
      }
    });
  }),

  // Download Blob
  http.get('*/admin-api/blobs/:blob_id', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Delete Blob
  http.delete('*/admin-api/blobs/:blob_id', () => {
    return HttpResponse.json({
      "data": {
        "blob_id": "mock_string",
        "deleted": true
      }
    });
  }),

  // Get Blob Info
  http.head('*/admin-api/blobs/:blob_id', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Create Context Alias
  http.post('*/admin-api/alias/create/context', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Create Application Alias
  http.post('*/admin-api/alias/create/application', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Create Identity Alias
  http.post('*/admin-api/alias/create/identity/:context', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Lookup Context Alias
  http.post('*/admin-api/alias/lookup/context/:name', () => {
    return HttpResponse.json({
      "data": {
        "value": null
      }
    });
  }),

  // Lookup Application Alias
  http.post('*/admin-api/alias/lookup/application/:name', () => {
    return HttpResponse.json({
      "data": {
        "value": null
      }
    });
  }),

  // Lookup Identity Alias
  http.post('*/admin-api/alias/lookup/identity/:context/:name', () => {
    return HttpResponse.json({
      "data": {
        "value": null
      }
    });
  }),

  // List Context Aliases
  http.get('*/admin-api/alias/list/context', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // List Application Aliases
  http.get('*/admin-api/alias/list/application', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // List Identity Aliases
  http.get('*/admin-api/alias/list/identity/:context', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Delete Context Alias
  http.post('*/admin-api/alias/delete/context/:name', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Delete Application Alias
  http.post('*/admin-api/alias/delete/application/:name', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Delete Identity Alias
  http.post('*/admin-api/alias/delete/identity/:context/:name', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Get TEE Info
  http.get('*/admin-api/tee/info', () => {
    return HttpResponse.json({
      "data": {
        "cloudProvider": "gcp",
        "osImage": "ubuntu-2404-tdx-v20250115",
        "mrtd": "mock_string"
      }
    });
  }),

  // TEE Attestation
  http.post('*/admin-api/tee/attest', () => {
    return HttpResponse.json({
      "data": {
        "quoteB64": "mock_string",
        "quote": {
          "header": null,
          "body": null,
          "signature": "mock_string",
          "attestationKey": "mock_string",
          "certificationData": null
        }
      }
    });
  }),

  // Verify TEE Quote
  http.post('*/admin-api/tee/verify-quote', () => {
    return HttpResponse.json({
      "data": {
        "quoteVerified": true,
        "nonceVerified": true,
        "applicationHashVerified": null,
        "quote": {
          "header": null,
          "body": null,
          "signature": "mock_string",
          "attestationKey": "mock_string",
          "certificationData": null
        }
      }
    });
  }),

  // JSON-RPC Request
  http.post('*/jsonrpc', () => {
    return HttpResponse.json({
      "jsonrpc": "2.0",
      "id": "mock_string",
      "result": {
        "output": null
      },
      "error": {
        "type": "mock_string",
        "data": "mock_string"
      }
    });
  }),

  // Auth Login UI
  http.get('*/auth/login', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

  // Get Signing Challenge
  http.get('*/auth/challenge', () => {
    return HttpResponse.json({
      "data": {
        "challenge": "challenge_string_to_sign",
        "nonce": "random_nonce_xyz"
      }
    });
  }),

  // Exchange Challenge for Token
  http.post('*/auth/token', () => {
    return HttpResponse.json({
      "data": {
        "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock",
        "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock",
        "expires_in": 3600
      }
    });
  }),

  // Refresh Token
  http.post('*/auth/refresh', () => {
    return HttpResponse.json({
      "data": {
        "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock",
        "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock",
        "expires_in": 3600
      }
    });
  }),

  // List Auth Providers
  http.get('*/auth/providers', () => {
    return HttpResponse.json({
      "data": [
        {
          "id": "mock_id_12345",
          "name": "mock_id_12345",
          "enabled": true
        }
      ]
    });
  }),

  // Get Service Identity
  http.get('*/auth/identity', () => {
    return HttpResponse.json({
      "data": {
        "service": "mock-name",
        "version": "1.0.0",
        "identity": "mock_id_12345"
      }
    });
  }),

  // Validate Token (GET)
  http.get('*/auth/validate', () => {
    return new HttpResponse("", {
      headers: { 'Content-Type': 'text/plain' },
    });
  }),

  // Validate Token (POST)
  http.post('*/auth/validate', () => {
    return new HttpResponse("", {
      headers: { 'Content-Type': 'text/plain' },
    });
  }),

  // Auth Service Health Check
  http.get('*/auth/health', () => {
    return HttpResponse.json({
      "data": {
        "status": "alive"
      }
    });
  }),

  // Auth Callback
  http.get('*/auth/callback', () => {
    return HttpResponse.json({
      "data": {}
    });
  }),

];