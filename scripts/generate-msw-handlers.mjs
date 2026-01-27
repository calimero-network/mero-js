#!/usr/bin/env node
/**
 * Generate MSW handlers from OpenAPI specification
 * 
 * This script reads the OpenAPI spec from the core-server-open-api repository
 * and generates MSW request handlers with realistic mock data.
 * 
 * The script downloads the spec from GitHub by default, ensuring you always
 * get the latest version from the main branch.
 * 
 * Usage:
 *   pnpm generate:msw                    # Uses main branch from GitHub
 *   pnpm generate:msw --branch v1.0.0   # Uses specific tag/branch
 *   pnpm generate:msw --local ./path     # Uses local file
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store resolved schemas for reference resolution
let resolvedSchemas = {};

/**
 * Convert OpenAPI path pattern to MSW path pattern
 */
function convertPathToMSWPattern(openApiPath) {
  return `*${openApiPath.replace(/\{([^}]+)\}/g, ':$1')}`;
}

/**
 * Resolve a $ref to its schema definition
 */
function resolveRef(ref, spec) {
  if (!ref || !ref.startsWith('#/')) return null;
  
  const parts = ref.replace('#/', '').split('/');
  let current = spec;
  for (const part of parts) {
    if (!current[part]) return null;
    current = current[part];
  }
  return current;
}

/**
 * Generate mock value from schema type
 */
function generateMockValue(schema, spec, depth = 0) {
  if (depth > 5) return null; // Prevent infinite recursion
  
  if (!schema) return null;
  
  // Handle $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, spec);
    return generateMockValue(resolved, spec, depth + 1);
  }
  
  // Handle example first
  if (schema.example !== undefined) {
    return schema.example;
  }
  
  // Handle oneOf/anyOf - pick first option
  if (schema.oneOf?.[0]) {
    return generateMockValue(schema.oneOf[0], spec, depth + 1);
  }
  if (schema.anyOf?.[0]) {
    return generateMockValue(schema.anyOf[0], spec, depth + 1);
  }
  
  // Handle nullable
  if (schema.nullable && depth > 2) {
    return null;
  }
  
  const type = schema.type;
  
  switch (type) {
    case 'string':
      if (schema.enum) return schema.enum[0];
      if (schema.format === 'date-time') return '2024-01-15T10:30:00Z';
      if (schema.format === 'uri') return 'https://example.com';
      if (schema.format === 'binary') return '<binary data>';
      // Generate realistic strings based on common field names
      return generateStringFromContext(schema);
      
    case 'integer':
    case 'number':
      if (schema.minimum !== undefined) return schema.minimum;
      if (schema.format === 'int64') return 3600;
      return 0;
      
    case 'boolean':
      return true;
      
    case 'array':
      if (schema.items) {
        const item = generateMockValue(schema.items, spec, depth + 1);
        return item !== null ? [item] : [];
      }
      return [];
      
    case 'object':
      return generateObjectFromSchema(schema, spec, depth);
      
    default:
      // No type specified, try to infer from properties
      if (schema.properties) {
        return generateObjectFromSchema(schema, spec, depth);
      }
      if (schema.additionalProperties) {
        return {};
      }
      return null;
  }
}

/**
 * Generate a string value based on schema context
 */
function generateStringFromContext(schema) {
  const description = (schema.description || '').toLowerCase();
  
  // Common patterns
  if (description.includes('token')) return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock';
  if (description.includes('key') && description.includes('public')) return 'ed25519:mock_public_key_abc123';
  if (description.includes('id') || description.includes('identifier')) return 'mock_id_12345';
  if (description.includes('hash')) return 'abc123def456';
  if (description.includes('nonce')) return 'random_nonce_xyz';
  if (description.includes('challenge')) return 'challenge_string_to_sign';
  if (description.includes('name')) return 'mock-name';
  if (description.includes('version')) return '1.0.0';
  if (description.includes('status')) return 'active';
  
  return 'mock_string';
}

/**
 * Generate object from schema properties
 */
