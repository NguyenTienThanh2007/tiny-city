import { useState } from 'react';
import { CONSTRUCTION_COSTS } from '@tiny-city/simulation';
import { BUILDINGS, type BuildingKind, type Tool } from '../types';
import { BuildingThumb } from './BuildingThumb';
import { ArchitecturePicker } from './ArchitecturePicker';
import type { ArchitectureCollectionId } from '@tiny-city/ai-architect';
import type { DesignChoice, DesignChoices } from '../game/architecture';
import { Icon } from './Icon';

export interface OnboardingStep { id: string; label: string; hint: string; done: boolean }

const groups: { title: string; caption: string; kinds: BuildingKind[] }[] = [
  { title: 'Homes', caption: 'Residents move in here', kinds: ['villa', 'duplex', 'townhouse', 'apartment'] },
  { title: 'Work', caption: 'Jobs for commuters', kinds: ['office', 'mall'] },
  { title: 'Leisure', caption: 'Evening destinations', kinds: ['park', 'clubhouse', 'pool'] },
];

function capacityLabel(kind: BuildingKind): string {
  const spec = BUILDINGS[kind];
  if (spec.role === 'home') return `${spec.capacity} residents`;
  if (kind === 'clubhouse') return `${spec.capacity} visitors`;
  if (spec.role === 'workplace') return `${spec.capacity} jobs`;
  return `${spec.capacity} visitors`;
}

export function BuildPanel({ tool, funds, steps, guideVisible, onHideGuide, onShowGuide, onChoose, onWelcome, populationEnabled, designChoices = {}, onDesignChange, onApplyCollection }: {
  tool: Tool;
  funds: number;
  steps: OnboardingStep[];
  guideVisible: boolean;
  onHideGuide: () => void;
  onShowGuide: () => void;
  onChoose: (kind: BuildingKind) => void;
  onWelcome: () => void;
  populationEnabled: boolean;
  /** Visual World 3.1 Architectural Style Selector. */
  designChoices?: DesignChoices;
  onDesignChange?: (kind: BuildingKind, choice: DesignChoice) => void;
  onApplyCollection?: (collection: ArchitectureCollectionId) => void;
}) {
  const remaining = steps.filter((step) => !step.done);
  const next = remaining[0];
  // The left toolbar is the quick-access catalog; the full card grid is opt-in to avoid duplicate controls.
  const [catalogOpen, setCatalogOpen] = useState(false);
  const buildingTool = Object.hasOwn(BUILDINGS, tool) ? tool as BuildingKind : null;
  const toolCard = buildingTool ? (() => {
    const spec = BUILDINGS[buildingTool];
    return { title: spec.label, kind: buildingTool, rows: [
      ['Footprint', `${spec.width} × ${spec.height} tiles`], ['Capacity', capacityLabel(buildingTool)],
      ['Cost', `$${spec.cost.toLocaleString()}`], ['Placement', spec.requiresRoad ? 'Must touch a road' : 'Anywhere on land'],
    ] as const, hint: funds >= spec.cost ? 'Hover the map: green road tiles show where it connects. Click to build.' : `You need $${(spec.cost - funds).toLocaleString()} more.` };
  })() : tool === 'road' ? { title: 'Road', kind: null, rows: [['Cost', `$${CONSTRUCTION_COSTS.road} per tile`], ['Gesture', 'Click or drag']] as const,
    hint: 'Residents only walk on connected roads. One drag is one undo step.' }
    : tool === 'move' ? { title: 'Move', kind: null, rows: [['Cost', 'Free']] as const, hint: 'Click a building, then its new lot. Residents inside move with it.' }
    : tool === 'bulldoze' ? { title: 'Bulldoze', kind: null, rows: [['Refund', 'None']] as const, hint: 'Click a building or road tile. Undo restores it.' } : null;
  const guideNode = guideVisible && remaining.length > 0 ? <div className="guide-card">
      <div className="guide-head"><strong>First steps</strong><span>{steps.length - remaining.length}/{steps.length}</span>
        <button className="text-button" onClick={onHideGuide} aria-label="Hide the getting started guide">Hide</button></div>
      <ol className="guide-steps">
        {steps.map((step) => <li key={step.id} className={step.done ? 'is-done' : step === next ? 'is-next' : ''}>
          <span className="guide-check">{step.done ? <Icon name="check" size={12} /> : null}</span>
          <span><strong>{step.label}</strong>{step === next && <small>{step.hint}</small>}</span>
        </li>)}
      </ol>
      {next?.id === 'residents' && !populationEnabled && <button className="primary-action" onClick={onWelcome}><Icon name="people" size={16} /> Welcome residents</button>}
    </div> : !guideVisible && remaining.length > 0 ? <button className="text-button guide-reopen" onClick={onShowGuide}>Show getting started guide</button> : null;
  const toolNode = toolCard && <div className="tool-card" aria-label="Selected tool">
      <div className="tool-card-head">{toolCard.kind ? <BuildingThumb kind={toolCard.kind} /> : <span className="tool-card-icon"><Icon name={tool} size={22} /></span>}
        <div><small>SELECTED TOOL</small><strong>{toolCard.title}</strong></div></div>
      <dl>{toolCard.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p>{toolCard.hint}</p>
      {toolCard.kind && onDesignChange && <ArchitecturePicker kind={toolCard.kind} choice={designChoices[toolCard.kind]}
        onChange={(choice) => onDesignChange(toolCard.kind!, choice)} onApplyToAll={(collection) => onApplyCollection?.(collection)} />}
    </div>;
  return <section className="build-panel" aria-labelledby="build-heading">
    <div className="panel-topline"><span>CONSTRUCTION</span><span className="funds-chip"><Icon name="coin" size={13} /> ${funds.toLocaleString()}</span></div>
    <h2 id="build-heading">Shape the neighborhood</h2>
    <p className="panel-lede">Pick a building, then click an open lot next to a road. Drag with the road tool to pave a street.</p>
    {/* With a building tool active, its card and Architectural Style Selector lead; otherwise the guide does. */}
    {toolCard?.kind ? <>{toolNode}{guideNode}</> : <>{guideNode}{toolNode}</>}
    <button type="button" className="catalog-toggle" aria-expanded={catalogOpen} onClick={() => setCatalogOpen((open) => !open)}>
      <Icon name="layers" size={15} /><span>{catalogOpen ? 'Hide building catalog' : 'Browse building catalog'}</span><Icon name="chevron" size={14} className={catalogOpen ? 'is-open' : ''} />
    </button>
    {catalogOpen && groups.map((group) => <div className="catalog-group" key={group.title}>
      <div className="section-heading"><span>{group.title.toUpperCase()}</span><small>{group.caption}</small></div>
      <div className="catalog-grid">
        {group.kinds.map((kind) => {
          const spec = BUILDINGS[kind];
          const affordable = funds >= spec.cost;
          return <button key={kind} className={`catalog-card ${tool === kind ? 'is-selected' : ''}`} aria-pressed={tool === kind}
            disabled={!affordable} title={affordable ? `Place ${spec.label}` : `Needs $${spec.cost.toLocaleString()}`} onClick={() => onChoose(kind)}>
            <BuildingThumb kind={kind} />
            <span className="catalog-name">{spec.label}</span>
            <span className="catalog-meta">{spec.width}×{spec.height} · {capacityLabel(kind)}</span>
            <span className="catalog-price">{affordable ? `$${spec.cost.toLocaleString()}` : `Needs $${spec.cost.toLocaleString()}`}</span>
          </button>;
        })}
      </div>
    </div>)}
  </section>;
}
