import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LogoMark } from './Logo';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/play', label: 'Play' },
  { to: '/learn', label: 'Learn' },
  { to: '/train', label: 'Train' },
  { to: '/review', label: 'Review' },
  { to: '/insights', label: 'Insights' },
  { to: '/openings', label: 'Openings' },
  { to: '/models', label: 'Models' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const [open, setOpen] = useState(false);

  // The Android back button should close the drawer instead of leaving the app.
  useEffect(() => {
    const cap = (globalThis as { Capacitor?: { Plugins?: { App?: { addListener: (e: string, cb: () => void) => Promise<{ remove: () => void }> } } } }).Capacitor;
    const app = cap?.Plugins?.App;
    if (!app) return;
    let handle: { remove: () => void } | null = null;
    void app.addListener('backButton', () => {
      if (open) setOpen(false);
      else window.history.back();
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, [open]);

  return (
    <div className="min-h-screen bg-[#262421] text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#262421]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <NavLink to="/" className="flex items-center gap-2">
            <LogoMark />
          </NavLink>
          <nav className="ml-4 hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm transition ${
                    isActive ? 'bg-white/10 font-medium text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            className="ml-auto rounded-lg p-2 text-slate-200 md:hidden"
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {open && (
          <nav className="border-t border-white/10 bg-[#312e2b] px-3 py-2 md:hidden">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-3 text-base ${isActive ? 'bg-white/10 text-white' : 'text-slate-300'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-3 pb-28 pt-4 md:pb-12">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#312e2b]/95 backdrop-blur md:hidden">
        <div className="flex">
          {NAV.slice(0, 5).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex-1 py-3 text-center text-[11px] ${isActive ? 'text-[#ffc934]' : 'text-slate-400'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
    </div>
  );
}
