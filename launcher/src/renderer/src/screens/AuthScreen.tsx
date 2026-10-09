import { useState, type FormEvent } from 'react';
import type { Profile, RegisterResult } from '../../../shared/types';
import { api, errorText } from '../api';
import { Brand } from '../components/Brand';
import { Field } from '../components/Field';

type Mode = 'login' | 'register' | 'forgot';

export function AuthScreen({ onLogin }: { onLogin: (p: Profile) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [registered, setRegistered] = useState<{ result: RegisterResult; email: string; username: string } | null>(null);

  return (
    <div className="auth">
      <div className="auth-art">
        <Brand large />
        <p className="auth-tagline">Модовый сервер для своих. Войдите — лаунчер сам поставит Java, Minecraft, NeoForge и все моды.</p>
      </div>
      <div className="auth-panel">
        {registered ? (
          <Registered {...registered} onBack={() => { setRegistered(null); setMode('login'); }} />
        ) : mode === 'login' ? (
          <LoginForm onLogin={onLogin} onMode={setMode} />
        ) : mode === 'register' ? (
          <RegisterForm onDone={setRegistered} onMode={setMode} />
        ) : (
          <ForgotForm onMode={setMode} />
        )}
      </div>
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function LoginForm({ onLogin, onMode }: { onLogin: (p: Profile) => void; onMode: (m: Mode) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [resent, setResent] = useState(false);
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => onLogin(await api.login(login.trim(), password)));
  };
  const needsEmail = /почту/i.test(error);
  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>Вход</h1>
      <Field label="Ник или почта" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus required autoComplete="username" />
      <Field label="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
      {error && <p className="form-error">{error}</p>}
      {needsEmail && (
        <button
          type="button"
          className="link"
          disabled={resent}
          onClick={() => void api.resendVerification(login.trim()).then(() => setResent(true))}
        >
          {resent ? 'Письмо отправлено ещё раз' : 'Отправить письмо ещё раз'}
        </button>
      )}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Входим…' : 'Войти'}
      </button>
      <div className="auth-links">
        <button type="button" className="link" onClick={() => onMode('register')}>
          Регистрация
        </button>
        <button type="button" className="link" onClick={() => onMode('forgot')}>
          Забыли пароль?
        </button>
      </div>
    </form>
  );
}

function RegisterForm({
  onDone,
  onMode,
}: {
  onDone: (r: { result: RegisterResult; email: string; username: string }) => void;
  onMode: (m: Mode) => void;
}) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const { busy, error, run } = useSubmit();
  const nickOk = /^[A-Za-z0-9_]{3,16}$/.test(username);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (password !== password2) throw new Error('Пароли не совпадают.');
      const result = await api.register(username, email.trim(), password);
      onDone({ result, email: email.trim(), username });
    });
  };
  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>Регистрация</h1>
      <Field
        label="Ник в игре"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        hint={username && !nickOk ? '3–16 символов: латиница, цифры и _' : 'Тот же ник, под которым вы уже играли на сервере — тогда сохранятся вещи и прогресс.'}
        autoFocus
        required
        maxLength={16}
      />
      <Field label="Почта" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      <Field label="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" hint="Не короче 8 символов" />
      <Field label="Пароль ещё раз" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} required minLength={8} autoComplete="new-password" />
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy || !nickOk}>
        {busy ? 'Отправляем…' : 'Зарегистрироваться'}
      </button>
      <div className="auth-links">
        <button type="button" className="link" onClick={() => onMode('login')}>
          Уже есть аккаунт
        </button>
      </div>
    </form>
  );
}

function Registered({ result, email, username, onBack }: { result: RegisterResult; email: string; username: string; onBack: () => void }) {
  const [resent, setResent] = useState(false);
  return (
    <div className="auth-form">
      {result.status === 'pending_email' ? (
        <>
          <h1>Подтвердите почту</h1>
          <p className="muted">
            Мы отправили письмо на <b>{email}</b>. Откройте ссылку из письма — после этого заявку рассмотрит администратор.
          </p>
          {!result.mailSent && <p className="form-error">Письмо пока не ушло — попробуйте отправить ещё раз чуть позже.</p>}
          <button className="btn" disabled={resent} onClick={() => void api.resendVerification(username).then(() => setResent(true))}>
            {resent ? 'Отправили ещё раз' : 'Отправить письмо ещё раз'}
          </button>
        </>
      ) : (
        <>
          <h1>Заявка отправлена</h1>
          <p className="muted">Администратор рассмотрит её в ближайшее время. После одобрения войдите под ником <b>{username}</b>.</p>
        </>
      )}
      <button className="btn btn-primary" onClick={onBack}>
        К входу
      </button>
    </div>
  );
}

function ForgotForm({ onMode }: { onMode: (m: Mode) => void }) {
  const [login, setLogin] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.forgotPassword(login.trim());
      setSent(true);
    });
  };
  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>Сброс пароля</h1>
      {sent ? (
        <p className="muted">Если такой аккаунт есть, на его почту ушло письмо со ссылкой. Ссылка действует 1 час.</p>
      ) : (
        <>
          <p className="muted">Укажите ник или почту — пришлём ссылку для нового пароля.</p>
          <Field label="Ник или почта" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus required />
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Отправляем…' : 'Прислать ссылку'}
          </button>
        </>
      )}
      <div className="auth-links">
        <button type="button" className="link" onClick={() => onMode('login')}>
          Назад ко входу
        </button>
      </div>
    </form>
  );
}
