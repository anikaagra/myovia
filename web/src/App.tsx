import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { IS_DEMO } from './lib/api';
import { DemoBar } from './components/DemoBar';
import { session } from './lib/session';
import { Welcome } from './pages/patient/Welcome';
import { Intake } from './pages/patient/Intake';
import { LinkPhone } from './pages/patient/LinkPhone';
import { Home } from './pages/patient/Home';
import { CheckFlow } from './pages/patient/CheckFlow';
import { Result } from './pages/patient/Result';
import { PatientSettings } from './pages/patient/PatientSettings';
import { ProviderLogin } from './pages/provider/ProviderLogin';
import { ProviderList } from './pages/provider/ProviderList';
import { ProviderPatient } from './pages/provider/ProviderPatient';
import { ProviderSettings } from './pages/provider/ProviderSettings';

export function App() {
  useLocation(); // re-render on navigation so the session check stays current
  const linked = Boolean(session.get());
  return (
    <>
    {IS_DEMO && <DemoBar />}
    <Routes>
      <Route path="/" element={linked ? <Home /> : <Welcome />} />
      <Route path="/setup" element={<Intake />} />
      <Route path="/link" element={<LinkPhone />} />
      <Route path="/check" element={linked ? <CheckFlow /> : <Navigate to="/" replace />} />
      <Route path="/result/:checkId" element={linked ? <Result /> : <Navigate to="/" replace />} />
      <Route path="/settings" element={linked ? <PatientSettings /> : <Navigate to="/" replace />} />
      <Route path="/provider" element={<ProviderLogin />} />
      <Route path="/provider/list" element={<ProviderList />} />
      <Route path="/provider/patients/:id" element={<ProviderPatient />} />
      <Route path="/provider/settings" element={<ProviderSettings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
