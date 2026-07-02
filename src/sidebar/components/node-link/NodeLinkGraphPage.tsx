import { Button, GraphIcon, RefreshIcon } from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import { useEffect, useMemo, useState } from 'preact/hooks';

import type { Annotation, Group } from '../../../types/api';
import {
  buildNodeLinkGraph,
  buildTagGraphLayout,
} from '../../node-link/graph-model';
import type { NodeLinkGraph, TagLayoutNode } from '../../node-link/graph-model';
import { emptyNodeLinkState, tagLegendText } from '../../node-link/graph-state';
import type {
  DescriptiveTag,
  ManualTagEdge,
  NodeLinkSemanticState,
} from '../../node-link/graph-state';
import { withServices } from '../../service-context';
import type { AuthService } from '../../services/auth';
import type { NodeLinkStateService } from '../../services/node-link-state';
import type { SessionService } from '../../services/session';
import type { ToastMessengerService } from '../../services/toast-messenger';
import { useSidebarStore } from '../../store';

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type NodeLinkGraphPageProps = {
  auth: AuthService;
  nodeLinkState: NodeLinkStateService;
  session: SessionService;
  toastMessenger: ToastMessengerService;
};

const NODE_WIDTH = 188;
const NODE_HEIGHT = 62;

function edgeKey(edge: Pick<ManualTagEdge, 'sourceTag' | 'targetTag'>) {
  return `${edge.sourceTag}\n${edge.targetTag}`;
}

function edgeId(edge: ManualTagEdge) {
  return edge.id || edgeKey(edge);
}

function newManualEdgeId() {
  return `manual-edge:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function newDescriptiveTagId() {
  return `descriptive-tag:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function tagOptions(graph: NodeLinkGraph) {
  return graph.tags.map(tag => tag.tag).sort((a, b) => a.localeCompare(b));
}

function routeGroupParam(params: Record<string, string | undefined>) {
  return params.group || params.groupId || '';
}

function groupLabel(group: Group) {
  return group.organization?.name
    ? `${group.name} (${group.organization.name})`
    : group.name;
}

function edgePath(source: TagLayoutNode, target: TagLayoutNode) {
  const sourceX = source.x + NODE_WIDTH / 2;
  const sourceY = source.y;
  const targetX = target.x - NODE_WIDTH / 2;
  const targetY = target.y;
  const distance = Math.max(80, Math.abs(targetX - sourceX));
  const controlOffset = Math.min(180, distance * 0.55);

  return `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${
    targetX - controlOffset
  } ${targetY}, ${targetX} ${targetY}`;
}

function splitTagLines(tag: string) {
  const words = tag.split(/\s+/).filter(Boolean);
  if (words.length <= 1 && tag.length <= 20) {
    return [tag];
  }

  const lines: string[] = [];
  let current = '';
  for (const word of words.length ? words : [tag]) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 20 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === 2) {
      break;
    }
  }
  if (current && lines.length < 2) {
    lines.push(current);
  }

  return lines.map((line, index) =>
    index === 1 && line.length > 22 ? `${line.slice(0, 19)}...` : line,
  );
}

