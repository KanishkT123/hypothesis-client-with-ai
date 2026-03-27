import * as fixtures from '../../test/annotation-fixtures';

import {
  buildCandidateRows,
  buildClaudeAISearchUserMessage,
  collectTagQueryQuoteRows,
  dedupeTagQueryRows,
} from '../claude-ai-search-user-message';

describe('sidebar/helpers/claude-ai-search-user-message', () => {
  const pdf = 'http://example.com/paper.pdf';

  function textQuoteAnn(props) {
    const {
      id,
      uri = pdf,
      tags = [],
      text = '',
      exact = 'verbatim quote',
      references = [],
    } = props;
    return {
      ...fixtures.defaultAnnotation(),
      id,
      uri,
      tags,
      text,
      references,
      target: [
        {
          source: uri,
          selector: [{ type: 'TextQuoteSelector', exact }],
        },
      ],
    };
  }

  describe('buildClaudeAISearchUserMessage', () => {
    it('uses tag+query template when schemaTag is non-empty', () => {
      const out = buildClaudeAISearchUserMessage({
        rows: [{ tag: 't', query: 'q1', quote: 'v' }],
        schemaTag: 'schema',
        searchQuery: 'find this',
      });
      assert.include(
        out,
        'What retrieved verbatim quotes from the document would go with the tag "schema" and the query "find this"?',
      );
    });

    it('uses New query template when schemaTag is empty', () => {
      const out = buildClaudeAISearchUserMessage({
        rows: [],
        schemaTag: '',
        searchQuery: 'only the search',
      });
      assert.include(out, 'New query: only the search.');
    });

    it('renders empty tag and query as blank fields', () => {
      const out = buildClaudeAISearchUserMessage({
        rows: [{ tag: '', query: '', quote: 'x' }],
        schemaTag: 's',
        searchQuery: 'q',
      });
      assert.include(out, 'tag: ');
      assert.include(out, 'query: ');
      assert.include(out, 'quote: x');
    });
  });

  describe('buildCandidateRows', () => {
    it('includes Set A on matching URI with quote', () => {
      const rows = buildCandidateRows(
        [
          textQuoteAnn({
            id: 'a1',
            tags: ['schema', 'ai-user-approved'],
            text: 'ai query',
          }),
        ],
        pdf,
      );
      assert.lengthOf(rows, 1);
      assert.equal(rows[0].set, 'A');
      assert.equal(rows[0].tag, 'schema');
      assert.equal(rows[0].query, 'ai query');
    });

    it('includes Set B when not ai-tagged', () => {
      const rows = buildCandidateRows(
        [textQuoteAnn({ id: 'b1', tags: ['foo'], text: 'note' })],
        pdf,
      );
      assert.lengthOf(rows, 1);
      assert.equal(rows[0].set, 'B');
    });

    it('excludes wrong URI', () => {
      const rows = buildCandidateRows(
        [textQuoteAnn({ id: 'x', uri: 'http://other.com/x.pdf' })],
        pdf,
      );
      assert.lengthOf(rows, 0);
    });

    it('excludes replies', () => {
      const rows = buildCandidateRows(
        [
          textQuoteAnn({
            id: 'r1',
            tags: ['x'],
            text: 'reply',
            references: ['parent'],
          }),
        ],
        pdf,
      );
      assert.lengthOf(rows, 0);
    });

    it('excludes ai-pending', () => {
      const rows = buildCandidateRows(
        [
          textQuoteAnn({
            id: 'p1',
            tags: ['ai-pending'],
            text: 'x',
          }),
        ],
        pdf,
      );
      assert.lengthOf(rows, 0);
    });

    it('includes tagged highlight with no body text', () => {
      const rows = buildCandidateRows(
        [
          textQuoteAnn({
            id: 'h1',
            tags: ['marked'],
            text: '',
          }),
        ],
        pdf,
      );
      assert.lengthOf(rows, 1);
      assert.equal(rows[0].query, '');
    });
  });

  describe('dedupeTagQuoteRows', () => {
    it('merges A+B on same tag+quote, keeps B, deletes A', async () => {
      const del = sinon.stub().resolves();
      const svc = { delete: del };
      const a = textQuoteAnn({
        id: 'id-a',
        tags: ['t', 'ai-user-approved'],
        text: 'q1',
        exact: 'same',
      });
      const b = textQuoteAnn({
        id: 'id-b',
        tags: ['t'],
        text: 'q2',
        exact: 'same',
      });
      const candidates = buildCandidateRows([a, b], pdf);
      const out = await dedupeTagQueryRows(candidates, svc);
      assert.lengthOf(out, 1);
      assert.equal(out[0].annotation.id, 'id-b');
      assert.calledOnce(del);
      assert.calledWith(del, sinon.match({ id: 'id-a' }));
    });

    it('merges A+A and deletes one A', async () => {
      const del = sinon.stub().resolves();
      const svc = { delete: del };
      const a1 = textQuoteAnn({
        id: 'a1',
        tags: ['t', 'ai-user-approved'],
        text: 'q',
        exact: 'e',
      });
      const a2 = textQuoteAnn({
        id: 'a2',
        tags: ['t', 'ai-user-approved'],
        text: 'q2',
        exact: 'e',
      });
      const candidates = buildCandidateRows([a1, a2], pdf);
      const out = await dedupeTagQuoteRows(candidates, svc);
      assert.lengthOf(out, 1);
      assert.equal(out[0].annotation.id, 'a1');
      assert.calledOnce(del);
      assert.calledWith(del, sinon.match({ id: 'a2' }));
    });

    it('keeps two B rows when tag+quote match but query differs', async () => {
      const del = sinon.stub().resolves();
      const svc = { delete: del };
      const b1 = textQuoteAnn({
        id: 'b1',
        tags: ['t'],
        text: 'q1',
        exact: 'e',
      });
      const b2 = textQuoteAnn({
        id: 'b2',
        tags: ['t'],
        text: 'q2',
        exact: 'e',
      });
      const candidates = buildCandidateRows([b1, b2], pdf);
      const out = await dedupeTagQuoteRows(candidates, svc);
      assert.lengthOf(out, 2);
      assert.notCalled(del);
    });

    it('merges B+B on same tag+quote+query and deletes one B', async () => {
      const del = sinon.stub().resolves();
      const svc = { delete: del };
      const b1 = textQuoteAnn({
        id: 'b1',
        tags: ['t'],
        text: 'sameq',
        exact: 'e',
      });
      const b2 = textQuoteAnn({
        id: 'b2',
        tags: ['t'],
        text: 'sameq',
        exact: 'e',
      });
      const candidates = buildCandidateRows([b1, b2], pdf);
      const out = await dedupeTagQuoteRows(candidates, svc);
      assert.lengthOf(out, 1);
      assert.equal(out[0].annotation.id, 'b1');
      assert.calledOnce(del);
      assert.calledWith(del, sinon.match({ id: 'b2' }));
    });
  });

  describe('collectTagQueryQuoteRows', () => {
    it('returns rows and logs timing', async () => {
      sinon.stub(console, 'log');
      const del = sinon.stub().resolves();
      const ann = textQuoteAnn({
        id: 'c1',
        tags: ['z', 'ai-user-approved'],
        text: 'qq',
      });
      const rows = await collectTagQueryQuoteRows([ann], pdf, {
        delete: del,
      });
      assert.lengthOf(rows, 1);
      assert.equal(rows[0].tag, 'z');
      const logCall = console.log.getCall(console.log.callCount - 1);
      assert.equal(logCall.args[0], '[AISearch] example triples construction');
      assert.property(logCall.args[1], 'elapsedMs');
      assert.isNumber(logCall.args[1].elapsedMs);
    });
  });
});
