import { escapeHtml } from '../lib/html.js';

/** Single-page admin panel. All user data is inserted with textContent, never innerHTML. */
export function adminPage(serverName: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Админка — ${escapeHtml(serverName)}</title>
<style>
:root{color-scheme:light dark;--bg:#f4f1ea;--fg:#1d1b18;--muted:#6b655c;--card:#fff;--accent:#7a4f1d;--border:#ddd5c8;--ok:#2f7d32;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#16140f;--fg:#ece6dc;--muted:#a59d90;--card:#211e18;--accent:#e0a458;--border:#3a342a;--ok:#7bc47f;--bad:#f2867d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;align-items:center;gap:16px;padding:14px 20px;border-bottom:1px solid var(--border);background:var(--card);flex-wrap:wrap}
header b{color:var(--accent);letter-spacing:.06em;text-transform:uppercase;font-size:13px}
nav{display:flex;gap:4px;flex-wrap:wrap}nav button{background:none;color:var(--fg);border:1px solid transparent;padding:6px 12px;border-radius:6px;cursor:pointer;font:inherit}
nav button.on{border-color:var(--border);background:var(--bg)}
.sp{flex:1}main{padding:20px;max-width:1100px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:16px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--border);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.muted{color:var(--muted);font-size:13px}.st{font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--border);white-space:nowrap}
.st.active{color:var(--ok)}.st.banned,.st.rejected{color:var(--bad)}
.acts{display:flex;gap:6px;flex-wrap:wrap}
button.a{padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--fg);cursor:pointer;font:inherit;font-size:13px}
button.a.p{background:var(--accent);border-color:var(--accent);color:#fff}button.a.d{color:var(--bad)}
input,textarea,select{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;background:transparent;color:inherit;font:inherit;margin:4px 0 12px}
textarea{min-height:120px;resize:vertical}
#login{max-width:380px;margin:12vh auto}#err{color:var(--bad);min-height:1.4em}
h3{margin:0 0 12px}.scroll{overflow-x:auto}.pre{white-space:pre-wrap}
</style></head><body>
<div id="login" class="card" hidden>
  <b style="color:var(--accent)">${escapeHtml(serverName)}</b><h2 style="margin:6px 0 14px">Вход в админку</h2>
  <form id="lf"><label>Ник или почта<input name="login" required autocomplete="username"></label>
  <label>Пароль<input name="password" type="password" required autocomplete="current-password"></label>
  <button class="a p" style="width:100%;padding:10px">Войти</button></form><p id="err"></p>
</div>
<div id="app" hidden>
<header><b>${escapeHtml(serverName)}</b>
<nav id="tabs"><button data-t="pending">Заявки</button><button data-t="users">Игроки</button><button data-t="news">Новости</button><button data-t="audit">Журнал</button></nav>
<span class="sp"></span><span class="muted" id="me"></span><button class="a" id="logout">Выйти</button></header>
<main id="view"></main></div>
<script>
(() => {
  const STATUS = {pending_email:'ждёт почту',pending_approval:'ждёт одобрения',active:'активен',rejected:'отклонён',banned:'забанен'};
  const ACTION = {approve:'Одобрить',reject:'Отклонить',ban:'Бан',unban:'Разбан',delete:'Удалить'};
  const AUDIT = {approve:'одобрил',reject:'отклонил',ban:'забанил',unban:'разбанил',delete:'удалил',news_create:'добавил новость',news_delete:'удалил новость'};
  const ALLOWED = {approve:['pending_email','pending_approval','rejected'],reject:['pending_email','pending_approval'],ban:['pending_email','pending_approval','active','rejected'],unban:['banned'],delete:['pending_email','pending_approval','rejected']};
  let token = sessionStorage.getItem('adminToken');
  let tab = 'pending';
  const $ = (s) => document.querySelector(s);
  const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e[k] = v; } for (const c of kids) if (c != null) e.append(c); return e; };
  const fmt = (iso) => iso ? new Date(iso).toLocaleString('ru-RU', {dateStyle:'short', timeStyle:'short'}) : '—';

  async function api(method, path, body) {
    const res = await fetch('/admin/api' + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { logout(); throw new Error('Сессия истекла, войдите снова.'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.errorMessage || ('Ошибка ' + res.status));
    return data;
  }
  function logout() { token = null; sessionStorage.removeItem('adminToken'); $('#app').hidden = true; $('#login').hidden = false; }

  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#err').textContent = '';
    const f = new FormData(e.target);
    try { const r = await api('POST', '/login', { login: f.get('login'), password: f.get('password') }); token = r.token; sessionStorage.setItem('adminToken', token); start(r.username); }
    catch (err) { $('#err').textContent = err.message; }
  });
  $('#logout').addEventListener('click', async () => { try { await api('POST', '/logout'); } catch {} logout(); });
  $('#tabs').addEventListener('click', (e) => { const t = e.target.dataset.t; if (t) { tab = t; render(); } });

  function start(name) { $('#login').hidden = true; $('#app').hidden = false; $('#me').textContent = name; render(); }

  async function act(u, action) {
    let reason;
    if (action === 'ban' || action === 'reject') { reason = prompt(ACTION[action] + ' ' + u.username + '. Причина (необязательно):'); if (reason === null) return; }
    else if (action === 'delete' && !confirm('Удалить заявку ' + u.username + '? Ник освободится.')) return;
    try { await api('POST', '/users/' + u.id + '/' + action, { reason: reason || undefined }); render(); } catch (err) { alert(err.message); }
  }

  function usersTable(list, empty) {
    if (!list.length) return el('p', { class: 'muted', textContent: empty });
    const rows = list.map((u) => el('tr', {},
      el('td', {}, el('div', { textContent: u.username + (u.isAdmin ? ' ★' : '') }), el('div', { class: 'muted', textContent: u.email })),
      el('td', {}, el('span', { class: 'st ' + u.status, textContent: STATUS[u.status] || u.status }), u.statusReason ? el('div', { class: 'muted', textContent: u.statusReason }) : null),
      el('td', { class: 'muted', textContent: fmt(u.createdAt) }),
      el('td', {}, el('div', { class: 'acts' }, ...Object.keys(ACTION).filter((a) => ALLOWED[a].includes(u.status) && !u.isAdmin).map((a) =>
        el('button', { class: 'a' + (a === 'approve' || a === 'unban' ? ' p' : a === 'ban' || a === 'delete' ? ' d' : ''), textContent: ACTION[a], onclick: () => act(u, a) })))),
    ));
    return el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Игрок', 'Статус', 'Создан', ''].map((h) => el('th', { textContent: h })))), el('tbody', {}, ...rows)));
  }

  async function render() {
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.t === tab);
    const view = $('#view'); view.replaceChildren(el('p', { class: 'muted', textContent: 'Загрузка…' }));
    try {
      if (tab === 'pending' || tab === 'users') {
        const all = await api('GET', '/users');
        if (tab === 'pending') {
          const waiting = all.filter((u) => u.status === 'pending_approval');
          const noMail = all.filter((u) => u.status === 'pending_email');
          view.replaceChildren(
            el('div', { class: 'card' }, el('h3', { textContent: 'Ждут одобрения (' + waiting.length + ')' }), usersTable(waiting, 'Новых заявок нет.')),
            el('div', { class: 'card' }, el('h3', { textContent: 'Не подтвердили почту (' + noMail.length + ')' }), usersTable(noMail, 'Таких нет.')));
        } else {
          view.replaceChildren(el('div', { class: 'card' }, el('h3', { textContent: 'Все игроки (' + all.length + ')' }), usersTable(all, 'Пока никого.')));
        }
      } else if (tab === 'news') {
        const list = await api('GET', '/news');
        const form = el('form', {}, el('label', {}, 'Заголовок', el('input', { name: 'title', required: true, maxLength: 200 })), el('label', {}, 'Текст', el('textarea', { name: 'body', required: true, maxLength: 5000 })), el('button', { class: 'a p', textContent: 'Опубликовать' }));
        form.addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(form); try { await api('POST', '/news', { title: f.get('title'), body: f.get('body') }); render(); } catch (err) { alert(err.message); } });
        view.replaceChildren(el('div', { class: 'card' }, el('h3', { textContent: 'Новая новость' }), form),
          ...list.map((n) => el('div', { class: 'card' }, el('div', { class: 'muted', textContent: fmt(n.createdAt) }), el('h3', { textContent: n.title, style: 'margin:4px 0' }), el('div', { class: 'pre', textContent: n.body }),
            el('p', {}, el('button', { class: 'a d', textContent: 'Удалить', onclick: async () => { if (confirm('Удалить новость?')) { try { await api('DELETE', '/news/' + n.id); render(); } catch (err) { alert(err.message); } } } })))));
      } else {
        const list = await api('GET', '/audit');
        view.replaceChildren(el('div', { class: 'card' }, el('h3', { textContent: 'Журнал действий' }), list.length ? el('div', { class: 'scroll' }, el('table', {}, el('tbody', {}, ...list.map((r) => el('tr', {},
          el('td', { class: 'muted', textContent: fmt(r.createdAt) }),
          el('td', { textContent: (r.admin || '?') + ' ' + (AUDIT[r.action] || r.action) + ' ' + ((r.details && (r.details.username || r.details.title)) || '') }),
          el('td', { class: 'muted', textContent: (r.details && r.details.reason) || '' })))))) : el('p', { class: 'muted', textContent: 'Пусто.' })));
      }
    } catch (err) { view.replaceChildren(el('p', { id: 'err', textContent: err.message })); }
  }

  if (token) api('GET', '/me').then((r) => start(r.username)).catch(() => logout()); else logout();
})();
</script></body></html>`;
}
