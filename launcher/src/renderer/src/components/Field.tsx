import type { InputHTMLAttributes } from 'react';

export function Field({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input {...input} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
