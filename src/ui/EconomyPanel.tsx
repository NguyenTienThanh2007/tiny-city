import { useMemo, useState } from 'react';
import { ECONOMY, operatingNet } from '@tiny-city/simulation';
import type { EconomyDayReport, EconomyPolicy, WorldState } from '@tiny-city/simulation';
import {
  alertText, businessStatusLabels, dayLabel, money, policyPreview, signedMoney, statusLabels, treasuryRows,
  type EconomyOverview, type FlowRow,
} from '../simulation/economyView';
import { Icon } from './Icon';

type ChartKind = 'treasury' | 'flow';
const LARGE_CHANGE = 5;

/** Recorded daily history only: no data is invented for days that have not been settled yet. */
function HistoryChart({ history, kind }: { history: readonly EconomyDayReport[]; kind: ChartKind }) {
  const width = 300, height = 112, pad = 6;
  const days = history.slice(-14);
  if (days.length === 0) return <p className="muted small economy-empty">The first day settles at midnight. History appears here from then on.</p>;
  if (kind === 'treasury') {
    const values = days.map((r) => r.treasuryClose);
    const max = Math.max(...values), min = Math.min(...values), span = Math.max(1, max - min);
    const x = (i: number) => pad + (days.length === 1 ? (width - pad * 2) / 2 : i * (width - pad * 2) / (days.length - 1));
    const y = (v: number) => height - pad - (v - min) / span * (height - pad * 2 - 12);
    const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(values.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
    return <figure className="economy-chart" aria-label={`Treasury over the last ${days.length} days, from ${money(values[0]!)} to ${money(values.at(-1)!)}`} role="img">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="chart-area" d={area} /><path className="chart-line" d={line} />
        {values.map((v, i) => <circle key={days[i]!.day} className="chart-dot" cx={x(i)} cy={y(v)} r={days.length > 10 ? 1.8 : 2.6} />)}
      </svg>
      <figcaption><span>{dayLabel(days[0]!.day)}</span><span>{money(min)} – {money(max)}</span><span>{dayLabel(days.at(-1)!.day)}</span></figcaption>
    </figure>;
  }
  const flows = days.map((r) => operatingNet(r));
  const peak = Math.max(1, ...flows.map((f) => Math.max(f.income, f.expenses)));
  const mid = height / 2, slot = (width - pad * 2) / days.length, bar = Math.max(3, slot * 0.34);
  return <figure className="economy-chart" role="img" aria-label={`Daily income and expenses over the last ${days.length} days; latest net ${signedMoney(flows.at(-1)!.net)}`}>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <line className="chart-axis" x1={pad} x2={width - pad} y1={mid} y2={mid} />
      {flows.map((f, i) => {
        const cx = pad + slot * i + slot / 2, up = f.income / peak * (mid - pad), down = f.expenses / peak * (mid - pad);
        const net = f.net / peak * (mid - pad);
        return <g key={days[i]!.day}>
          <rect className="chart-income" x={cx - bar - 0.5} y={mid - up} width={bar} height={up} rx={1.5} />
          <rect className="chart-expense" x={cx + 0.5} y={mid} width={bar} height={down} rx={1.5} />
          <circle className={f.net >= 0 ? 'chart-net' : 'chart-net is-negative'} cx={cx} cy={mid - net} r={2.2} />
        </g>;
      })}
    </svg>
    <figcaption><span><i className="key-income" /> Income</span><span><i className="key-expense" /> Expenses</span><span><i className="key-net" /> Net</span></figcaption>
  </figure>;
}

function FlowList({ rows, label, tone }: { rows: readonly FlowRow[]; label: string; tone: 'in' | 'out' }) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return <div className={`flow-list is-${tone}`} role="group" aria-label={label}>
    <div className="flow-head"><span>{label}</span><strong>{tone === 'in' ? '+' : '−'}{money(total)}</strong></div>
    <ul>{rows.map((row) => <li key={row.key} title={row.hint}>
      <span>{row.label}<small>{row.hint}</small></span>
      <strong>{row.amount === 0 ? '—' : money(row.amount)}</strong>
      <i style={{ width: `${total ? Math.round(row.amount * 100 / total) : 0}%` }} aria-hidden="true" />
    </li>)}</ul>
  </div>;
}

