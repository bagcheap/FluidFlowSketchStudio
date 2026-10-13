export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path d="M4.5 9.2c0-1.6 1.2-2.7 2.8-2.7h6.6c1.6.1 2.6 1.2 2.6 2.8v12.9c0 1.6-1.1 2.6-2.7 2.7H7.2c-1.6 0-2.7-1.2-2.7-2.8z" fill="var(--logo-fill)" stroke="var(--fg)" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M17.6 15.8c3-.4 6.1-.2 9.2.2" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M23.4 12.4l3.6 3.7-3.8 3.4" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
