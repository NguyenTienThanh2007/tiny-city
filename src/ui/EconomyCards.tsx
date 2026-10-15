import type { BuildingFinance, EconomyImpactEstimate } from '@tiny-city/simulation';
import { businessStatusLabels, conditionLabels, money, signedMoney, type CitizenEconomy } from '../simulation/economyView';

/** A business's or amenity's last settled day (or today's estimate before its first midnight). */
export function BuildingEconomyCard({ finance, projected }: { finance: BuildingFinance; projected: boolean }) {
  const business = finance.status !== 'public';
  return <div className={`economy-card is-${finance.status}`} role="group" aria-label="Economic activity">
    <div className="economy-card-head">
      <span>{business ? 'Business' : 'Public amenity'} · {projected ? 'today (estimate)' : 'last day'}</span>
      <em className={`status-${finance.status}`}>{businessStatusLabels[finance.status]}</em>
    </div>
    {business ? <dl>
      <div><dt>Workers</dt><dd>{finance.workers} / {finance.jobs}</dd></div>
      <div><dt>{finance.role === 'office' ? 'Revenue' : 'Sales'}</dt><dd>{money(finance.revenue)}</dd></div>
      {finance.role !== 'office' && finance.role !== 'mall' && <div><dt>Paying visitors</dt><dd>{finance.visits}</dd></div>}
      <div><dt>Payroll</dt><dd>−{money(finance.payroll)}</dd></div>
      <div><dt>Operating costs</dt><dd>−{money(finance.upkeep)}</dd></div>
      <div><dt>Commercial tax</dt><dd>−{money(finance.tax)}</dd></div>
      <div className="is-total"><dt>{finance.profit >= 0 ? 'Profit' : 'Loss'}</dt><dd className={finance.profit >= 0 ? 'is-gain' : 'is-loss'}>{signedMoney(finance.profit)}</dd></div>
      {finance.role === 'mall' && <div><dt>Customer demand</dt><dd>{money(finance.demand)}</dd></div>}
    </dl> : <dl>
      <div><dt>City upkeep</dt><dd>−{money(finance.upkeep)}</dd></div>
      <div><dt>Visits</dt><dd>{finance.visits}</dd></div>
      <div><dt>Entry fees</dt><dd>{finance.fees ? money(finance.fees) : finance.role === 'park' || finance.role === 'plaza' || finance.role === 'stage' ? 'Free' : '—'}</dd></div>
    </dl>}
    {business && finance.lossStreak >= 2 && <p className="muted small">Losing money {finance.lossStreak} days in a row; the owners cover it.</p>}
  </div>;
}

export function CitizenEconomyCard({ economy }: { economy: CitizenEconomy }) {
  return <div className={`economy-card is-${economy.condition}`} role="group" aria-label="Money">
    <div className="economy-card-head"><span>Money</span><em className={`condition-${economy.condition}`}>{conditionLabels[economy.condition]}</em></div>
    <dl>
      <div><dt>Employment</dt><dd>{economy.employment}</dd></div>
      {economy.jobCategory && <div><dt>Job</dt><dd>{economy.jobCategory} · {money(economy.wage)}/day</dd></div>}
      <div><dt>Savings</dt><dd>{money(economy.balance)}</dd></div>
      {economy.last ? <>
        <div><dt>Income · last day</dt><dd>{money(economy.last.income)}</dd></div>
        <div><dt>Taxes</dt><dd>−{money(economy.last.taxes)}</dd></div>
        <div><dt>Rent, shopping & fees</dt><dd>−{money(economy.last.spending)}</dd></div>
      </> : <div><dt>Since moving in</dt><dd className="muted">First settlement at midnight</dd></div>}
    </dl>
  </div>;
}

/** AI plan economics: what approval costs for certain, and what it would likely change per day. */
export function PlanEconomyCard({ impact }: { impact: EconomyImpactEstimate }) {
  const e = impact.estimated;
  return <div className="plan-economy" role="group" aria-label="Economic impact">
    <div className="plan-economy-block is-confirmed">
      <span>Confirmed now</span>
      <dl>
        <div><dt>Construction cost</dt><dd>{money(impact.confirmed.constructionCost)}</dd></div>
        <div><dt>Treasury after approval</dt><dd>{money(impact.confirmed.treasuryAfter)}</dd></div>
      </dl>
    </div>
    <div className="plan-economy-block is-estimate">
      <span>Estimated per day · not guaranteed</span>
      <dl>
        {e.jobsAdded !== 0 && <div><dt>Jobs</dt><dd>{e.jobsAdded > 0 ? '+' : ''}{e.jobsAdded}</dd></div>}
        {e.roomsAdded !== 0 && <div><dt>Homes (rooms)</dt><dd>{e.roomsAdded > 0 ? '+' : ''}{e.roomsAdded}</dd></div>}
        {e.employedChange !== 0 && <div><dt>Residents employed</dt><dd>{e.employedChange > 0 ? '+' : ''}{e.employedChange}</dd></div>}
        <div><dt>City income</dt><dd>{signedMoney(e.incomeChange)}</dd></div>
        <div><dt>City running costs</dt><dd>{signedMoney(e.expensesChange)}</dd></div>
        <div className="is-total"><dt>Daily budget</dt><dd className={e.netChange >= 0 ? 'is-gain' : 'is-loss'}>{signedMoney(e.netChange)}</dd></div>
      </dl>
      {e.jobsAdded > 0 && e.employedChange < e.jobsAdded && <p className="small plan-economy-note">{e.jobsAdded - Math.max(0, e.employedChange)} of the new jobs would stay empty: {e.employedChange <= 0 ? 'every resident already has a job' : 'not enough residents are free'}. They fill as homes are added.</p>}
      {e.residentsAdded > 0 && e.employedChange < e.residentsAdded && <p className="small plan-economy-note">{e.residentsAdded - Math.max(0, e.employedChange)} new resident{e.residentsAdded - Math.max(0, e.employedChange) === 1 ? '' : 's'} would have no job (city support).</p>}
      <p className="muted small">One day at today’s activity once residents settle in. The simulation calculates the real result each midnight.</p>
    </div>
  </div>;
}
