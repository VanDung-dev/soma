function htmlAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

export function wikipediaPage(html, source, frameTemplate) {
  const base = new URL(source); base.searchParams.delete('useskin'); base.hash = '';
  const frame = frameTemplate.replace('{{source}}', () => htmlAttribute(source.href))
    .replace('{{base}}', () => htmlAttribute(base.href));
  return html.replace(/<head(?:\s[^>]*)?>/i, match => match + frame);
}
