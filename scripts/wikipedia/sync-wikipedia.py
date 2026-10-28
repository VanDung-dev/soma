"""Stage revision-pinned Wikipedia references in SQLite; never rewrite model packages."""
import argparse
from contextlib import closing
import hashlib
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = 'https://en.wikipedia.org/w/api.php'
USER_AGENT = 'HumanAtlasContentImporter/0.1 (https://github.com/VanDung-dev/human-atlas-rs)'


class ArticleText(HTMLParser):
    """Project article prose to plain text while keeping source HTML in the snapshot."""
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
    OMIT = {'infobox', 'navbox', 'vertical-navbox', 'hatnote', 'shortdescription', 'mw-editsection', 'reference', 'reflist', 'toc', 'metadata', 'noprint'}
    END_SECTIONS = {'references', 'notes', 'footnotes', 'citations', 'bibliography', 'external links', 'see also', 'further reading'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.parts = [], []
        self.heading, self.heading_level, self.excluded_level = None, 0, 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        omitted = bool(self.stack and self.stack[-1][1]) or tag in {'script', 'style', 'figure'} or bool(set(attrs.get('class', '').split()) & self.OMIT)
        if tag not in self.VOID:
            self.stack.append((tag, omitted))
        if omitted:
            return
        if re.fullmatch(r'h[2-6]', tag):
            self.heading, self.heading_level = [], int(tag[1])
        elif not self.excluded_level and self.heading is None:
            if tag in {'p', 'div', 'li', 'dt', 'dd', 'tr'}:
                self.parts.append('\n\n')
            if tag == 'li':
                self.parts.append('• ')
            elif tag == 'br':
                self.parts.append('\n')
            elif tag in {'td', 'th'}:
                self.parts.append(' | ')

    def handle_data(self, data):
        if self.stack and self.stack[-1][1]:
            return
        if self.heading is not None:
            self.heading.append(data)
        elif not self.excluded_level:
            self.parts.append(data)

    def handle_endtag(self, tag):
        omitted = bool(self.stack and self.stack[-1][1])
        if not omitted and re.fullmatch(r'h[2-6]', tag) and self.heading is not None:
            title = ' '.join(''.join(self.heading).split())
            if self.excluded_level and self.heading_level <= self.excluded_level:
                self.excluded_level = 0
            if title.casefold() in self.END_SECTIONS:
                self.excluded_level = self.heading_level
            if not self.excluded_level:
                self.parts.extend(['\n\n', title, '\n\n'])
            self.heading = None
        elif not omitted and not self.excluded_level and tag in {'p', 'li', 'tr', 'div', 'dl'}:
            self.parts.append('\n\n')
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def text(self):
        return '\n\n'.join(' '.join(part.split()) for part in re.split(r'\n\s*\n', ''.join(self.parts)) if part.strip())


def article_text(html):
    parser = ArticleText()
    parser.feed(html)
    parser.close()
    text = parser.text()
    if not text:
        raise ValueError('Article has no usable body text')
    return text


def wikipedia_link(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc != 'en.wikipedia.org' or not parsed.path.startswith('/wiki/') or parsed.query:
        raise ValueError(f'Not an English Wikipedia article URL: {url}')
    title = urllib.parse.unquote(parsed.path[6:]).replace('_', ' ')
    if not title or ':' in title:
        raise ValueError(f'Article namespace required: {url}')
    return title, urllib.parse.unquote(parsed.fragment).replace(' ', '_')


def reference_links():
    mapping = json.loads((ROOT / 'content/wikipedia-references.json').read_text())
    return {name: {article['url']} for name, article in mapping['articles'].items()}


class WikipediaAPI:
    def __init__(self):
        self.last_request = 0.0

    def __call__(self, **params):
        time.sleep(max(0.0, 1.0 - (time.monotonic() - self.last_request)))
        self.last_request = time.monotonic()
        params.update(format='json', formatversion=2, maxlag=5)
        request = urllib.request.Request(API + '?' + urllib.parse.urlencode(params), headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read(10 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'Wikipedia HTTP {error.code}; Retry-After: {error.headers.get("Retry-After", "not supplied")}. Import stopped.') from error
        if len(body) > 10 * 1024 * 1024:
            raise ValueError('Wikipedia response exceeds 10 MiB')
        data = json.loads(body)
        if 'error' in data:
            raise RuntimeError(f'Wikipedia API error: {data["error"]}. Import stopped.')
        return data


def open_database(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
        CREATE TABLE IF NOT EXISTS article_snapshots (
            page_id INTEGER NOT NULL, revision_id INTEGER NOT NULL, section_anchor TEXT NOT NULL,
            title TEXT NOT NULL, revision_timestamp TEXT NOT NULL, fetched_at TEXT NOT NULL,
            source_url TEXT NOT NULL, revision_url TEXT NOT NULL,
            license_name TEXT NOT NULL, license_url TEXT NOT NULL,
            body_text TEXT NOT NULL, source_html TEXT NOT NULL, sections_json TEXT NOT NULL,
            body_sha256 TEXT NOT NULL,
            PRIMARY KEY (page_id, revision_id, section_anchor)
        );
        CREATE TABLE IF NOT EXISTS definition_sources (
            definition_key TEXT PRIMARY KEY, source_link TEXT NOT NULL,
            page_id INTEGER NOT NULL, revision_id INTEGER NOT NULL, section_anchor TEXT NOT NULL,
            review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending', 'approved')),
            FOREIGN KEY(page_id, revision_id, section_anchor)
                REFERENCES article_snapshots(page_id, revision_id, section_anchor)
        );
    ''')
    return db


def sync_definition(db, api, definition_key, source_link):
    requested_title, anchor = wikipedia_link(source_link)
    result = api(action='query', titles=requested_title, redirects=1, prop='info|revisions|pageprops', inprop='url', rvprop='ids|timestamp', meta='siteinfo', siprop='rightsinfo')
    query = result['query']
    pages = query['pages']
    if len(pages) != 1 or pages[0].get('missing') or pages[0].get('ns') != 0:
        raise ValueError(f'Article missing or invalid: {requested_title}')
    page = pages[0]
    if 'disambiguation' in page.get('pageprops', {}):
        raise ValueError(f'Disambiguation article requires a reviewed mapping: {page["title"]}')
    wikipedia_link(page['canonicalurl'])
    rights = query['rightsinfo']
    if not rights.get('text') or not rights.get('url', '').startswith('https://creativecommons.org/licenses/'):
        raise ValueError('License metadata missing or unsupported')
    revision = page['revisions'][0]
    if not anchor:
        anchor = next((r['tofragment'].replace(' ', '_') for r in reversed(query.get('redirects', [])) if r.get('tofragment')), '')
    identity = (page['pageid'], revision['revid'], anchor)
    cached = db.execute('SELECT * FROM article_snapshots WHERE page_id=? AND revision_id=? AND section_anchor=?', identity).fetchone()
    if cached and hashlib.sha256(cached['body_text'].encode()).hexdigest() != cached['body_sha256']:
        raise ValueError('Cached content checksum mismatch')
    if not cached:
        parsed = api(action='parse', oldid=revision['revid'], prop='text|sections', disableeditsection=1)['parse']
        if parsed['pageid'] != page['pageid'] or parsed['revid'] != revision['revid'] or parsed['title'] != page['title']:
            raise ValueError('Parsed article does not match requested page/revision')
        if anchor:
            sections = [s for s in parsed['sections'] if s.get('anchor') == anchor or s.get('linkAnchor') == anchor]
            if len(sections) != 1:
                raise ValueError(f'Section not found; refusing whole-article fallback: {anchor}')
            parsed = api(action='parse', oldid=revision['revid'], section=sections[0]['index'], prop='text|sections', disableeditsection=1)['parse']
            if parsed['pageid'] != page['pageid'] or parsed['revid'] != revision['revid']:
                raise ValueError('Section revision mismatch')
        text = article_text(parsed['text'])
        now = datetime.now(timezone.utc).isoformat()
        fragment = '#' + urllib.parse.quote(anchor) if anchor else ''
        snapshot = (*identity, page['title'], revision['timestamp'], now, page['canonicalurl'] + fragment,
                    f'https://en.wikipedia.org/w/index.php?oldid={revision["revid"]}' + fragment,
                    rights['text'], rights['url'], text, parsed['text'], json.dumps(parsed['sections'], ensure_ascii=False), hashlib.sha256(text.encode()).hexdigest())
    with db:
        if not cached:
            db.execute('INSERT INTO article_snapshots VALUES (' + ','.join('?' for _ in snapshot) + ')', snapshot)
        db.execute('''INSERT INTO definition_sources(definition_key, source_link, page_id, revision_id, section_anchor)
                      VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(definition_key) DO UPDATE SET
                        source_link=excluded.source_link,
                        review_status=CASE WHEN definition_sources.page_id=excluded.page_id
                          AND definition_sources.revision_id=excluded.revision_id
                          AND definition_sources.section_anchor=excluded.section_anchor
                          THEN definition_sources.review_status ELSE 'pending' END,
                        page_id=excluded.page_id, revision_id=excluded.revision_id, section_anchor=excluded.section_anchor''',
                   (definition_key, source_link, *identity))
    return {'definition_key': definition_key, 'title': page['title'], 'revision_id': revision['revid'], 'section': anchor, 'cached': bool(cached)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('definition_keys', nargs='+', help='Exact structure names from wikipedia-references.json; no automatic search/fuzzy matching')
    parser.add_argument('--database', type=Path, default=ROOT / '.cache/wikipedia/content.sqlite3')
    args = parser.parse_args()
    links = reference_links()
    selected = []
    for key in dict.fromkeys(args.definition_keys):
        candidates = links.get(key, set())
        if len(candidates) != 1:
            parser.error(f'{key}: expected one Wikipedia mapping, found {len(candidates)}; mapping needs review')
        selected.append((key, next(iter(candidates))))
    api = WikipediaAPI()
    with closing(open_database(args.database)) as db:
        for key, link in selected:
            print(json.dumps(sync_definition(db, api, key, link), ensure_ascii=False))
    print(f'Staged {len(selected)} definitions in {args.database}; review required before publication.')


if __name__ == '__main__':
    main()