function generateObjectFromSchema(schema, spec, depth) {
  if (!schema.properties) return {};
  
  const result = {};
  
  for (const [propName, propSchema] of Object.entries(schema.properties)) {
    const value = generateMockValue(propSchema, spec, depth + 1);
    if (value !== undefined) {
      result[propName] = value;
    }
  }
  
  return result;
}

/**
 * Extract response data from OpenAPI response schema
 */
function extractResponseData(response, operation, spec) {
  // Handle text/plain (like validate token returns empty string)
  if (response.content?.['text/plain']) {
    const textSchema = response.content['text/plain'].schema;
    if (textSchema?.example !== undefined) {
      return { isText: true, data: textSchema.example };
    }
    return { isText: true, data: '' };
  }
  
  if (!response.content?.['application/json']) {
    return null;
  }

  const content = response.content['application/json'];
  const schema = content.schema;
  
  // Prefer explicit example
  if (content.example) {
    return { isText: false, data: content.example };
  }
  
  // Try to generate from schema
  if (schema) {
    const mockData = generateMockValue(schema, spec, 0);
    if (mockData !== null) {
      return { isText: false, data: mockData };
    }
  }
  
  // Fallback based on operation summary
  const summary = (operation.summary || '').toLowerCase();
  if (summary.includes('list') || summary.includes('get all')) {
    return { isText: false, data: { data: [] } };
  }
  if (summary.includes('count') || summary.includes('number')) {
    return { isText: false, data: { data: 0 } };
  }
  
  return { isText: false, data: { data: {} } };
}

/**
 * Generate MSW handler code from OpenAPI operation
 */
function generateHandler(method, pathStr, operation, spec) {
  const mswPath = convertPathToMSWPattern(pathStr);
  const methodLower = method.toLowerCase();

  // Get first successful response (200, 201, etc.)
  const successStatus = Object.keys(operation.responses || {}).find(
    (status) => status.startsWith('2'),
  );

  if (!successStatus) {
    return `  // ${method.toUpperCase()} ${pathStr} - No success response defined
  // http.${methodLower}('${mswPath}', () => {
  //   return HttpResponse.json({ data: {} });
  // }),`;
  }

  const response = operation.responses[successStatus];
  const responseResult = extractResponseData(response, operation, spec);
  
  const comment = operation.summary || operation.operationId || `${method} ${pathStr}`;

  // Handle text responses (like validate token)
  if (responseResult?.isText) {
    const textValue = JSON.stringify(responseResult.data);
    return `  // ${comment}
  http.${methodLower}('${mswPath}', () => {
    return new HttpResponse(${textValue}, {
      headers: { 'Content-Type': 'text/plain' },
    });
  }),`;
  }

  // JSON response
  let jsonData = responseResult?.data ?? { data: {} };
  
  // Ensure data wrapper exists (API convention)
  if (typeof jsonData === 'object' && jsonData !== null && !Array.isArray(jsonData) && !('data' in jsonData) && !('error' in jsonData)) {
    jsonData = { data: jsonData };
  }
  
  const jsonResponse = JSON.stringify(jsonData, null, 2)
    .split('\n')
    .map((line, i) => i === 0 ? line : '    ' + line) // Indent continuation lines
    .join('\n');

  return `  // ${comment}
  http.${methodLower}('${mswPath}', () => {
    return HttpResponse.json(${jsonResponse});
  }),`;
}

/**
 * Generate all MSW handlers from OpenAPI spec
 */
