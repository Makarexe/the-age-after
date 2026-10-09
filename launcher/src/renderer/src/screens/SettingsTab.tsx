import { useState, type FormEvent } from 'react';
import type { LauncherState, Settings } from '../../../shared/types';
import { api, errorText } from '../api';
import { Field } from '../components/Field';

interface Props {
  state: LauncherState;
  onState: (s: LauncherState) => void;
  onError: (e: unknown) => void;
}

const gb = (mb: number) => (mb / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 });

export function SettingsTab({ state, onState, onError }: Props) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const s = state.settings;
  const maxMemory = Math.max(2048, Math.floor((state.totalMemoryMb - 1536) / 512) * 512);

  const save = async (patch: Partial<Settings>, done = '') => {
    setError('');
    try {
      const settings = await api.saveSettings(patch);
      onState({ ...state, settings, apiRoot: settings.apiRoot || state.defaultApiRoot });
      setNotice(done);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="settings">
      <section className="card">
        <h3>Память для игры</h3>
        <div className="memory">
          <input
            type="range"
            min={2048}
            max={maxMemory}
            step={512}
            value={Math.min(s.memoryMb, maxMemory)}
            onChange={(e) => onState({ ...state, settings: { ...s, memoryMb: Number(e.target.value) } })}
            onMouseUp={(e) => void save({ memoryMb: Number((e.target as HTMLInputElement).value) })}
            onKeyUp={(e) => void save({ memoryMb: Number((e.target as HTMLInputElement).value) })}
          />
          <span className="memory-value">{gb(s.memoryMb)} ГБ</span>
        </div>
        <p className="muted">
          Всего в компьютере {gb(state.totalMemoryMb)} ГБ. Для этой сборки нужно 6–8 ГБ; больше обычно не ускоряет игру.
        </p>
      </section>

      <section className="card">
        <h3>Папка игры</h3>
        <div className="path">{s.gameDir}</div>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              const dir = await api.chooseGameDir();
              if (dir) await save({ gameDir: dir }, 'Папка изменена. При запуске игра установится туда заново.');
            }}
          >
            Изменить…
          </button>
          <button className="btn btn-ghost" onClick={() => void api.openGameDir()}>
            Открыть папку
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.hideWhilePlaying} onChange={(e) => void save({ hideWhilePlaying: e.target.checked })} />
          Скрывать лаунчер во время игры и закрывать после выхода
        </label>
      </section>

      <section className="card">
        <h3>Если игра не запускается</h3>
        <p className="muted">Лаунчер заново проверит Java, Minecraft, NeoForge, все моды и вернёт настройки сборки (config). Сохранения и скриншоты не трогаются.</p>
        <div className="row">
          <button
            className="btn"
            onClick={() =>
              void api
                .repair()
                .then(() => setNotice('Готово: при следующем нажатии «Играть» все файлы будут проверены заново.'))
                .catch((err) => setError(errorText(err)))
            }
          >
            Проверить файлы
          </button>
          <button className="btn btn-ghost" onClick={() => void api.openLogs()}>
            Логи лаунчера
          </button>
        </div>
      </section>

      <ChangePassword onError={onError} />

      <section className="card">
        <details>
          <summary>Дополнительно</summary>
          <ApiRoot state={state} onSave={(apiRoot) => save({ apiRoot }, 'Адрес сервера аккаунтов сохранён.')} />
        </details>
        <p className="muted small">Версия лаунчера {state.version}</p>
      </section>

      {(notice || error) && <div className={error ? 'toast toast-error' : 'toast'} onClick={() => { setNotice(''); setError(''); }}>{error || notice}</div>}
    </div>
  );
}

function ApiRoot({ state, onSave }: { state: LauncherState; onSave: (v: string) => void }) {
  const [value, setValue] = useState(state.settings.apiRoot);
  return (
    <form
      className="api-root"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <Field
        label="Адрес сервера аккаунтов"
        placeholder={state.defaultApiRoot}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        hint="Менять, только если попросил администратор. Пусто — адрес по умолчанию."
      />
      <button className="btn btn-small">Сохранить</button>
    </form>
  );
}

function ChangePassword({ onError }: { onError: (e: unknown) => void }) {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      await api.changePassword(oldPassword, newPassword);
      setOld('');
      setNew('');
      setMsg('Пароль изменён. На других устройствах нужно будет войти заново.');
    } catch (error) {
      setErr(errorText(error));
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h3>Пароль</h3>
      <form className="password-form" onSubmit={(e) => void submit(e)}>
        <Field label="Текущий пароль" type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} required autoComplete="current-password" />
        <Field label="Новый пароль" type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} required minLength={8} autoComplete="new-password" />
        <button className="btn" disabled={busy}>
          Сменить пароль
        </button>
      </form>
      {msg && <p className="ok-text">{msg}</p>}
      {err && <p className="form-error">{err}</p>}
    </section>
  );
}
