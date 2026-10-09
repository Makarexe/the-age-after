import { useEffect, useState } from 'react';
import type { GameState, NewsItem, Progress, ServerConfig, ServerStatus } from '../../../shared/types';
import { api, errorText } from '../api';

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

export function PlayTab({ onError }: { onError: (err: unknown) => void }) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [game, setGame] = useState<GameState>({ state: 'idle' });
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    api.getServerConfig().then(setConfig).catch(() => {});
    api.getNews().then(setNews).catch(() => setNews([]));
    const ping = () => api.pingServer().then(setStatus).catch(() => setStatus({ online: false }));
    void ping();
    const timer = setInterval(ping, 30_000);
    const offProgress = api.onProgress(setProgress);
    const offGame = api.onGameState((s) => {
      setGame(s);
      if (s.state !== 'preparing') setProgress(null);
    });
    return () => {
      clearInterval(timer);
      offProgress();
      offGame();
    };
  }, []);

  const busy = game.state === 'preparing' || game.state === 'running';
  const play = async () => {
    setGame({ state: 'preparing' });
    try {
      await api.play();
    } catch (err) {
      setGame({ state: 'error', message: errorText(err) });
      onError(err);
    }
  };

  return (
    <div className="play-layout">
      <section className="card hero">
        <div className="hero-head">
          <div>
            <div className="eyebrow">Сервер</div>
            <h2>{config?.serverName ?? 'The Age After'}</h2>
            <ServerLine status={status} address={config?.serverAddress} />
          </div>
        </div>
        {status?.motd && <p className="motd">{status.motd}</p>}

        <div className="play-area">
          <button className="btn btn-play" disabled={busy} onClick={() => void play()}>
            {game.state === 'running' ? 'Игра запущена' : game.state === 'preparing' ? 'Готовим…' : 'Играть'}
          </button>
          {game.state === 'preparing' && <ProgressView progress={progress} />}
          {game.state === 'running' && <p className="muted">Удачной игры! Лаунчер можно свернуть.</p>}
          {game.state === 'error' && <p className="form-error pre">{game.message}</p>}
          {game.state === 'exited' && game.crashed && (
            <div className="crash">
              <p className="form-error">Игра завершилась с ошибкой (код {game.code}).</p>
              {game.crashReport && <pre className="crash-log">{game.crashReport.slice(-3000)}</pre>}
              <button className="btn btn-small" onClick={() => void api.openGameDir()}>
                Открыть папку игры
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="card news">
        <h3>Новости</h3>
        {news === null && <p className="muted">Загружаем…</p>}
        {news?.length === 0 && <p className="muted">Пока новостей нет.</p>}
        {news?.map((n) => (
          <article key={n.id} className="news-item">
            <div className="news-date">{dateFmt.format(new Date(n.createdAt))}</div>
            <h4>{n.title}</h4>
            <p>{n.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function ServerLine({ status, address }: { status: ServerStatus | null; address?: string }) {
  if (address === '') return <div className="server-line muted">Адрес сервера пока не задан администратором</div>;
  if (!status) return <div className="server-line muted">Проверяем сервер…</div>;
  if (!status.online) return <div className="server-line"><span className="dot dot-off" />Сервер недоступен</div>;
  return (
    <div className="server-line">
      <span className="dot dot-on" />
      Онлайн {status.players ? `${status.players.online} / ${status.players.max}` : ''}
      {status.latencyMs !== undefined && <span className="muted"> · {status.latencyMs} мс</span>}
      {address && <span className="muted"> · {address}</span>}
    </div>
  );
}

function ProgressView({ progress }: { progress: Progress | null }) {
  const pct = progress?.fraction != null ? Math.round(progress.fraction * 100) : null;
  return (
    <div className="progress">
      <div className="progress-label">
        <span>{progress?.label ?? 'Подготовка'}</span>
        {pct !== null && <span>{pct}%</span>}
      </div>
      <div className={pct === null ? 'progress-bar indeterminate' : 'progress-bar'}>
        <div style={{ width: `${pct ?? 30}%` }} />
      </div>
      {progress?.detail && <div className="progress-detail">{progress.detail}</div>}
    </div>
  );
}
