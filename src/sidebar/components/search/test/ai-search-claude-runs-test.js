import {
  abortAllClaudeRuns,
  getClaudeRunsSnapshot,
  registerClaudeRun,
  subscribeClaudeRuns,
} from '../ai-search-claude-runs';

describe('ai-search-claude-runs', () => {
  afterEach(() => {
    abortAllClaudeRuns();
  });

  it('registerClaudeRun adds an active run and finish removes it', () => {
    assert.equal(getClaudeRunsSnapshot().activeClaudeCount, 0);

    const { signal, finish } = registerClaudeRun();
    assert.equal(getClaudeRunsSnapshot().activeClaudeCount, 1);
    assert.equal(signal.aborted, false);

    finish();
    assert.equal(getClaudeRunsSnapshot().activeClaudeCount, 0);
  });

  it('abortAllClaudeRuns aborts the signal and clears runs', () => {
    const { signal, finish } = registerClaudeRun();
    assert.equal(getClaudeRunsSnapshot().activeClaudeCount, 1);

    abortAllClaudeRuns();

    assert.equal(signal.aborted, true);
    assert.equal(getClaudeRunsSnapshot().activeClaudeCount, 0);
    finish(); // no-op if already cleared
  });

  it('subscribeClaudeRuns notifies listeners when runs change', () => {
    const spy = sinon.spy();
    const unsubscribe = subscribeClaudeRuns(spy);

    const { finish } = registerClaudeRun();
    assert.called(spy);

    spy.resetHistory();
    finish();
    assert.called(spy);

    unsubscribe();
  });
});
