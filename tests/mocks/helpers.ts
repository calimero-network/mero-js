import { http, HttpResponse } from 'msw';

/**
 * Helper functions for creating common mock scenarios
 */

export const createErrorHandler = (
  path: string,
  status: number,
  message: string,
) => {
  return http.all(path, () => {
    return HttpResponse.json({ error: message }, { status });
  });
};

export const createTimeoutHandler = (path: string, delay: number) => {
  return http.all(path, async () => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return HttpResponse.json({ data: {} });
  });
};

export const createEmptyResponseHandler = (path: string) => {
  return http.all(path, () => {
    return HttpResponse.json({ data: [] });
  });
};

export const createNullResponseHandler = (path: string) => {
  return http.all(path, () => {
    return HttpResponse.json({ data: null });
  });
};

export const createMalformedJsonHandler = (path: string) => {
  return http.all(path, () => {
    return new HttpResponse('invalid json', {
      headers: { 'Content-Type': 'application/json' },
    });
  });
};
