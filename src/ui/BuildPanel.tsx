import { BUILDINGS, type BuildingKind, type Tool } from '../types';
import { BuildingThumb } from './BuildingThumb';
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

export function BuildPanel({ tool, funds, steps, guideVisible, onHideGuide, onShowGuide, onChoose, onWelcome, populationEnabled }: {
  tool: Tool;
  funds: number;
  steps: OnboardingStep[];
  guideVisible: boolean;
  onHideGuide: () => void;
  onShowGuide: () => void;
  onChoose: (kind: BuildingKind) => void;
  onWelcome: () => void;
  populationEnabled: boolean;
}) {
  const remaining = steps.filter((step) => !step.done);
  const next = remaining[0];
  return <section className="build-panel" aria-labelledby="build-heading">
    <div className="panel-topline"><span>CONSTRUCTION</span><span className="funds-chip"><Icon name="coin" size={13} /> ${funds.toLocaleString()}</span></div>
    <h2 id="build-heading">Shape the neighborhood</h2>
    <p className="panel-lede">Pick a building, then click an open lot next to a road. Drag with the road tool to pave a street.</p>
    {guideVisible && remaining.length > 0 ? <div className="guide-card">
      <div className="guide-head"><strong>First steps</strong><span>{steps.length - remaining.length}/{steps.length}</span>
        <button className="text-button" onClick={onHideGuide} aria-label="Hide the getting started guide">Hide</button></div>
      <ol className="guide-steps">
        {steps.map((step) => <li key={step.id} className={step.done ? 'is-done' : step === next ? 'is-next' : ''}>
          <span className="guide-check">{step.done ? <Icon name="check" size={12} /> : null}</span>
          <span><strong>{step.label}</strong>{step === next && <small>{step.hint}</small>}</span>
        </li>)}
      </ol>
      {next?.id === 'residents' && !populationEnabled && <button className="primary-action" onClick={onWelcome}><Icon name="people" size={16} /> Welcome residents</button>}
    </div> : !guideVisible && remaining.length > 0 ? <button className="text-button guide-reopen" onClick={onShowGuide}>Show getting started guide</button> : null}
    {groups.map((group) => <div className="catalog-group" key={group.title}>
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
