import { useState } from 'react';
import { ARCHITECTURE_COLLECTIONS, architectureModel, modelsFor } from '@tiny-city/ai-architect';
import type { ArchitectureCollectionId, ArchitectureModel } from '@tiny-city/ai-architect';
import { DEFAULT_CHOICE, thumbnailUrl, type DesignChoice } from '../game/architecture';
import type { BuildingKind } from '../types';
import { BuildingThumb } from './BuildingThumb';

/** Baked model thumbnail; the vector glyph stands in if the image is missing. */
export function ModelThumb({ model, kind, size = 64 }: { model: ArchitectureModel | null; kind: BuildingKind; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!model || failed) return <span className="model-thumb is-glyph" style={{ width: size, height: size }}><BuildingThumb kind={kind} /></span>;
  return <img className="model-thumb" src={thumbnailUrl(model.id)} width={size} height={size} alt="" loading="lazy" decoding="async"
    draggable={false} onError={() => setFailed(true)} />;
}

/**
 * Visual World 3.1 Architectural Style Selector for one building type: collection, then model (or a varied mix of
 * the collection). Only changes what the next construction looks like; cost, capacity and footprint never change.
 */
export function ArchitecturePicker({ kind, choice, onChange, onApplyToAll }: {
  kind: BuildingKind;
  choice: DesignChoice | undefined;
  onChange: (choice: DesignChoice) => void;
  /** District cohesion: use this collection (as a varied mix) for every building type that has models in it. */
  onApplyToAll: (collection: ArchitectureCollectionId) => void;
}) {
  const current = choice ?? DEFAULT_CHOICE;
  const collections = ARCHITECTURE_COLLECTIONS.map((collection) => ({ collection, models: modelsFor(kind, collection.id) }))
    .filter((entry) => entry.models.length > 0);
  const active = collections.find((entry) => entry.collection.id === current.collection) ?? collections[0]!;
  const available = active.models.filter((model) => model.status === 'available');
  const selected = current.model ? architectureModel(current.model) ?? null : null;
  const preview = selected ?? available[0] ?? null;
  return <section className="architecture-picker" aria-label="Architecture">
    <div className="picker-heading"><span>ARCHITECTURE</span><small>Cosmetic · same cost & capacity</small></div>
    <div className="collection-tabs" role="radiogroup" aria-label="Architectural collection">
      {collections.map(({ collection, models }) => {
        const count = models.filter((model) => model.status === 'available').length;
        const isActive = collection.id === active.collection.id;
        return <button key={collection.id} type="button" role="radio" aria-checked={isActive} disabled={count === 0}
          className={`collection-tab ${isActive ? 'is-active' : ''}`} title={count ? collection.tagline : `${collection.name}: coming soon`}
          onClick={() => { const ready = models.filter((model) => model.status === 'available'); onChange({ collection: collection.id, model: ready.length === 1 ? ready[0]!.id : null }); }}>
          <span className="swatches" aria-hidden="true">{collection.palette.slice(0, 4).map((color) => <i key={color} style={{ background: color }} />)}</span>
          <span className="collection-name">{collection.name}</span>
          <span className="collection-count">{count || 'Soon'}</span>
        </button>;
      })}
    </div>
    <p className="collection-blurb">{active.collection.description}</p>
    <div className="model-preview" aria-live="polite">
      <ModelThumb model={preview} kind={kind} size={92} />
      <div>
        <small>{selected ? 'SELECTED MODEL' : `VARIED MIX · ${available.length} MODELS`}</small>
        <strong>{selected ? selected.name : `${active.collection.name} mix`}</strong>
        <p>{selected ? selected.description : 'Each new building gets one of the collection’s models, chosen from its ID: the preview shows exactly which.'}</p>
        {selected && <ul className="feature-tags">{selected.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>}
      </div>
    </div>
    <div className="model-grid" role="radiogroup" aria-label="Building model">
      {available.length > 1 && <button type="button" role="radio" aria-checked={current.model === null} className={`model-card is-mix ${current.model === null ? 'is-selected' : ''}`}
        aria-label={`Mix of ${active.collection.name}`} onClick={() => onChange({ collection: active.collection.id, model: null })}>
        <span className="mix-stack" aria-hidden="true">{available.slice(0, 3).map((model) => <ModelThumb key={model.id} model={model} kind={kind} size={34} />)}</span>
        <span className="model-name">Varied mix</span>
      </button>}
      {active.models.map((model) => {
        const planned = model.status !== 'available';
        const isSelected = current.model === model.id;
        return <button key={model.id} type="button" role="radio" aria-checked={isSelected} disabled={planned}
          className={`model-card ${isSelected ? 'is-selected' : ''} ${planned ? 'is-planned' : ''}`} aria-label={planned ? `${model.name} (coming soon)` : model.name}
          title={planned ? 'Planned for a later update' : model.description} onClick={() => onChange({ collection: model.collection, model: model.id })}>
          <ModelThumb model={planned ? null : model} kind={kind} size={58} />
          <span className="model-name">{model.name}</span>
          {planned && <span className="model-soon">Coming soon</span>}
        </button>;
      })}
    </div>
    {active.collection.id !== 'classic' && <button type="button" className="text-button apply-collection" onClick={() => onApplyToAll(active.collection.id)}>
      Use {active.collection.name} for every building type
    </button>}
  </section>;
}
