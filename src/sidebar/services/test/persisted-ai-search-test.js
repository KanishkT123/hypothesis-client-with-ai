import { createStore } from '../../store/create-store';
import { sidebarPanelsModule } from '../../store/modules/sidebar-panels';
import {
  parseExperimentLogState,
  EXPERIMENT_LOG_STORAGE_KEY,
} from '../experiment-log';
import {
  AI_SEARCH_STORAGE_KEY,
  parseAISearchPersisted,
  PersistedAISearchService,
} from '../persisted-ai-search';

describe('parseAISearchPersisted', () => {
  it('returns null for non-objects', () => {
    assert.isNull(parseAISearchPersisted(null));
    assert.isNull(parseAISearchPersisted('x'));
  });

  it('returns null when revision is missing or not a non-negative integer', () => {
    assert.isNull(
      parseAISearchPersisted({
        rows: [],
        schemaTagColors: {},
      }),
    );
    assert.isNull(
      parseAISearchPersisted({
        revision: 1.5,
        rows: [],
        schemaTagColors: {},
      }),
    );
    assert.isNull(
      parseAISearchPersisted({
        revision: -1,
        rows: [],
        schemaTagColors: {},
      }),
    );
  });

  it('returns null when rows or schemaTagColors are invalid', () => {
    assert.isNull(
      parseAISearchPersisted({
        revision: 0,
        rows: 'nope',
        schemaTagColors: {},
      }),
    );
    assert.isNull(
      parseAISearchPersisted({
        revision: 0,
        rows: [],
        schemaTagColors: [],
      }),
    );
  });

  it('accepts a valid persisted envelope', () => {
    const aiSearch = {
      rows: [
        {
          id: '1',
          schemaTag: 't',
          query: 'q',
          annotationIds: ['a'],
        },
      ],
      schemaTagColors: { t: 'rgba(0,0,0,0.38)' },
    };
    assert.deepEqual(parseAISearchPersisted({ revision: 2, ...aiSearch }), {
      revision: 2,
      aiSearch,
    });
  });

  it('accepts rows with hidden true and omits hidden when false', () => {
    const withHidden = {
      rows: [
        {
          id: '1',
          schemaTag: 't',
          query: 'q',
          annotationIds: ['a'],
          hidden: true,
        },
      ],
      schemaTagColors: {},
    };
    assert.deepEqual(parseAISearchPersisted({ revision: 0, ...withHidden }), {
      revision: 0,
      aiSearch: withHidden,
    });

    const withHiddenFalse = {
      rows: [
        {
          id: '1',
          schemaTag: 't',
          query: 'q',
          annotationIds: ['a'],
          hidden: false,
        },
      ],
      schemaTagColors: {},
    };
    assert.deepEqual(
      parseAISearchPersisted({ revision: 1, ...withHiddenFalse }),
      {
        revision: 1,
        aiSearch: {
          rows: [
            {
              id: '1',
              schemaTag: 't',
              query: 'q',
              annotationIds: ['a'],
            },
          ],
          schemaTagColors: {},
        },
      },
    );
  });

  it('returns null when hidden is not a boolean', () => {
    assert.isNull(
      parseAISearchPersisted({
        revision: 0,
        rows: [
          {
            id: '1',
            schemaTag: 't',
            query: 'q',
            annotationIds: [],
            hidden: 'yes',
          },
        ],
        schemaTagColors: {},
      }),
    );
  });
});

describe('parseExperimentLogState', () => {
  it('returns null for non-objects or wrong version', () => {
    assert.isNull(parseExperimentLogState(null));
    assert.isNull(parseExperimentLogState({ version: 2, events: [] }));
  });

  it('returns null when events are invalid', () => {
    assert.isNull(parseExperimentLogState({ version: 1, events: {} }));
  });

  it('accepts a valid flat experiment log', () => {
    const log = {
      version: 1,
      events: [
        {
          type: 'search',
          timestamp: '2020-01-01T00:00:00.000Z',
          documentUri: 'http://d',
          searchRowId: 'r',
          query: 'q',
          schemaTag: 't',
          annotationIdsCreated: [],
          quoteTexts: [],
        },
      ],
    };
    assert.deepEqual(parseExperimentLogState(log), log);
  });

});

