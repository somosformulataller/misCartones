import { ReactNode } from 'react';

// Convierte las URLs escritas en un mensaje de chat en enlaces
// tocables (se abren en pestaña nueva). Reconoce http(s):// y www.;
// la puntuación pegada al final (punto, coma, paréntesis…) queda
// fuera del enlace para no romper la dirección.
const URL_RE = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+\.[a-z]{2,}[^\s<>]*)/gi;
const TRAIL_RE = /[).,!?;:\]]+$/;

export default function LinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index;
    let url = match[0];
    const trail = url.match(TRAIL_RE)?.[0] ?? '';
    url = url.slice(0, url.length - trail.length);
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={url.startsWith('www.') ? `https://${url}` : url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {url}
      </a>
    );
    if (trail) parts.push(trail);
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