function TagNode({
  node,
  selected,
  muted,
  onSelect,
}: {
  node: TagLayoutNode;
  selected: boolean;
  muted: boolean;
  onSelect: () => void;
}) {
  const lines = splitTagLines(node.tag);

  return (
    <g
      className={classnames('cursor-pointer transition-opacity', {
        'opacity-35': muted,
      })}
      transform={`translate(${node.x - NODE_WIDTH / 2}, ${
        node.y - NODE_HEIGHT / 2
      })`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx="7"
        fill={node.descriptive ? '#475569' : node.color}
        stroke={selected ? '#111827' : 'rgba(255,255,255,.72)'}
        strokeWidth={selected ? 3 : 1.5}
        strokeDasharray={node.descriptive ? '5 4' : undefined}
      />
      <text
        x="14"
        y="19"
        fill="rgba(255,255,255,.78)"
        fontSize="10"
        fontWeight="800"
      >
        TAG
      </text>
      {!node.descriptive && (
        <text
          x={NODE_WIDTH - 18}
          y="20"
          fill="#fff"
          fontSize="12"
          fontWeight="800"
          textAnchor="middle"
        >
          {node.quoteCount}
        </text>
      )}
      {lines.map((line, index) => (
        <text
          key={line}
          x="14"
          y={lines.length === 1 ? 42 : 38 + index * 15}
          fill="#fff"
          fontSize="14"
          fontWeight="760"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function GraphCanvas({
  graph,
  selectedTag,
  onSelectTag,
}: {
  graph: NodeLinkGraph;
  selectedTag: string;
  onSelectTag: (tag: string) => void;
}) {
  const layout = useMemo(() => buildTagGraphLayout(graph), [graph]);
  const nodeByTag = new Map(layout.nodes.map(node => [node.tag, node]));
  const relatedTags = new Set<string>();
  if (selectedTag) {
    relatedTags.add(selectedTag);
    for (const edge of graph.manualEdges) {
      if (edge.sourceTag === selectedTag) {
        relatedTags.add(edge.targetTag);
      } else if (edge.targetTag === selectedTag) {
        relatedTags.add(edge.sourceTag);
      }
    }
  }

  return (
    <div className="min-h-0 overflow-auto rounded border bg-[#f7faf9]">
      <svg
        className="block min-h-full min-w-full"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="Tag relationship graph"
      >
        <rect width={layout.width} height={layout.height} fill="#f7faf9" />
        {graph.manualEdges.map(edge => {
          const source = nodeByTag.get(edge.sourceTag);
          const target = nodeByTag.get(edge.targetTag);
          if (!source || !target) {
            return null;
          }
          const active =
            !selectedTag ||
            edge.sourceTag === selectedTag ||
            edge.targetTag === selectedTag;
          return (
            <path
              key={edge.id || `${edge.sourceTag}:${edge.targetTag}`}
              d={edgePath(source, target)}
              fill="none"
              stroke={active ? '#0f766e' : '#b7c8c4'}
              strokeWidth={active ? 2.8 : 1.5}
              strokeLinecap="round"
              opacity={active ? 0.86 : 0.22}
            />
          );
        })}
        {layout.nodes.map(node => (
          <TagNode
            key={node.id}
            node={node}
            selected={node.tag === selectedTag}
            muted={Boolean(selectedTag) && !relatedTags.has(node.tag)}
            onSelect={() =>
              onSelectTag(node.tag === selectedTag ? '' : node.tag)
            }
          />
        ))}
      </svg>
    </div>
  );
}

function EvidencePanel({
  graph,
  selectedTag,
}: {
  graph: NodeLinkGraph;
  selectedTag: string;
}) {
  const quotes = selectedTag
    ? graph.quotes.filter(quote => quote.tags.includes(selectedTag))
    : [];
  const outgoing = selectedTag
    ? graph.manualEdges.filter(edge => edge.sourceTag === selectedTag)
    : [];
  const incoming = selectedTag
    ? graph.manualEdges.filter(edge => edge.targetTag === selectedTag)
    : [];

  if (!selectedTag) {
    return (
      <p className="text-sm leading-6 text-grey-6">
        Select a tag node to inspect its manual relationships and quote
        evidence.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-color-text">{selectedTag}</h3>
        <p className="text-sm text-grey-6">
          {quotes.length} linked quote{quotes.length === 1 ? '' : 's'}
        </p>
      </div>

      <section className="space-y-2">
        <h4 className="text-xs font-bold uppercase text-grey-6">
          Manual relationships
        </h4>
        {[...outgoing, ...incoming].length ? (
          <ul className="space-y-2">
            {[...outgoing, ...incoming].map(edge => (
              <li
                className="rounded border bg-white px-3 py-2 text-sm"
                key={edge.id || `${edge.sourceTag}:${edge.targetTag}`}
              >
                <span className="rounded-full bg-grey-2 px-2 py-0.5 font-medium">
                  {edge.sourceTag}
                </span>{' '}
                <strong>{edge.connectionType}</strong>{' '}
                <span className="rounded-full bg-grey-2 px-2 py-0.5 font-medium">
                  {edge.targetTag}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-grey-6">
            No manual tag-tag relationships involve this tag yet.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-bold uppercase text-grey-6">Quotes</h4>
        {quotes.length ? (
          <ul className="max-h-[46vh] space-y-2 overflow-auto pr-1">
            {quotes.map(quote => (
              <li className="rounded border bg-[#fffaf0] p-3" key={quote.id}>
                <div className="mb-1 text-xs font-bold text-grey-6">
                  {quote.documentLabel}
                </div>
                <blockquote className="text-sm leading-5 text-color-text">
                  {quote.quote}
                </blockquote>
                <a
                  className="mt-2 text-sm font-bold"
                  href={quote.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open source
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-grey-6">
            This tag is descriptive or has no quote selectors in the selected
            group.
          </p>
        )}
      </section>
    </div>
  );
}

function NodeLinkEditor({
  graph,
  selectedTag,
  semanticState,
  onSaveState,
  saveStatus,
  saveMessage,
}: {
  graph: NodeLinkGraph;
  selectedTag: string;
  semanticState: NodeLinkSemanticState;
  onSaveState: (nextState: NodeLinkSemanticState) => void;
  saveStatus: SaveStatus;
  saveMessage: string;
}) {
  const tags = tagOptions(graph);
  const [edgeSource, setEdgeSource] = useState('');
  const [edgeTarget, setEdgeTarget] = useState('');
  const [edgeRelationship, setEdgeRelationship] = useState('');
  const [editingEdgeId, setEditingEdgeId] = useState('');
  const [tagName, setTagName] = useState('');
  const [editingTagId, setEditingTagId] = useState('');
  const [formMessage, setFormMessage] = useState('');

  useEffect(() => {
    if (!edgeSource && selectedTag && tags.includes(selectedTag)) {
      setEdgeSource(selectedTag);
    }
  }, [edgeSource, selectedTag, tags]);

  const resetEdgeForm = () => {
    setEditingEdgeId('');
    setEdgeRelationship('');
    setEdgeTarget('');
    setFormMessage('');
  };

  const resetTagForm = () => {
    setEditingTagId('');
    setTagName('');
    setFormMessage('');
  };

  const editEdge = (edge: ManualTagEdge) => {
    setEditingEdgeId(edgeId(edge));
    setEdgeSource(edge.sourceTag);
    setEdgeRelationship(edge.connectionType);
    setEdgeTarget(edge.targetTag);
    setFormMessage('');
  };

  const saveEdge = () => {
    const sourceTag = edgeSource.trim();
    const targetTag = edgeTarget.trim();
    const connectionType = edgeRelationship.trim();
    if (!sourceTag || !targetTag || !connectionType) {
      setFormMessage('Choose source, relationship, and target.');
      return;
    }
    if (sourceTag === targetTag) {
      setFormMessage('Source and target must be different tags.');
      return;
    }

    const existingDuplicate = semanticState.tagEdges.find(
      edge =>
        edgeKey(edge) === edgeKey({ sourceTag, targetTag }) &&
        edgeId(edge) !== editingEdgeId,
    );
    if (existingDuplicate) {
      setFormMessage('That source-target edge already exists.');
      return;
    }

    const now = new Date().toISOString();
    const nextEdge: ManualTagEdge = {
      id: editingEdgeId || newManualEdgeId(),
      sourceTag,
      targetTag,
      connectionType,
      label: connectionType,
      createdBy: 'human',
      createdFrom: 'manual',
      createdAt: now,
      updatedAt: now,
    };
    const nextEdges = editingEdgeId
      ? semanticState.tagEdges.map(edge =>
          edgeId(edge) === editingEdgeId
            ? {
                ...edge,
                sourceTag,
                targetTag,
                connectionType,
                label: connectionType,
                updatedAt: now,
              }
            : edge,
        )
      : [...semanticState.tagEdges, nextEdge];

    onSaveState({
      ...semanticState,
      tagEdges: nextEdges,
      updatedAt: now,
    });
    resetEdgeForm();
  };

  const deleteEdge = (edge: ManualTagEdge) => {
    const now = new Date().toISOString();
    onSaveState({
      ...semanticState,
      tagEdges: semanticState.tagEdges.filter(
        item => edgeId(item) !== edgeId(edge),
      ),
      updatedAt: now,
    });
    if (editingEdgeId === edgeId(edge)) {
      resetEdgeForm();
    }
  };

  const saveDescriptiveTag = () => {
    const tag = tagName.trim();
    if (!tag) {
      setFormMessage('Enter a descriptive tag.');
      return;
    }

    const currentTag = editingTagId
      ? semanticState.descriptiveTags.find(item => item.id === editingTagId)
      : null;
    const duplicateTag = graph.tags.find(
      item =>
        item.tag.toLocaleLowerCase() === tag.toLocaleLowerCase() &&
        item.tag.toLocaleLowerCase() !== currentTag?.tag.toLocaleLowerCase(),
    );
    const duplicateDescriptiveTag = semanticState.descriptiveTags.find(
      item =>
        item.tag.toLocaleLowerCase() === tag.toLocaleLowerCase() &&
        item.id !== editingTagId,
    );
    if (duplicateTag || duplicateDescriptiveTag) {
      setFormMessage('That tag already exists.');
      return;
    }

    const now = new Date().toISOString();
    let nextTags: DescriptiveTag[];
    let nextEdges = semanticState.tagEdges;
    if (editingTagId) {
      const previous = semanticState.descriptiveTags.find(
        item => item.id === editingTagId,
      );
      nextTags = semanticState.descriptiveTags.map(item =>
        item.id === editingTagId ? { ...item, tag, updatedAt: now } : item,
      );
      if (previous) {
        nextEdges = semanticState.tagEdges.map(edge => ({
          ...edge,
          sourceTag: edge.sourceTag === previous.tag ? tag : edge.sourceTag,
          targetTag: edge.targetTag === previous.tag ? tag : edge.targetTag,
          updatedAt:
            edge.sourceTag === previous.tag || edge.targetTag === previous.tag
              ? now
              : edge.updatedAt,
        }));
      }
    } else {
      nextTags = [
        ...semanticState.descriptiveTags,
        {
          id: newDescriptiveTagId(),
          tag,
          createdAt: now,
          updatedAt: now,
          createdBy: 'human',
        },
      ];
    }

    onSaveState({
      ...semanticState,
      descriptiveTags: nextTags,
      tagEdges: nextEdges,
      updatedAt: now,
    });
    resetTagForm();
  };

  const editDescriptiveTag = (tag: DescriptiveTag) => {
    setEditingTagId(tag.id);
    setTagName(tag.tag);
    setFormMessage('');
  };

  const deleteDescriptiveTag = (tag: DescriptiveTag) => {
    const hasEdges = semanticState.tagEdges.some(
      edge => edge.sourceTag === tag.tag || edge.targetTag === tag.tag,
    );
    if (hasEdges) {
      setFormMessage('Remove this tag from manual edges before deleting it.');
      return;
    }
    onSaveState({
      ...semanticState,
      descriptiveTags: semanticState.descriptiveTags.filter(
        item => item.id !== tag.id,
      ),
      updatedAt: new Date().toISOString(),
    });
    if (editingTagId === tag.id) {
      resetTagForm();
    }
  };

  const exportLegend = () => {
    const blob = new Blob([tagLegendText(semanticState)], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tag-legend-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const canEdit = tags.length > 1;

  return (
    <div className="space-y-5 border-t pt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase text-grey-6">Edit graph</h3>
        <span
          className={classnames('rounded-full px-2 py-0.5 text-xs font-bold', {
            'bg-grey-2 text-grey-6': saveStatus === 'idle',
            'bg-yellow-2 text-yellow-7': saveStatus === 'saving',
            'bg-green-2 text-green-7': saveStatus === 'saved',
            'bg-red-2 text-red-7': saveStatus === 'error',
          })}
        >
          {saveStatus === 'saving'
            ? 'Saving'
            : saveStatus === 'saved'
              ? 'Saved'
              : saveStatus === 'error'
                ? 'Save failed'
                : 'Ready'}
        </span>
      </div>

      {(formMessage || saveMessage) && (
        <p className="rounded border bg-grey-1 px-3 py-2 text-sm text-grey-6">
          {formMessage || saveMessage}
        </p>
      )}

      <section className="space-y-3">
        <h4 className="text-sm font-bold">Manual tag-tag edge</h4>
        <div className="grid gap-2">
          <select
            className="h-9 rounded border bg-white px-2 text-sm"
            value={edgeSource}
            disabled={!canEdit}
            onChange={event =>
              setEdgeSource((event.target as HTMLSelectElement).value)
            }
          >
            <option value="">Source tag</option>
            {tags.map(tag => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
          <input
            className="h-9 rounded border px-2 text-sm"
            value={edgeRelationship}
            disabled={!canEdit}
            placeholder="relationship"
            onInput={event =>
              setEdgeRelationship((event.target as HTMLInputElement).value)
            }
          />
          <select
            className="h-9 rounded border bg-white px-2 text-sm"
            value={edgeTarget}
            disabled={!canEdit}
            onChange={event =>
              setEdgeTarget((event.target as HTMLSelectElement).value)
            }
          >
            <option value="">Target tag</option>
            {tags.map(tag => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={saveEdge}
            disabled={!canEdit || saveStatus === 'saving'}
          >
            {editingEdgeId ? 'Update Edge' : 'Add Edge'}
          </Button>
          {editingEdgeId && <Button onClick={resetEdgeForm}>Cancel</Button>}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-bold">Manual edges</h4>
          <Button
            onClick={exportLegend}
            disabled={!semanticState.tagEdges.length}
            title="Export tag legend text"
          >
            Export
          </Button>
        </div>
        {semanticState.tagEdges.length ? (
          <ul className="max-h-52 space-y-2 overflow-auto pr-1">
            {semanticState.tagEdges.map(edge => (
              <li
                className="rounded border px-3 py-2 text-sm"
                key={edgeId(edge)}
              >
                <div className="leading-6">
                  <span className="rounded-full bg-grey-2 px-2 py-0.5 font-medium">
                    {edge.sourceTag}
                  </span>{' '}
                  <strong>{edge.connectionType}</strong>{' '}
                  <span className="rounded-full bg-grey-2 px-2 py-0.5 font-medium">
                    {edge.targetTag}
                  </span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    className="text-sm font-bold text-brand"
                    type="button"
                    onClick={() => editEdge(edge)}
                  >
                    Edit
                  </button>
                  <button
                    className="text-sm font-bold text-red-6"
                    type="button"
                    onClick={() => deleteEdge(edge)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-grey-6">No manual tag-tag edges yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-bold">Descriptive tag</h4>
        <input
          className="h-9 w-full rounded border px-2 text-sm"
          value={tagName}
          placeholder="New descriptive tag"
          onInput={event =>
            setTagName((event.target as HTMLInputElement).value)
          }
        />
        <div className="flex gap-2">
          <Button
            onClick={saveDescriptiveTag}
            disabled={saveStatus === 'saving'}
          >
            {editingTagId ? 'Update Tag' : 'Add Tag'}
          </Button>
          {editingTagId && <Button onClick={resetTagForm}>Cancel</Button>}
        </div>

        {semanticState.descriptiveTags.length ? (
          <ul className="space-y-2">
            {semanticState.descriptiveTags.map(tag => {
              const hasEdges = semanticState.tagEdges.some(
                edge =>
                  edge.sourceTag === tag.tag || edge.targetTag === tag.tag,
              );
              return (
                <li
                  className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
                  key={tag.id}
                >
                  <span className="font-medium">{tag.tag}</span>
                  <span className="flex gap-2">
                    <button
                      className="text-sm font-bold text-brand"
                      type="button"
                      onClick={() => editDescriptiveTag(tag)}
                    >
                      Edit
                    </button>
                    <button
                      className="text-sm font-bold text-red-6 disabled:text-grey-5"
                      type="button"
                      disabled={hasEdges}
                      title={
                        hasEdges
                          ? 'Remove connected manual edges before deleting'
                          : 'Delete descriptive tag'
                      }
                      onClick={() => deleteDescriptiveTag(tag)}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-grey-6">No descriptive tags yet.</p>
        )}
      </section>
    </div>
  );
}

function NodeLinkGraphPage({
  auth,
  nodeLinkState,
  session,
  toastMessenger,
}: NodeLinkGraphPageProps) {
  const store = useSidebarStore();
  const routeParams = store.routeParams();
  const groups = store.allGroups();
  const hasFetchedProfile = store.hasFetchedProfile();
  const isLoggedIn = store.isLoggedIn();
  const routeGroup = routeGroupParam(routeParams);

  const [selectedGroupId, setSelectedGroupId] = useState(routeGroup);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [message, setMessage] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [semanticState, setSemanticState] =
    useState<NodeLinkSemanticState>(emptyNodeLinkState());
  const [selectedTag, setSelectedTag] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    if (routeGroup && routeGroup !== selectedGroupId) {
      setSelectedGroupId(routeGroup);
    }
  }, [routeGroup, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId && groups.length) {
      setSelectedGroupId(store.focusedGroupId() || groups[0].id);
    }
  }, [groups, selectedGroupId, store]);

  const loadGraph = () => {
    if (!selectedGroupId || !isLoggedIn) {
      return undefined;
    }

    const controller = new AbortController();
    setStatus('loading');
    setMessage('');

    Promise.all([
      nodeLinkState.fetchGroupAnnotations(selectedGroupId, controller.signal),
      nodeLinkState.loadState(selectedGroupId),
    ])
      .then(([fetchedAnnotations, loadedState]) => {
        setAnnotations(fetchedAnnotations);
        setSemanticState(loadedState.state);
        setStatus('loaded');
        setSaveStatus('idle');
        setSaveMessage('');
        setMessage(
          loadedState.status === 'invalid' ? loadedState.message || '' : '',
        );
      })
      .catch(err => {
        if (err.name === 'AbortError') {
          return;
        }
        setStatus('error');
        setMessage(err instanceof Error ? err.message : String(err));
      });

    return () => controller.abort();
  };

  useEffect(loadGraph, [isLoggedIn, nodeLinkState, selectedGroupId]);

  const selectedGroup = groups.find(group => group.id === selectedGroupId);

  const saveSemanticState = (nextState: NodeLinkSemanticState) => {
    if (!selectedGroupId) {
      setSaveStatus('error');
      setSaveMessage('Choose a group before saving.');
      return;
    }

    setSemanticState(nextState);
    setSaveStatus('saving');
    setSaveMessage('');
    nodeLinkState
      .saveState(selectedGroupId, nextState, { groupName: selectedGroup?.name })
      .then(result => {
        setSemanticState(result.state);
        setSaveStatus('saved');
        setSaveMessage('Saved to Hypothesis.');
      })
      .catch(err => {
        setSaveStatus('error');
        setSaveMessage(err instanceof Error ? err.message : String(err));
      });
  };

  const graph = useMemo(
    () => buildNodeLinkGraph(annotations, semanticState),
    [annotations, semanticState],
  );

  useEffect(() => {
    if (selectedTag && !graph.tags.some(tag => tag.tag === selectedTag)) {
      setSelectedTag('');
    }
  }, [graph.tags, selectedTag]);

  const login = async () => {
    try {
      await auth.login({ action: 'login' });
      session.reload();
    } catch (err) {
      toastMessenger.error(err.message);
    }
  };

  const canLoad = isLoggedIn && selectedGroupId;

  return (
    <div className="flex h-screen min-h-screen flex-col bg-grey-2 text-color-text">
      <header className="flex min-h-[64px] items-center justify-between gap-4 border-b bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded bg-brand text-white">
            <GraphIcon />
          </span>
          <div>
            <h1 className="text-xl font-bold">Node-Link Graph</h1>
            <p className="text-sm text-grey-6">
              Hypothesis tags, quote evidence, and manual tag relationships.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasFetchedProfile && !isLoggedIn && (
            <Button onClick={login}>Log in</Button>
          )}
          <Button
            onClick={() => {
              loadGraph();
            }}
            disabled={!canLoad || status === 'loading'}
            title="Refresh from Hypothesis"
          >
            <RefreshIcon className="mr-1 inline" /> Refresh
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="grid min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 p-4">
          <section className="flex flex-wrap items-end gap-3 rounded border bg-white p-3">
            <label className="grid min-w-[280px] gap-1 text-sm font-medium">
              <span>Group</span>
              <select
                className="h-9 rounded border bg-white px-2"
                value={selectedGroupId}
                disabled={!isLoggedIn || !groups.length}
                onChange={event =>
                  setSelectedGroupId((event.target as HTMLSelectElement).value)
                }
              >
                {!groups.length && <option value="">No groups loaded</option>}
                {groups.map(group => (
                  <option key={group.id} value={group.id}>
                    {groupLabel(group)}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm text-grey-6">
              {status === 'loading'
                ? 'Loading graph data...'
                : selectedGroup
                  ? `${graph.tags.length} tags, ${graph.documents.length} documents, ${graph.manualEdges.length} manual tag-tag edges`
                  : 'Choose a group to load graph data.'}
            </div>
          </section>

          {message && (
            <div className="rounded border border-yellow-6 bg-yellow-2 px-3 py-2 text-sm">
              {message}
            </div>
          )}

          {!hasFetchedProfile ? (
            <div className="rounded border bg-white p-6 text-sm text-grey-6">
              Checking Hypothesis session...
            </div>
          ) : !isLoggedIn ? (
            <div className="rounded border bg-white p-6">
              <h2 className="mb-2 text-lg font-bold">Sign in required</h2>
              <p className="mb-4 text-sm text-grey-6">
                Log in to Hypothesis to load your group annotations and synced
                node-link state.
              </p>
              <Button onClick={login}>Log in</Button>
            </div>
          ) : status === 'error' ? (
            <div className="rounded border bg-white p-6">
              <h2 className="mb-2 text-lg font-bold">Graph failed to load</h2>
              <p className="mb-4 text-sm text-grey-6">{message}</p>
              <Button onClick={() => loadGraph()}>Retry</Button>
            </div>
          ) : (
            <GraphCanvas
              graph={graph}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
            />
          )}
        </main>

        <aside className="w-[390px] shrink-0 overflow-auto border-l bg-white p-4">
          <div className="space-y-5">
            <EvidencePanel graph={graph} selectedTag={selectedTag} />
            <NodeLinkEditor
              graph={graph}
              selectedTag={selectedTag}
              semanticState={semanticState}
              onSaveState={saveSemanticState}
              saveStatus={saveStatus}
              saveMessage={saveMessage}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

export default withServices(NodeLinkGraphPage, [
  'auth',
  'nodeLinkState',
  'session',
  'toastMessenger',
]);