describe('PersistedAISearchService', () => {
  let fakeLocalStorage;
  let store;
  let fakeWindow;
  let fakeToastMessenger;
  /** @type {Record<string, Function[]>} */
  let listeners;

  function triggerStorage(key, newValue) {
    const storageEvent = new Event('storage');
    storageEvent.key = key;
    storageEvent.newValue = newValue;
    (listeners.storage || []).forEach(fn => fn(storageEvent));
  }

  beforeEach(() => {
    listeners = {};
    fakeToastMessenger = {
      error: sinon.stub(),
      warning: sinon.stub(),
    };
    fakeWindow = {
      document: {
        visibilityState: 'visible',
        addEventListener: sinon.spy((type, fn) => {
          listeners[`doc:${type}`] = listeners[`doc:${type}`] || [];
          listeners[`doc:${type}`].push(fn);
        }),
      },
      addEventListener: sinon.spy((type, fn) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      }),
    };

    store = createStore([sidebarPanelsModule]);

    fakeLocalStorage = {
      getObject: sinon.stub(),
      setObject: sinon.stub(),
      removeItem: sinon.stub(),
    };
  });

  function createService() {
    return new PersistedAISearchService(
      fakeLocalStorage,
      store,
      fakeWindow,
      fakeToastMessenger,
    );
  }

  describe('#init', () => {
    it('hydrates from localStorage when data is valid', () => {
      const aiSearch = {
        rows: [
          {
            id: 'r1',
            schemaTag: 'methods',
            query: 'q1',
            annotationIds: ['a1'],
          },
        ],
        schemaTagColors: { methods: 'rgba(1,2,3,0.38)' },
      };
      const persisted = { revision: 4, ...aiSearch };
      fakeLocalStorage.getObject
        .withArgs(AI_SEARCH_STORAGE_KEY)
        .returns(persisted);

      createService().init();

      assert.deepEqual(store.getState().sidebarPanels.aiSearch, aiSearch);
    });

    it('does not hydrate when stored data is invalid', () => {
      fakeLocalStorage.getObject.withArgs(AI_SEARCH_STORAGE_KEY).returns({
        revision: 0,
        rows: 'bad',
        schemaTagColors: {},
      });

      createService().init();

      assert.deepEqual(store.getState().sidebarPanels.aiSearch.rows, []);
    });

    it('persists when aiSearch changes after init', () => {
      fakeLocalStorage.getObject.withArgs(AI_SEARCH_STORAGE_KEY).returns(null);
      createService().init();

      store.addAISearchRow({
        id: 'r1',
        schemaTag: 't',
        query: 'q',
        annotationIds: [],
      });

      assert.calledWith(
        fakeLocalStorage.setObject,
        AI_SEARCH_STORAGE_KEY,
        {
          revision: 1,
          ...store.getState().sidebarPanels.aiSearch,
        },
      );
    });

    it('registers a storage listener', () => {
      fakeLocalStorage.getObject.returns(null);
      createService().init();

      assert.calledWith(fakeWindow.addEventListener, 'storage', sinon.match.func);
    });

    it('hydrates experiment log from localStorage when data is valid', () => {
      fakeLocalStorage.getObject.withArgs(AI_SEARCH_STORAGE_KEY).returns(null);
      const expLog = {
        version: 1,
        events: [
          {
            type: 'search',
            timestamp: '2020-01-01T00:00:00.000Z',
            documentUri: 'http://d',
            searchRowId: 'r',
            query: 'q',
            schemaTag: 't',
            annotationIdsCreated: [],
            quoteTexts: [],
          },
        ],
      };
      fakeLocalStorage.getObject.withArgs(EXPERIMENT_LOG_STORAGE_KEY).returns(expLog);

      createService().init();

      assert.deepEqual(store.getState().sidebarPanels.experimentLog, expLog);
    });

    it('persists when experimentLog changes after init', () => {
      fakeLocalStorage.getObject.returns(null);
      createService().init();

      const nextLog = {
        version: 1,
        events: [
          {
            type: 'search',
            timestamp: '2020-01-01T00:00:00.000Z',
            documentUri: 'http://d',
            searchRowId: 'r',
            query: 'q',
            schemaTag: 't',
            annotationIdsCreated: [],
            quoteTexts: [],
          },
        ],
      };
      store.setExperimentLog(nextLog);

      assert.calledWith(
        fakeLocalStorage.setObject,
        EXPERIMENT_LOG_STORAGE_KEY,
        nextLog,
      );
    });

    it('surfaces QuotaExceededError when persisting experiment log', () => {
      fakeLocalStorage.getObject.returns(null);
      fakeLocalStorage.setObject.callsFake(key => {
        if (key === EXPERIMENT_LOG_STORAGE_KEY) {
          const err = new Error('Simulated quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
      });

      createService().init();

      store.setExperimentLog({
        version: 1,
        events: [
          {
            type: 'search',
            timestamp: '2020-01-01T00:00:00.000Z',
            documentUri: 'http://d',
            searchRowId: 'r',
            query: 'q',
            schemaTag: 't',
            annotationIdsCreated: [],
            quoteTexts: [],
          },
        ],
      });

      assert.calledWith(
        fakeToastMessenger.error,
        'Could not save the experiment log: storage is full. Download or clear the log.',
      );
    });
  });

  describe('when another tab updates storage', () => {
    it('hydrates from storage event payload', () => {
      fakeLocalStorage.getObject.withArgs(AI_SEARCH_STORAGE_KEY).returns(null);

      createService().init();

      const aiSearch = {
        rows: [
          {
            id: 'x',
            schemaTag: 'remote',
            query: 'rq',
            annotationIds: [],
          },
        ],
        schemaTagColors: { remote: 'rgba(9,9,9,0.38)' },
      };
      const next = { revision: 1, ...aiSearch };

      triggerStorage(
        AI_SEARCH_STORAGE_KEY,
        JSON.stringify(next),
      );

      assert.deepEqual(store.getState().sidebarPanels.aiSearch, aiSearch);
    });

    it('hydrates experiment log from storage event payload', () => {
      fakeLocalStorage.getObject.returns(null);

      createService().init();

      const next = {
        version: 1,
        events: [
          {
            type: 'rerun-search',
            timestamp: '2020-01-02T00:00:00.000Z',
            documentUri: 'http://d',
            searchRowId: 'r',
            query: 'q',
            schemaTag: 't',
          },
        ],
      };

      triggerStorage(EXPERIMENT_LOG_STORAGE_KEY, JSON.stringify(next));

      assert.deepEqual(store.getState().sidebarPanels.experimentLog, next);
    });

    it('does not hydrate when payload matches current state', () => {
      const initial = {
        revision: 0,
        rows: [],
        schemaTagColors: {},
      };
      fakeLocalStorage.getObject.returns(initial);

      createService().init();

      sinon.spy(store, 'hydrateAISearch');

      triggerStorage(
        AI_SEARCH_STORAGE_KEY,
        JSON.stringify(initial),
      );

      assert.notCalled(store.hydrateAISearch);
    });

    it('hydrates empty state when key is removed', () => {
      const persisted = {
        revision: 1,
        rows: [
          {
            id: 'r1',
            schemaTag: 't',
            query: 'q',
            annotationIds: [],
          },
        ],
        schemaTagColors: { t: 'rgba(1,1,1,0.38)' },
      };
      fakeLocalStorage.getObject.returns(persisted);

      createService().init();

      triggerStorage(AI_SEARCH_STORAGE_KEY, null);

      assert.deepEqual(store.getState().sidebarPanels.aiSearch, {
        rows: [],
        schemaTagColors: {},
      });
    });

    it('does not hydrate when storage revision is older than local', () => {
      fakeLocalStorage.getObject.withArgs(AI_SEARCH_STORAGE_KEY).returns(null);

      createService().init();

      store.addAISearchRow({
        id: 'r1',
        schemaTag: 't',
        query: 'q',
        annotationIds: [],
      });

      sinon.spy(store, 'hydrateAISearch');

      const stale = {
        revision: 0,
        rows: [
          {
            id: 'stale',
            schemaTag: 'x',
            query: 'y',
            annotationIds: [],
          },
        ],
        schemaTagColors: {},
      };

      triggerStorage(AI_SEARCH_STORAGE_KEY, JSON.stringify(stale));

      assert.notCalled(store.hydrateAISearch);
      assert.equal(store.getState().sidebarPanels.aiSearch.rows[0].id, 'r1');
    });

    it('hydrates when storage revision is newer than local', () => {
      fakeLocalStorage.getObject.withArgs(AI_SEARCH_STORAGE_KEY).returns(null);

      createService().init();

      store.addAISearchRow({
        id: 'r1',
        schemaTag: 't',
        query: 'q',
        annotationIds: [],
      });

      const remote = {
        revision: 5,
        rows: [
          {
            id: 'remote',
            schemaTag: 'a',
            query: 'b',
            annotationIds: ['z'],
          },
        ],
        schemaTagColors: { a: 'rgba(1,1,1,0.38)' },
      };

      triggerStorage(
        AI_SEARCH_STORAGE_KEY,
        JSON.stringify(remote),
      );

      assert.deepEqual(store.getState().sidebarPanels.aiSearch, {
        rows: remote.rows,
        schemaTagColors: remote.schemaTagColors,
      });
    });

    it('hydrates empty experiment log when key is removed', () => {
      const persisted = {
        version: 1,
        events: [
          {
            type: 'search',
            timestamp: '2020-01-01T00:00:00.000Z',
            documentUri: 'http://d',
            searchRowId: 'r',
            query: 'q',
            schemaTag: 't',
            annotationIdsCreated: [],
            quoteTexts: [],
          },
        ],
      };
      fakeLocalStorage.getObject.callsFake(key => {
        if (key === EXPERIMENT_LOG_STORAGE_KEY) {
          return persisted;
        }
        return null;
      });

      createService().init();

      triggerStorage(EXPERIMENT_LOG_STORAGE_KEY, null);

      assert.deepEqual(store.getState().sidebarPanels.experimentLog, {
        version: 1,
        events: [],
      });
    });
  });
});
