import { useEffect, useState } from 'react';
import type { LauncherState, OptionalModInfo, Settings } from '../../../shared/types';
import { api, errorText } from '../api';

interface Props {
  state: LauncherState;
  onSave: (patch: Partial<Settings>, done?: string) => Promise<void>;
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 });

export function OptionalMods({ state, onSave }: Props) {
  const [mods, setMods] = useState<OptionalModInfo[] | null>(null);
  const [error, setError] = useState('');
  const enabled = state.settings.optionalMods;

  useEffect(() => {
    api.getOptionalMods().then(setMods).catch((err) => setError(errorText(err)));
  }, []);

  const toggle = (id: string, on: boolean) =>
    onSave(
      { optionalMods: on ? [...enabled, id] : enabled.filter((x) => x !== id) },
      'Сохранено. Моды скачаются или удалятся при следующем нажатии «Играть».',
    );

  return (
    <section className="card">
      <h3>Опциональные моды</h3>
      <p className="muted">Необязательные клиентские моды: для входа на сервер они не нужны. Включайте, что хотите.</p>
      {error && <p className="form-error">{error}</p>}
      {!error && mods === null && <p className="muted">Загрузка списка…</p>}
      {mods?.length === 0 && <p className="muted">Пока в сборке нет опциональных модов.</p>}
      {mods?.map((m) => (
        <label className="check" key={m.id}>
          <input type="checkbox" checked={enabled.includes(m.id)} onChange={(e) => void toggle(m.id, e.target.checked)} />
          <span>
            <b>{m.name}</b> · {mb(m.sizeBytes)} МБ
            <br />
            <span className="muted">
              {m.description}
              {m.needs.length > 0 && ` Установится вместе с: ${m.needs.join(', ')}.`}
            </span>
          </span>
        </label>
      ))}
    </section>
  );
}
