import type { Plan } from '../lib/types';

const FOCUS: Record<Plan['focus'], string> = {
  rest: 'Rest and recover this week',
  mass: 'Protect your muscle while you lose weight',
  grip: 'Build grip and upper-body strength',
  legs: 'Build leg strength',
  maintain: 'Keep doing what works',
};

/** This week's plan: protein target, strength routine and day-by-day schedule. Every number comes from the server's plan. */
export function PlanCard({ plan, open = false }: { plan: Plan; open?: boolean }) {
  const p = plan.protein;
  const r = plan.routine;
  return (
    <section className="rise-card stack" aria-labelledby="plan-title">
      <div><div className="rise-label">This week</div><h2 className="rise-title" id="plan-title">{FOCUS[plan.focus]}</h2></div>
      <div className="plan-stats">
        {p && <div className="plan-stat"><span className="rise-label">Protein</span><span className="rise-num plan-stat__n">{p.low}–{p.high} g</span><span className="rise-caption">a day, about {p.perMeal} g a meal</span></div>}
        <div className="plan-stat"><span className="rise-label">Strength</span><span className="rise-num plan-stat__n">{plan.focus === 'rest' ? 'Light' : `${r.sessionsPerWeek}×`}</span><span className="rise-caption">{plan.focus === 'rest' ? 'only if you feel well' : `a week, ${r.minutes} min`}</span></div>
      </div>
      {p && <p className="rise-caption" style={{ margin: 0 }}>A palm-sized portion of chicken, fish, tofu or Greek yogurt is about 25–30 g. Protein target based on {p.basis}.</p>}
      <details open={open}>
        <summary className="rise-label" style={{ cursor: 'pointer' }}>Your strength routine</summary>
        <ul className="moves">
          {r.moves.map((m) => <li key={m.name}><b>{m.name}</b><span className="rise-num">{m.dose}</span>{m.note && <span className="rise-caption">{m.note}</span>}</li>)}
        </ul>
      </details>
      <details>
        <summary className="rise-label" style={{ cursor: 'pointer' }}>Day by day</summary>
        <ul className="days">{plan.days.map((d) => <li key={d.day}><span className="rise-label">{d.day}</span><span>{d.items.join(', ')}</span></li>)}</ul>
        <p className="rise-caption" style={{ margin: '8px 0 0' }}>Aim for {r.aerobicMinutesPerWeek} minutes of walking or other movement a week. Plan based on the 2025 GLP-1 nutrition advisory. Check with your care team before starting new exercise.</p>
      </details>
    </section>
  );
}
