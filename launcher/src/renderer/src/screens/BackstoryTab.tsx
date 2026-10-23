import { useState, type ChangeEvent } from 'react';
import type { Me } from '../../../shared/types';
import { api, errorText } from '../api';

const MAX = 10000;
const MAX_IMAGES = 5;
const STATUS_TEXT = {
  none: 'Квента не заполнена: без неё на сервер не пустят.',
  pending: 'Ждёт одобрения администратора.',
  approved: 'Одобрена.',
  rejected: 'Отклонена администратором.',
} as const;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Нужен PNG, JPEG или WebP.'));
    if (file.size > 2 * 1024 * 1024) return reject(new Error('Изображение больше 2 МБ.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*;base64,/, ''));
    reader.readAsDataURL(file);
  });
}

export function BackstoryTab({ me, onMe, onError }: { me: Me | null; onMe: (m: Me) => void; onError: (e: unknown) => void }) {
  const [text, setText] = useState(me?.backstory ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<Me>, done: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      onMe(await fn());
      setMessage(done);
    } catch (err) {
      setError(errorText(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(() => api.saveBackstory(text), 'Квента сохранена и отправлена на одобрение администратору.');
  const addImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await readBase64(file);
      await run(() => api.addBackstoryImage(data), 'Изображение добавлено, квента снова на рассмотрении.');
    } catch (err) {
      setError(errorText(err));
    }
  };
  const images = me?.backstoryImages ?? [];

  return (
    <section className="card">
      <h2>Квента персонажа</h2>
      <p className="muted">Расскажите, кто ваш персонаж и откуда он взялся. Текст хранится на сервере аккаунтов, его видят администраторы.</p>
      {me && (
        <p className={me.backstoryStatus === 'rejected' ? 'form-error' : 'muted'}>
          Статус: {STATUS_TEXT[me.backstoryStatus]}
          {me.backstoryStatus === 'rejected' && me.backstoryReview ? ` Причина: ${me.backstoryReview}` : ''}
        </p>
      )}
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

      <h3>Изображения</h3>
      <p className="muted">До {MAX_IMAGES} штук, PNG, JPEG или WebP до 2 МБ: референсы внешности, карта, герб. Администратор увидит их вместе с квентой.</p>
      {images.map((img, i) => (
        <div className="row" key={img.id}>
          <span>Изображение {i + 1} · {(img.size / 1024).toFixed(0)} КБ</span>
          <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => void run(() => api.deleteBackstoryImage(img.id), 'Изображение удалено.')}>
            Удалить
          </button>
        </div>
      ))}
      {images.length < MAX_IMAGES && (
        <label className="btn file-btn">
          Добавить изображение…
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void addImage(e)} hidden />
        </label>
      )}
    </section>
  );
}
