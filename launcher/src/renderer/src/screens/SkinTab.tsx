import { useState, type ChangeEvent } from 'react';
import type { Me } from '../../../shared/types';
import { api, errorText } from '../api';
import { SkinView } from '../components/SkinView';

function readPng(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (file.type !== 'image/png') return reject(new Error('Нужен PNG-файл.'));
    if (file.size > 64 * 1024) return reject(new Error('Файл больше 64 КБ — это точно скин?'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => resolve({ dataUrl, width: img.width, height: img.height });
      img.onerror = () => reject(new Error('Файл повреждён.'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function SkinTab({ me, onMe, onError }: { me: Me | null; onMe: (m: Me) => void; onError: (e: unknown) => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [model, setModel] = useState<'classic' | 'slim'>(me?.skin?.model ?? 'classic');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setMessage('');
    try {
      const png = await readPng(file);
      if (png.width !== 64 || (png.height !== 64 && png.height !== 32)) throw new Error('Скин должен быть 64×64 или 64×32 пикселя.');
      setPending(png.dataUrl);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const run = async (fn: () => Promise<Me>, done: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      onMe(await fn());
      setPending(null);
      setMessage(done);
    } catch (err) {
      setError(errorText(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const shown = pending ?? me?.skin?.url ?? null;
  const dirty = pending !== null || (me?.skin && me.skin.model !== model);

  return (
    <div className="skin-layout">
      <section className="card skin-preview">
        {shown ? <SkinView src={shown} slim={model === 'slim'} scale={11} /> : <div className="skin-empty">Скин не загружен — в игре будет стандартный.</div>}
      </section>
      <section className="card skin-controls">
        <h2>Скин</h2>
        <p className="muted">PNG 64×64 или 64×32. Скин виден всем игрокам на сервере.</p>
        <label className="btn file-btn">
          Выбрать файл…
          <input type="file" accept="image/png" onChange={(e) => void pick(e)} hidden />
        </label>
        <div className="segmented" role="radiogroup" aria-label="Модель">
          <button className={model === 'classic' ? 'on' : ''} onClick={() => setModel('classic')}>
            Обычная (Стив)
          </button>
          <button className={model === 'slim' ? 'on' : ''} onClick={() => setModel('slim')}>
            Тонкие руки (Алекс)
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {message && <p className="ok-text">{message}</p>}
        <div className="row">
          <button
            className="btn btn-primary"
            disabled={busy || !dirty}
            onClick={() => {
              const png = (pending ?? '').replace(/^data:image\/png;base64,/, '');
              if (pending) void run(() => api.uploadSkin(png, model), 'Скин сохранён. В игре он появится после перезахода на сервер.');
              else void run(() => api.setSkinModel(model), 'Модель скина изменена.');
            }}
          >
            Сохранить
          </button>
          {me?.skin && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => void run(() => api.resetSkin(), 'Скин сброшен.')}>
              Сбросить
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
