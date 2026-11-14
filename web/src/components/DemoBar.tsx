import { Link, useNavigate } from 'react-router-dom';
import { demoReset, demoSignInAs } from '../lib/demoApi';
import { session } from '../lib/session';

/** Shown only in demo builds. */
export function DemoBar() {
  const nav = useNavigate();
  return (
    <div className="demobar" role="note">
      <span><b>Demo.</b> Example data, saved only on this device.</span>
      <span className="demobar__links">
        <button type="button" onClick={() => { demoSignInAs('demo-linda'); nav('/', { replace: true }); }}>Example patient</button>
        <Link to="/provider">Care team</Link>
        <button type="button" onClick={() => { demoReset(); session.clear(); nav('/', { replace: true }); }}>Reset</button>
      </span>
    </div>
  );
}
