import { useEffect, useState } from 'react';
import type { LauncherState, Me, Profile, UpdateState } from '../../../shared/types';
import { api, isSessionExpired } from '../api';
import { Brand } from '../components/Brand';
import { SkinView } from '../components/SkinView';
import { PlayTab } from './PlayTab';
import { SettingsTab } from './SettingsTab';
import { SkinTab } from './SkinTab';

type Tab = 'play' | 'skin' | 'settings';
const TABS: [Tab, string][] = [
  ['play', 'Играть'],
  ['skin', 'Скин'],
  ['settings', 'Настройки'],
];

interface Props {
  state: LauncherState;
  profile: Profile;
  onState: (s: LauncherState) => void;
  onLogout: () => void;
}

export function MainScreen({ state, profile, onState, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('play');
  const [me, setMe] = useState<Me | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ state: 'none' });

  const handleError = (err: unknown) => {
    if (isSessionExpired(err)) onLogout();
  };

  useEffect(() => {
    api.me().then(setMe).catch(handleError);
    return api.onUpdate(setUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    await api.logout().catch(() => {});
    onLogout();
  };

  return (
    <div className="main">
      <header className="topbar">
        <Brand />
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="user">
          <span className="avatar">
            {me?.skin ? <SkinView src={me.skin.url} slim={false} headOnly scale={3} /> : profile.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="user-name">{profile.name}</span>
          <button className="btn btn-ghost btn-small" onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </header>

      {update.state === 'ready' && (
        <div className="banner">
          Готово обновление лаунчера {update.version}.
          <button className="btn btn-small btn-primary" onClick={() => void api.installUpdate()}>
            Перезапустить
          </button>
        </div>
      )}
      {update.state === 'downloading' && <div className="banner muted">Скачиваем обновление лаунчера… {update.percent}%</div>}

      <main className="content">
        <div hidden={tab !== 'play'}>
          <PlayTab onError={handleError} />
        </div>
        {tab === 'skin' && <SkinTab me={me} onMe={setMe} onError={handleError} />}
        {tab === 'settings' && <SettingsTab state={state} onState={onState} onError={handleError} />}
      </main>
    </div>
  );
}
