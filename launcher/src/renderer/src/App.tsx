import { useEffect, useState } from 'react';
import type { LauncherState, Profile } from '../../shared/types';
import { api, errorText } from './api';
import { AuthScreen } from './screens/AuthScreen';
import { MainScreen } from './screens/MainScreen';

export function App() {
  const [state, setState] = useState<LauncherState | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getState()
      .then((s) => {
        setState(s);
        setProfile(s.profile);
      })
      .catch((err) => setError(errorText(err)));
  }, []);

  if (error) return <div className="splash error-text">{error}</div>;
  if (!state) return <div className="splash">The Age After</div>;
  if (!profile) return <AuthScreen onLogin={setProfile} />;
  return <MainScreen state={state} profile={profile} onState={setState} onLogout={() => setProfile(null)} />;
}
