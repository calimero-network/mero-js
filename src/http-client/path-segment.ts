// encodeURIComponent leaves "." and ".." intact and URL parsers collapse them,
// so those (and the empty id, which names the collection route) are refused.
export function pathSegment(id: string): string {
  if (id === '' || id === '.' || id === '..') {
    throw new TypeError(`invalid request path segment: ${JSON.stringify(id)}`);
  }
  return encodeURIComponent(id);
}
