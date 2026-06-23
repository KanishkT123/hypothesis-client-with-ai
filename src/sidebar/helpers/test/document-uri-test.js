import {
  contentFrameUri,
  currentDocumentUri,
  documentUriMatches,
  filterSavedAnnotationsForDocument,
  resolveDocumentUriFromCandidates,
} from '../document-uri';

describe('document-uri', () => {
  it('contentFrameUri prefers mainFrame over defaultContentFrame', () => {
    const store = {
      mainFrame: sinon.stub().returns({ uri: 'http://main.com' }),
      defaultContentFrame: sinon.stub().returns({ uri: 'http://default.com' }),
    };
    assert.equal(contentFrameUri(store), 'http://main.com');
  });

  it('contentFrameUri falls back to defaultContentFrame when mainFrame is null', () => {
    const store = {
      mainFrame: sinon.stub().returns(null),
      defaultContentFrame: sinon.stub().returns({ uri: 'http://default.com' }),
    };
    assert.equal(contentFrameUri(store), 'http://default.com');
  });

  it('currentDocumentUri prefers mainFrame uri over searchUris', () => {
    const store = {
      mainFrame: sinon.stub().returns({ uri: 'http://main.com' }),
      defaultContentFrame: sinon.stub().returns(null),
      searchUris: sinon.stub().returns(['http://search.com']),
    };
    assert.equal(currentDocumentUri(store), 'http://main.com');
  });

  it('currentDocumentUri prefers HTTP(S) over URN in searchUris', () => {
    const store = {
      mainFrame: sinon.stub().returns(null),
      defaultContentFrame: sinon.stub().returns(null),
      searchUris: sinon
        .stub()
        .returns(['urn:x-pdf:abc', 'https://example.com/paper.pdf']),
    };
    assert.equal(currentDocumentUri(store), 'https://example.com/paper.pdf');
  });

  it('resolveDocumentUriFromCandidates applies HTTP-first fallback to candidates', () => {
    const store = {
      mainFrame: sinon.stub().returns(null),
      defaultContentFrame: sinon.stub().returns(null),
      searchUris: sinon.stub().returns([]),
    };
    assert.equal(
      resolveDocumentUriFromCandidates(store, [
        'urn:x-pdf:abc',
        'https://example.com/paper.pdf',
      ]),
      'https://example.com/paper.pdf',
    );
  });

  it('documentUriMatches accepts strict equality', () => {
    assert.isTrue(
      documentUriMatches('https://example.com', 'https://example.com', []),
    );
  });

  it('documentUriMatches accepts URN and HTTPS in the same alias set', () => {
    const aliases = ['urn:x-pdf:abc', 'https://example.com/paper.pdf'];
    assert.isTrue(
      documentUriMatches('urn:x-pdf:abc', 'https://example.com/paper.pdf', aliases),
    );
  });

  it('documentUriMatches rejects when canonicalUri is null', () => {
    assert.isFalse(documentUriMatches('https://example.com', null, []));
  });

  it('filterSavedAnnotationsForDocument filters by group and URI aliases', () => {
    const aliases = ['urn:x-pdf:abc', 'https://example.com/paper.pdf'];
    const annotations = [
      { id: 'a1', group: 'group-a', uri: 'urn:x-pdf:abc' },
      { id: 'a2', group: 'group-a', uri: 'http://other.com' },
      { id: 'a3', group: 'other-group', uri: 'urn:x-pdf:abc' },
    ];
    const result = filterSavedAnnotationsForDocument(
      annotations,
      'group-a',
      aliases,
    );
    assert.deepEqual(result.map(a => a.id), ['a1']);
  });
});
