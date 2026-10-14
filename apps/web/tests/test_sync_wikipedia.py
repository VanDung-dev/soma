import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from io import BytesIO

spec = importlib.util.spec_from_file_location('sync_wikipedia', Path(__file__).resolve().parents[1] / 'scripts/sync-wikipedia.py')
wiki = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wiki)


class FakeAPI:
    def __init__(self, revision=7, fragment=''):
        self.revision, self.fragment, self.calls = revision, fragment, []
        self.page = {'pageid': 10, 'ns': 0, 'title': 'Femur', 'canonicalurl': 'https://en.wikipedia.org/wiki/Femur',
                     'revisions': [{'revid': revision, 'timestamp': '2026-10-01T00:00:00Z'}]}
        self.parsed = {'pageid': 10, 'revid': revision, 'title': 'Femur', 'text': '<p>The femur is a thigh bone.</p>',
                       'sections': [{'anchor': 'Structure', 'index': '1'}]}

    def __call__(self, **params):
        self.calls.append(params)
        if params['action'] == 'query':
            query = {'pages': [self.page], 'rightsinfo': {'text': 'CC BY-SA 4.0', 'url': 'https://creativecommons.org/licenses/by-sa/4.0/'}}
            if self.fragment:
                query['redirects'] = [{'from': 'Old title', 'to': 'Femur', 'tofragment': self.fragment}]
            return {'query': query}
        if 'section' in params:
            return {'parse': {**self.parsed, 'text': '<h2>Structure</h2><p>Section content.</p>'}}
        return {'parse': self.parsed}


class WikipediaTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = wiki.open_database(Path(self.directory.name) / 'content.sqlite3')

    def tearDown(self):
        self.db.close()
        self.directory.cleanup()

    def test_body_projection_keeps_prose_and_tables_without_boilerplate(self):
        html = '''<div class="mw-parser-output"><div class="hatnote">Unrelated topic.</div>
          <table class="infobox"><tr><td>Sidebar<img src="image"></td></tr></table>
          <p>A <b>bone</b>.<sup class="reference">[1]</sup></p>
          <h2>Structure<span class="mw-editsection">Edit</span></h2><p>First part.</p>
          <table><tr><td>Origin</td><td>Pelvis</td></tr></table>
          <h2>References</h2><ol><li>Citation</li></ol><h3>Notes</h3><p>Footnote</p>
          <h2>Function</h2><p>Second part.</p><script>danger()</script></div>'''
        text = wiki.article_text(html)
        self.assertIn('A bone.', text)
        self.assertIn('Origin | Pelvis', text)
        self.assertIn('Second part.', text)
        for omitted in ['Unrelated', 'Sidebar', '[1]', 'Edit', 'Citation', 'Footnote', 'danger()']:
            self.assertNotIn(omitted, text)

    def test_rejects_non_article_links_and_empty_projection(self):
        for url in ['https://example.com/wiki/Femur', 'https://en.wikipedia.org.evil/wiki/Femur',
                    'https://user@en.wikipedia.org/wiki/Femur', 'https://en.wikipedia.org/wiki/Special:Search',
                    'http://en.wikipedia.org/wiki/Femur']:
            with self.assertRaises(ValueError):
                wiki.wikipedia_link(url)
        with self.assertRaises(ValueError):
            wiki.article_text('<script>only scripts</script>')
        self.assertEqual(wiki.wikipedia_link('https://en.wikipedia.org/wiki/Chorda_tympani#Structure'), ('Chorda tympani', 'Structure'))

    def test_revision_pinning_cache_and_pending_review(self):
        api = FakeAPI()
        first = wiki.sync_definition(self.db, api, 'Femur', 'https://en.wikipedia.org/wiki/Femur')
        self.assertFalse(first['cached'])
        self.assertEqual(api.calls[1]['oldid'], 7)
        row = self.db.execute('SELECT * FROM article_snapshots').fetchone()
        self.assertEqual(row['body_text'], 'The femur is a thigh bone.')
        self.assertEqual(row['revision_url'], 'https://en.wikipedia.org/w/index.php?oldid=7')
        self.db.execute("UPDATE definition_sources SET review_status='approved'")
        self.db.commit()
        second = wiki.sync_definition(self.db, api, 'Femur', 'https://en.wikipedia.org/wiki/Femur')
        self.assertTrue(second['cached'])
        self.assertEqual(len(api.calls), 3)
        self.assertEqual(self.db.execute('SELECT review_status FROM definition_sources').fetchone()[0], 'approved')
        wiki.sync_definition(self.db, FakeAPI(8), 'Femur', 'https://en.wikipedia.org/wiki/Femur')
        self.assertEqual(self.db.execute('SELECT count(*) FROM article_snapshots').fetchone()[0], 2)
        self.assertEqual(self.db.execute('SELECT review_status FROM definition_sources').fetchone()[0], 'pending')

    def test_wrong_revision_does_not_replace_existing_mapping(self):
        wiki.sync_definition(self.db, FakeAPI(), 'Femur', 'https://en.wikipedia.org/wiki/Femur')
        api = FakeAPI(8)
        api.parsed['revid'] = 9
        with self.assertRaises(ValueError):
            wiki.sync_definition(self.db, api, 'Femur', 'https://en.wikipedia.org/wiki/Femur')
        self.assertEqual(self.db.execute('SELECT revision_id FROM definition_sources').fetchone()[0], 7)
        self.assertEqual(self.db.execute('SELECT count(*) FROM article_snapshots').fetchone()[0], 1)

    def test_missing_and_disambiguation_pages_are_not_saved(self):
        for field in ['missing', 'disambiguation']:
            api = FakeAPI()
            if field == 'missing':
                api.page['missing'] = True
            else:
                api.page['pageprops'] = {'disambiguation': ''}
            with self.assertRaises(ValueError):
                wiki.sync_definition(self.db, api, 'Femur', 'https://en.wikipedia.org/wiki/Femur')
        self.assertEqual(self.db.execute('SELECT count(*) FROM article_snapshots').fetchone()[0], 0)

    def test_fragment_and_redirect_fragment_use_only_requested_section(self):
        for url, api in [('https://en.wikipedia.org/wiki/Femur#Structure', FakeAPI()),
                         ('https://en.wikipedia.org/wiki/Old_title', FakeAPI(8, fragment='Structure'))]:
            wiki.sync_definition(self.db, api, 'Part of femur', url)
            row = self.db.execute("SELECT * FROM article_snapshots WHERE section_anchor='Structure' AND revision_id=?", (api.revision,)).fetchone()
            self.assertEqual(row['body_text'], 'Structure\n\nSection content.')
            self.assertEqual(api.calls[2]['section'], '1')

    def test_missing_section_refuses_whole_article_fallback(self):
        with self.assertRaises(ValueError):
            wiki.sync_definition(self.db, FakeAPI(), 'Part', 'https://en.wikipedia.org/wiki/Femur#Not_a_section')
        self.assertEqual(self.db.execute('SELECT count(*) FROM article_snapshots').fetchone()[0], 0)

    def test_corrupt_cache_is_rejected(self):
        wiki.sync_definition(self.db, FakeAPI(), 'Femur', 'https://en.wikipedia.org/wiki/Femur')
        self.db.execute("UPDATE article_snapshots SET body_text='changed'")
        self.db.commit()
        with self.assertRaises(ValueError):
            wiki.sync_definition(self.db, FakeAPI(), 'Femur', 'https://en.wikipedia.org/wiki/Femur')

    def test_api_errors_stop_without_retry_requests(self):
        api = wiki.WikipediaAPI()
        with patch.object(wiki.urllib.request, 'urlopen', return_value=BytesIO(json.dumps({'error': {'code': 'maxlag'}}).encode())) as request:
            with self.assertRaises(RuntimeError):
                api(action='query')
            self.assertEqual(request.call_count, 1)


if __name__ == '__main__':
    unittest.main()
