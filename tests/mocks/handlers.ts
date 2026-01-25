import type { HttpHandler } from 'msw';
import { generatedHandlers } from './generated-handlers';

/**
 * Base handlers for MSW tests
 *
 * Most handlers are auto-generated from the OpenAPI specification.
 * To regenerate: pnpm generate:msw
 *
 * For custom overrides, import http/HttpResponse from 'msw' and spread:
 * const handlers = [...baseHandlers, http.get(...), ...]
 */
export const baseHandlers: HttpHandler[] = [...generatedHandlers];
