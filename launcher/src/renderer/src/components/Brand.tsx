export function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={large ? 'brand brand-large' : 'brand'}>
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M16 8 23 12v8l-7 4-7-4v-8z" fill="currentColor" opacity=".85" />
      </svg>
      <span>The Age After</span>
    </div>
  );
}
