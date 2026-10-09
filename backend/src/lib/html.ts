export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f4f1ea;--fg:#1d1b18;--muted:#6b655c;--card:#fff;--accent:#7a4f1d;--border:#ddd5c8}
@media (prefers-color-scheme:dark){:root{--bg:#16140f;--fg:#ece6dc;--muted:#a59d90;--card:#211e18;--accent:#e0a458;--border:#3a342a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
main{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px;max-width:440px;width:100%}
h1{margin:0 0 12px;font-size:22px}p{margin:8px 0;color:var(--muted)}
label{display:block;margin:14px 0 4px;font-size:14px}
input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:inherit;font:inherit}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.brand{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}`;

/** Small standalone page for links from emails. `body` must already be escaped. */
export function page(title: string, body: string, brand: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main><div class="brand">${escapeHtml(brand)}</div><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}