function generateHandlers(spec) {
  // Store schemas for reference resolution
  resolvedSchemas = spec.components?.schemas || {};
  
  const handlers = [];
  handlers.push("import { http, HttpResponse } from 'msw';");
  handlers.push('');
  handlers.push('/**');
  handlers.push(' * Auto-generated MSW handlers from OpenAPI specification');
  handlers.push(' * Generated from: core-server-open-api repository');
  handlers.push(` * Generated at: ${new Date().toISOString()}`);
  handlers.push(' * ');
  handlers.push(' * DO NOT EDIT MANUALLY - Regenerate with: pnpm generate:msw');
  handlers.push(' * ');
  handlers.push(' * These handlers return realistic mock data based on the OpenAPI schemas.');
  handlers.push(' * Override specific handlers in tests with server.use() for custom scenarios.');
  handlers.push(' */');
  handlers.push('');
  handlers.push('export const generatedHandlers = [');

  // Track paths to avoid duplicates
  const processedPaths = new Set();

  for (const [pathStr, pathItem] of Object.entries(spec.paths || {})) {
    if (!pathItem) continue;

    const methods = [];
    if (pathItem.get) methods.push({ method: 'get', operation: pathItem.get });
    if (pathItem.post) methods.push({ method: 'post', operation: pathItem.post });
    if (pathItem.put) methods.push({ method: 'put', operation: pathItem.put });
    if (pathItem.delete) methods.push({ method: 'delete', operation: pathItem.delete });
    if (pathItem.patch) methods.push({ method: 'patch', operation: pathItem.patch });
    if (pathItem.head) methods.push({ method: 'head', operation: pathItem.head });

    for (const { method, operation } of methods) {
      if (!operation) continue;

      // Only generate handlers for admin-api, auth, and jsonrpc paths
      if (!pathStr.startsWith('/admin-api') && !pathStr.startsWith('/auth') && !pathStr.startsWith('/jsonrpc')) {
        continue;
      }

      const pathKey = `${method}:${pathStr}`;
      if (processedPaths.has(pathKey)) continue;
      processedPaths.add(pathKey);

      handlers.push(generateHandler(method, pathStr, operation, spec));
      handlers.push('');
    }
  }

  handlers.push('];');

  return handlers.join('\n');
}

/**
 * Download spec from GitHub
 */
function downloadFromGitHub(branch = 'main') {
  return new Promise((resolve, reject) => {
    const url = `https://raw.githubusercontent.com/calimero-network/core-server-open-api/${branch}/specs/core-server/openapi.yaml`;
    
    console.log(`📥 Downloading OpenAPI spec from GitHub (${branch})...`);
    
    https.get(url, (res) => {
      if (res.statusCode === 404) {
        reject(new Error(`Branch/tag '${branch}' not found`));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', (err) => {
      reject(new Error(`Network error: ${err.message}`));
    });
  });
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2);
  const branchIndex = args.indexOf('--branch');
  const localIndex = args.indexOf('--local');
  
  const branch = branchIndex >= 0 && args[branchIndex + 1] 
    ? args[branchIndex + 1] 
    : process.env.OPENAPI_SPEC_BRANCH || 'main';
  
  const localPath = localIndex >= 0 && args[localIndex + 1]
    ? args[localIndex + 1]
    : process.env.OPENAPI_SPEC_LOCAL;

  const outputPath = path.join(__dirname, '../tests/mocks/generated-handlers.ts');

  let specContent;
  let specSource;

  if (localPath) {
    const resolvedPath = path.isAbsolute(localPath) 
      ? localPath 
      : path.resolve(process.cwd(), localPath);
    
    if (!fs.existsSync(resolvedPath)) {
      console.error(`❌ File not found: ${resolvedPath}`);
      process.exit(1);
    }
    console.log(`📖 Reading from: ${resolvedPath}`);
    specContent = fs.readFileSync(resolvedPath, 'utf8');
    specSource = resolvedPath;
  } else {
    try {
      specContent = await downloadFromGitHub(branch);
      specSource = `GitHub (${branch})`;
    } catch (error) {
      console.error('❌', error.message);
      console.error('');
      console.error('   Try: pnpm generate:msw --local ../core-server-open-api/specs/core-server/openapi.yaml');
      process.exit(1);
    }
  }

  const spec = yaml.load(specContent);
  const pathCount = Object.keys(spec.paths || {}).length;
  const schemaCount = Object.keys(spec.components?.schemas || {}).length;
  
  console.log(`✅ Loaded: ${pathCount} paths, ${schemaCount} schemas from ${specSource}`);

  const handlersCode = generateHandlers(spec);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, handlersCode, 'utf8');

  const handlerCount = (handlersCode.match(/http\.(get|post|put|delete|patch|head)\(/g) || []).length;
  console.log(`✅ Generated ${handlerCount} handlers → ${outputPath}`);
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
