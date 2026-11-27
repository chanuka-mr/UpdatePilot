'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Bell, CircleHelp, Download, Grip, History, LayoutGrid, LogOut, Menu, Search, Settings, Shield, ShieldCheck, X } from 'lucide-react';
import { AgentStatusProvider, useAgentStatus } from '../providers/agent-status-provider';

const links = [
  ['/', 'Overview', LayoutGrid],
  ['/applications', 'Applications', Grip],
  ['/updates', 'Updates', Download],
  ['/security', 'Security Insights', Shield],
  ['/history', 'History', History],
  ['/settings', 'Settings', Settings],
] as const;

type UserInfo = { id: string; email: string; name: string | null; role: string };

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === '/login') {
    return <>{children}</>;
  }
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}

function AuthenticatedShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async res => {
        if (!active) return;
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as { user?: UserInfo };
          if (data.user) setUser(data.user);
        }
        setChecked(true);
      })
      .catch(() => {
        if (active) setChecked(true);
      });
    return () => {
      active = false;
    };
  }, [router]);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted">
        Checking session...
      </div>
    );
  }

  return (
    <AgentStatusProvider>
      <AppShellContent user={user}>{children}</AppShellContent>
    </AgentStatusProvider>
  );
}

function AppShellContent({ children, user }: { children: ReactNode; user: UserInfo | null }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState('');
  const [search, setSearch] = useState('');
  const { status, loading, error } = useAgentStatus();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const agentLabel = !status.paired ? 'Agent not paired' : status.online ? (status.activeJob ? 'Agent busy' : 'Agent online') : 'Agent offline';
  const agentDot = error || !status.paired ? 'bg-slate-400' : status.online ? (status.activeJob ? 'bg-amber-500' : 'bg-green-500') : 'bg-red-500';
  const initials = status.deviceName.replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 2).toUpperCase() || 'PC';

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      <button aria-label="Close navigation" hidden={!open} onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/30 md:hidden" />
      <aside className={`fixed inset-y-0 left-0 z-50 w-60 bg-white shadow-sm transition-transform md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <Link href="/" className="flex h-16 items-center gap-2 px-4 text-base font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-white"><ShieldCheck size={22} /></span>UpdatePilot
        </Link>
        <nav aria-label="Main navigation" className="space-y-1 p-2">
          {links.map(([href, label, Icon]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={active(href) ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${active(href) ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-inset'}`}>
              <Icon size={20} />{label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-0 w-full space-y-3 border-t border-slate-100 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{loading ? 'Loading device...' : status.deviceName}</p>
              <p className="truncate text-[11px] text-muted">{user ? user.email : 'Windows device'}</p>
            </div>
          </div>
          {user && (
            <button type="button" onClick={() => void logout()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-inset px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground">
              <LogOut size={14} />Sign out
            </button>
          )}
        </div>
      </aside>
      <div className="md:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-100 bg-background/95 px-4 backdrop-blur-xl">
          <button className="icon-button md:invisible" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={20} /></button>
          <div className="relative flex min-w-0 items-center gap-2">
            <form onSubmit={event => { event.preventDefault(); window.location.assign(`/applications?q=${encodeURIComponent(search)}`); }} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2">
              <Search size={17} /><input aria-label="Search all applications" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search applications" className="w-24 bg-transparent text-xs outline-none sm:w-40" />
            </form>
            <button aria-label="Notifications" className="icon-button" onClick={() => setPanel(panel === 'Notifications' ? '' : 'Notifications')}><Bell size={20} /></button>
            <button aria-label="Help" className="icon-button" onClick={() => setPanel(panel === 'Help' ? '' : 'Help')}><CircleHelp size={20} /></button>
            {panel && (
              <div className="absolute right-0 top-12 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
                <div className="flex justify-between font-semibold">{panel}<button aria-label="Close panel" onClick={() => setPanel('')}><X size={16} /></button></div>
                <p className="mt-3 text-xs leading-5 text-muted">{panel === 'Help'
                  ? 'UpdatePilot scans your enrolled Windows device and records live results. Installers are downloaded and verified again immediately before an approved update.'
                  : error || 'Agent heartbeat, active jobs, and execution readiness are shown in the header.'}</p>
              </div>
            )}
          </div>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <Link href="/settings" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-muted"><span className={`size-2 rounded-full ${agentDot}`} />{agentLabel}</Link>
            <Link href="/settings" className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${status.executionEnabled ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {status.executionEnabled ? 'Execution enabled' : 'Execution off'}
            </Link>
          </div>
        </header>
        <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </>
  );
}
