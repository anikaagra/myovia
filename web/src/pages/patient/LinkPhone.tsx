import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, ErrorNote } from '../../components/Screen';
import { api } from '../../lib/api';

/** Moves an existing patient to a new phone with a one-time code from their care team. */
export function LinkPhone() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return setErr('Enter the 6-digit code from your care team.');
    setBusy(true);
    try { await api.linkPhone(code); nav('/', { replace: true }); }
    catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Screen back={{ to: '/', label: 'Back' }}>
      <div className="stack"><div className="rise-label">New phone</div><h1 className="display">Link this phone to Myovia</h1></div>
      <p className="rise-body-lg">Ask your care team for a link code. It's 6 digits and lasts 30 minutes. Your past checks come with you.</p>
      <form className="stack" onSubmit={go}>
        <div className="field"><label className="rise-label" htmlFor="code">Link code</label>
          <input id="code" className="rise-num code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={(e) => { setErr(null); setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); }} /></div>
        <ErrorNote message={err} />
        <button className="rise-btn rise-btn--primary rise-btn--block" disabled={busy} type="submit">{busy ? 'Linking…' : 'Link this phone'}</button>
      </form>
    </Screen>
  );
}
