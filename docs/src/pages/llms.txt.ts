/**
 * Generates /llms.txt — a machine-readable index of the docs for LLM/AI tools
 * (the emerging llms.txt convention). Built from the docs content collection so
 * it never drifts from the pages.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const SITE = 'https://calimero-network.github.io';
const BASE = '/mero-js';

const TRACKS: Record<string, string> = {
  'get-started': 'Get Started — install, verify a node, sign in and make your first call',
};

export const GET: APIRoute = async () => {
  const docs = await getCollection('docs');

  const url = (id: string) => {
    const slug = id.replace(/\.(md|mdx)$/, '').replace(/\/index$/, '');
    return `${SITE}${BASE}/${slug}/`.replace(/\/+$/, '/');
  };

  const byTrack: Record<string, typeof docs> = {};
  for (const entry of docs) {
    const track = entry.id.split('/')[0];
    if (!TRACKS[track]) continue;
    (byTrack[track] ??= []).push(entry);
  }

  const lines: string[] = [
    '# mero-js',
    '',
    '> The JavaScript client for the Calimero cloud: verifies a node\'s TDX',
    '> attestation, seals every request to it, signs in with a passkey or API',
    '> key, and calls apps; runs in the browser, Node 18+ and edge runtimes.',
    '',
    `Docs site: ${SITE}${BASE}/`,
    '',
  ];

  for (const track of Object.keys(TRACKS)) {
    const entries = (byTrack[track] ?? []).sort(
      (a, b) => (a.data.sidebar?.order ?? 0) - (b.data.sidebar?.order ?? 0),
    );
    if (!entries.length) continue;
    lines.push(`## ${TRACKS[track]}`, '');
    for (const e of entries) {
      const desc = e.data.description ? `: ${e.data.description}` : '';
      lines.push(`- [${e.data.title}](${url(e.id)})${desc}`);
    }
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