export function EconomyPanel({ world, overview, onApplyPolicy, onSelectBuilding, onClose }: {
  world: WorldState;
  overview: EconomyOverview;
  onApplyPolicy: (policy: EconomyPolicy) => boolean;
  onSelectBuilding: (id: string) => void;
  onClose: () => void;
}) {
  const policy = world.economy!.policy;
  const [chart, setChart] = useState<ChartKind>('treasury');
  const [draft, setDraft] = useState<EconomyPolicy>(policy);
  const [confirming, setConfirming] = useState(false);
  const changed = draft.residentialTaxRate !== policy.residentialTaxRate || draft.commercialTaxRate !== policy.commercialTaxRate;
  const large = Math.abs(draft.residentialTaxRate - policy.residentialTaxRate) >= LARGE_CHANGE || Math.abs(draft.commercialTaxRate - policy.commercialTaxRate) >= LARGE_CHANGE;
  // Recomputed only when the draft or the settled economy changes, never per frame.
  const preview = useMemo(() => changed ? policyPreview(world, draft) : null, [changed, draft, world.economy, world.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const { last, today } = overview;
  const todayNet = operatingNet(today);
  const rows = last ? treasuryRows(last) : null;
  const setRate = (key: keyof EconomyPolicy, value: number) => { setDraft((current) => ({ ...current, [key]: value })); setConfirming(false); };
  const apply = () => {
    if (large && !confirming) { setConfirming(true); return; }
    if (onApplyPolicy(draft)) setConfirming(false);
  };
  return <section className="economy-panel" aria-labelledby="economy-heading">
    <div className="panel-topline"><span>CITY ECONOMY</span>
      <button className="panel-close" aria-label="Close city economy" onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
    <div className="economy-heading-row">
      <span className="economy-coin" aria-hidden="true"><Icon name="coin" size={18} /></span>
      <div><h2 id="economy-heading">City economy</h2><p>Settles every midnight · {statusLabels[overview.status]}</p></div>
    </div>

    <div className={`treasury-card is-${overview.status}`} role="group" aria-label="Treasury">
      <span>Treasury</span>
      <strong data-testid="economy-treasury">{money(overview.treasury)}</strong>
      <small>{overview.lastNet === null ? 'No full day settled yet'
        : <><b className={overview.lastNet >= 0 ? 'is-gain' : 'is-loss'}>{signedMoney(overview.lastNet)}</b> operating result, {dayLabel(last!.day)}</>}</small>
      {last && (last.unpaid.upkeep + last.unpaid.support) > 0 && <small className="runway">{money(last.unpaid.upkeep + last.unpaid.support)} of city costs could not be paid</small>}
      {overview.runway !== null && <small className="runway">About {overview.runway} day{overview.runway === 1 ? '' : 's'} of money left at this rate</small>}
    </div>

    <dl className="economy-kpis">
      <div><dt>Income · last day</dt><dd>{last ? money(operatingNet(last).income) : '—'}</dd></div>
      <div><dt>Expenses · last day</dt><dd>{last ? money(operatingNet(last).expenses) : '—'}
        {last && (last.unpaid.upkeep + last.unpaid.support) > 0 && <small className="is-loss">+{money(last.unpaid.upkeep + last.unpaid.support)} unpaid</small>}</dd></div>
      <div><dt>Employment</dt><dd>{overview.employment.rate === null ? '—' : `${overview.employment.rate}%`}<small>{overview.employment.employed} of {overview.employment.residents} residents · {overview.employment.jobs} jobs</small></dd></div>
      <div><dt>Businesses</dt><dd>{overview.businesses.total ? `${overview.businesses.profitable}/${overview.businesses.total}` : '—'}<small>{overview.businesses.total ? 'profitable last day' : 'Offices and malls'}</small></dd></div>
    </dl>

    {overview.alerts.length > 0 && <ul className="economy-alerts" aria-label="Economic alerts">
      {overview.alerts.map((alert) => <li key={alert.id} className={`is-${alert.severity}`}>
        <Icon name={alert.severity === 'warning' ? 'warning' : 'sparkle'} size={13} />
        <span>{alertText(alert, world)}</span>
        {alert.buildingId && <button className="link-button" onClick={() => onSelectBuilding(alert.buildingId!)}>View</button>}
      </li>)}
    </ul>}

    <div className="section-heading"><span>HISTORY</span><small>Recorded at each midnight</small></div>
    <div className="segmented" role="tablist" aria-label="History chart">
      <button role="tab" aria-selected={chart === 'treasury'} className={chart === 'treasury' ? 'active' : ''} onClick={() => setChart('treasury')}>Treasury</button>
      <button role="tab" aria-selected={chart === 'flow'} className={chart === 'flow' ? 'active' : ''} onClick={() => setChart('flow')}>Income & expenses</button>
    </div>
    <HistoryChart history={overview.history} kind={chart} />
    {overview.history.length > 0 && <table className="economy-days" aria-label="Recent days">
      <thead><tr><th>Day</th><th>Income</th><th>Expenses</th><th>Net</th><th>Treasury</th></tr></thead>
      <tbody>{overview.history.slice(-5).reverse().map((r) => { const n = operatingNet(r); return <tr key={r.day}>
        <td>{dayLabel(r.day)}</td><td>{money(n.income)}</td><td>{money(n.expenses)}</td>
        <td className={n.net >= 0 ? 'is-gain' : 'is-loss'}>{signedMoney(n.net)}</td><td>{money(r.treasuryClose)}</td></tr>; })}</tbody>
    </table>}

    {rows && <>
      <div className="section-heading"><span>WHERE THE MONEY WENT</span><small>{dayLabel(last!.day)}</small></div>
      <FlowList rows={rows.income} label="Treasury income" tone="in" />
      <FlowList rows={rows.expenses} label="Treasury expenses" tone="out" />
      {(last!.unpaid.upkeep + last!.unpaid.support) > 0 && <p className="economy-warning"><Icon name="warning" size={13} /> {money(last!.unpaid.upkeep + last!.unpaid.support)} of city costs went unpaid.</p>}
    </>}

    <div className="section-heading"><span>TODAY SO FAR</span><small>Estimate · settles at 00:00</small></div>
    <div className="today-estimate" role="group" aria-label="Today estimate">
      <div><span>Income</span><strong>{money(todayNet.income)}</strong></div>
      <div><span>Expenses</span><strong>{money(todayNet.expenses)}</strong></div>
      <div><span>Net</span><strong className={todayNet.net >= 0 ? 'is-gain' : 'is-loss'}>{signedMoney(todayNet.net)}</strong></div>
      <p className="muted small">If the day ended now, with today’s jobs, residents and real venue visits. Not final until midnight.</p>
    </div>

    <div className="section-heading"><span>TAX POLICY</span><small>Applies from the next midnight</small></div>
    <div className="policy-card">
      {([['residentialTaxRate', 'Residential tax', 'Withheld from wages. Higher rates lower consumer confidence and shopping.', ECONOMY.taxes.residential],
        ['commercialTaxRate', 'Commercial tax', 'On business revenue. Higher rates send shoppers and office clients elsewhere.', ECONOMY.taxes.commercial]] as const).map(([key, label, hint, limits]) =>
        <label key={key} className="policy-slider">
          <span className="policy-label"><strong>{label}</strong><output>{draft[key]}%</output></span>
          <input type="range" min={limits.min} max={limits.max} step={1} value={draft[key]} aria-label={label}
            aria-valuetext={`${draft[key]} percent`} onChange={(event) => setRate(key, Number(event.target.value))} />
          <small>{hint} Current: {policy[key]}%.</small>
        </label>)}
      {preview && <div className="policy-preview" role="status" aria-label="Policy estimate">
        <strong>Estimated effect per day, at today’s activity</strong>
        <ul>
          <li>City income <b className={preview.incomeChange >= 0 ? 'is-gain' : 'is-loss'}>{signedMoney(preview.incomeChange)}</b></li>
          <li>Consumer confidence {preview.confidence}% <span className="muted">({preview.confidenceChange >= 0 ? '+' : ''}{preview.confidenceChange})</span></li>
          <li>Shopping kept in local malls {preview.localShopping}% · office client demand {preview.officeDemand}%</li>
          <li>Business profits <b className={preview.businessProfitChange >= 0 ? 'is-gain' : 'is-loss'}>{signedMoney(preview.businessProfitChange)}</b></li>
        </ul>
        {confirming && <p className="economy-warning"><Icon name="warning" size={13} /> Large change. Residents and businesses feel it from the next settlement. Apply anyway?</p>}
      </div>}
      <div className="policy-actions">
        <button className="primary-action subtle" disabled={!changed} onClick={apply}>{confirming ? 'Confirm tax change' : 'Apply tax rates'}</button>
        {changed && <button className="text-button" onClick={() => { setDraft(policy); setConfirming(false); }}>Keep current rates</button>}
      </div>
    </div>

    {overview.businesses.total > 0 && <>
      <div className="section-heading"><span>BUSINESSES</span><small>{last ? dayLabel(last.day) : 'After the first midnight'}</small></div>
      <ul className="business-list" aria-label="Businesses">
        {overview.businesses.finances.map((f) => {
          const name = world.plan.buildings.find((b) => b.id === f.buildingId)?.name ?? f.buildingId;
          return <li key={f.buildingId}><button onClick={() => onSelectBuilding(f.buildingId)}>
            <span className={`business-mark is-${f.role}`}><Icon name={f.role === 'office' ? 'office' : f.role} size={14} /></span>
            <span className="business-copy"><strong>{name}</strong><small>{f.workers}/{f.jobs} workers · <em className={`status-${f.status}`}>{businessStatusLabels[f.status]}</em></small></span>
            <b className={f.profit >= 0 ? 'is-gain' : 'is-loss'}>{signedMoney(f.profit)}</b>
          </button></li>;
        })}
      </ul>
    </>}
    <p className="muted small economy-footnote">Whole dollars. Businesses close every day: profit goes to, and losses are covered by, owners outside the city. Residents’ rent goes to landlords outside the city, not to the treasury.</p>
  </section>;
}
