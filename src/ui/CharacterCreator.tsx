import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { normalizePlayerName, PLAYER_APPEARANCE_OPTIONS } from '@tiny-city/simulation';
import type { PlayerAppearance } from '@tiny-city/simulation';
import {
  ACCESSORY_NAMES, css, HAIR_COLOR_NAMES, HAIR_COLORS, HAIR_STYLE_NAMES, OUTFIT_COLOR_NAMES, OUTFIT_COLORS, OUTFIT_NAMES, SKIN_TONE_NAMES, SKIN_TONES,
} from '../game/playerLook';
import { hashString } from '../game/npcMotion';
import { Icon } from './Icon';
import { PlayerFigure } from './PlayerFigure';

export interface CharacterDraft { readonly name: string; readonly appearance: PlayerAppearance }

function Swatches({ legend, names, colors, value, onChange }: { legend: string; names: readonly string[]; colors: readonly number[]; value: number; onChange: (value: number) => void }) {
  const group = useId();
  return <fieldset className="creator-field">
    <legend>{legend}<span>{names[value]}</span></legend>
    <div className="swatch-row">
      {colors.map((color, index) => <label key={color} className={`swatch ${index === value ? 'is-selected' : ''}`} style={{ '--swatch': css(color) } as CSSProperties} title={names[index]}>
        <input type="radio" name={group} checked={index === value} onChange={() => onChange(index)} aria-label={`${legend} ${names[index]}`} />
        <span aria-hidden="true" />
      </label>)}
    </div>
  </fieldset>;
}

function Choices<T extends string>({ legend, options, labels, value, onChange }: { legend: string; options: readonly T[]; labels: Record<T, string>; value: T; onChange: (value: T) => void }) {
  const group = useId();
  return <fieldset className="creator-field">
    <legend>{legend}</legend>
    <div className="choice-row">
      {options.map((option) => <label key={option} className={`choice ${option === value ? 'is-selected' : ''}`}>
        <input type="radio" name={group} checked={option === value} onChange={() => onChange(option)} aria-label={`${legend} ${labels[option]}`} />
        <span>{labels[option]}</span>
      </label>)}
    </div>
  </fieldset>;
}

/** Deterministic suggestion: the same name and press count always suggest the same look. */
function suggest(name: string, count: number): PlayerAppearance {
  const seed = hashString(`${name}:${count}`);
  const pick = (size: number, salt: number) => (Math.imul(seed ^ salt, 0x9e3779b1) >>> 0) % size;
  const o = PLAYER_APPEARANCE_OPTIONS;
  return { skinTone: pick(o.skinTones, 1), hairStyle: o.hairStyles[pick(o.hairStyles.length, 2)]!, hairColor: pick(o.hairColors, 3),
    outfit: o.outfits[pick(o.outfits.length, 4)]!, outfitColor: pick(o.outfitColors, 5), accessory: o.accessories[pick(o.accessories.length, 6)]! };
}

export function CharacterCreator({ initial, editing, onCancel, onSubmit }: {
  initial: CharacterDraft;
  editing: boolean;
  onCancel: () => void;
  onSubmit: (draft: CharacterDraft) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [look, setLook] = useState<PlayerAppearance>(initial.appearance);
  const [touched, setTouched] = useState(false);
  const [suggestions, setSuggestions] = useState(0);
  const [stride, setStride] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const valid = normalizePlayerName(name) !== null;
  const errorId = useId();
  const set = <K extends keyof PlayerAppearance>(key: K, value: PlayerAppearance[K]) => setLook((current) => ({ ...current, [key]: value }));

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    // A gentle walk cycle in the preview; static when reduced motion is requested.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const timer = window.setInterval(() => { frame += 1; setStride(Math.sin(frame / 3) * 0.9); }, 90);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    const normalized = normalizePlayerName(name);
    if (normalized) onSubmit({ name: normalized, appearance: look });
    else inputRef.current?.focus();
  };

  return <div className="creator-backdrop">
    <form className="character-creator" role="dialog" aria-modal="true" aria-labelledby="creator-heading" onSubmit={submit}>
      <header className="creator-head">
        <div>
          <span className="creator-eyebrow">{editing ? 'LIFE MODE · YOUR CHARACTER' : 'LIFE MODE · STEP 1 OF 2'}</span>
          <h2 id="creator-heading">{editing ? 'Edit your look' : 'Create your character'}</h2>
        </div>
        <button type="button" className="panel-close" aria-label="Close character creator" onClick={onCancel}><Icon name="close" size={16} /></button>
      </header>
      {!editing && <ol className="creator-steps" aria-label="Steps"><li className="is-current">Look &amp; name</li><li>Choose a home</li></ol>}
      <div className="creator-body">
        <div className="creator-preview" aria-live="polite">
          <div className="creator-stage"><PlayerFigure appearance={look} size={210} stride={stride} animate title={`Preview of ${normalizePlayerName(name) ?? 'your character'}`} /></div>
          <strong className="creator-name">{normalizePlayerName(name) ?? 'Your name'}</strong>
          <small>This is exactly how you will look in the city.</small>
          <button type="button" className="text-button" onClick={() => { const next = suggestions + 1; setSuggestions(next); setLook(suggest(name, next)); }}>
            <Icon name="sparkle" size={13} /> Suggest a look</button>
        </div>
        <div className="creator-form">
          <label className="creator-field creator-name-field">
            <span>Character name</span>
            <input ref={inputRef} value={name} maxLength={32} onChange={(event) => setName(event.target.value)} onBlur={() => setTouched(true)}
              aria-invalid={touched && !valid} aria-describedby={errorId} placeholder="e.g. Mai Nguyen" autoComplete="off" spellCheck={false} />
            <small id={errorId} className={touched && !valid ? 'field-error' : 'field-help'}>
              {touched && !valid ? 'Use 1–24 letters, numbers, spaces, apostrophes, dots or hyphens.' : 'Shown above your character and in your profile.'}</small>
          </label>
          <Swatches legend="Skin tone" names={SKIN_TONE_NAMES} colors={SKIN_TONES} value={look.skinTone} onChange={(v) => set('skinTone', v)} />
          <Choices legend="Hairstyle" options={PLAYER_APPEARANCE_OPTIONS.hairStyles} labels={HAIR_STYLE_NAMES} value={look.hairStyle} onChange={(v) => set('hairStyle', v)} />
          <Swatches legend="Hair color" names={HAIR_COLOR_NAMES} colors={HAIR_COLORS} value={look.hairColor} onChange={(v) => set('hairColor', v)} />
          <Choices legend="Outfit" options={PLAYER_APPEARANCE_OPTIONS.outfits} labels={OUTFIT_NAMES} value={look.outfit} onChange={(v) => set('outfit', v)} />
          <Swatches legend="Outfit color" names={OUTFIT_COLOR_NAMES} colors={OUTFIT_COLORS} value={look.outfitColor} onChange={(v) => set('outfitColor', v)} />
          <Choices legend="Accessory" options={PLAYER_APPEARANCE_OPTIONS.accessories} labels={ACCESSORY_NAMES} value={look.accessory} onChange={(v) => set('accessory', v)} />
        </div>
      </div>
      <footer className="creator-foot">
        <button type="button" className="reject-plan" onClick={onCancel}>Cancel</button>
        <button type="submit" className={`approve-plan ${valid ? '' : 'is-incomplete'}`}>{editing ? 'Save look' : 'Next: choose a home'} <Icon name="arrow" size={15} /></button>
      </footer>
    </form>
  </div>;
}
