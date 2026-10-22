import { useState } from 'react';
import type { Me } from '../../../shared/types';
import { api, errorText } from '../api';

const MAX = 10000;

export function BackstoryTab({ me, onMe, onError }: { me: Me | null; onMe: (m: Me) => void; onError: (e: unknown) => void }) {
  const [text, setText] = useState(me?.backstory ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      onMe(await api.saveBackstory(text));
      setMessage('Квента сохранена. Её увидят администраторы.');
    } catch (err) {
      setError(errorText(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Квента персонажа</h2>
      <p className="muted">Расскажите, кто ваш персонаж и откуда он взялся. Текст хранится на сервере аккаунтов, его видят администраторы.</p>
      <textarea
        className="backstory"
        rows={14}
        maxLength={MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Имя, происхождение, характер, цели…"
        disabled={!me}
      />
      <p className="muted">{text.length} / {MAX}</p>
      {error && <p className="form-error">{error}</p>}
      {message && <p className="ok-text">{message}</p>}
      <button className="btn btn-primary" disabled={busy || !me || text === me.backstory} onClick={() => void save()}>
        Сохранить
      </button>
    </section>
  );
}
