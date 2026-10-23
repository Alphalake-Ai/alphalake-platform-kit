import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Receipt, Package, Headphones, Building2, X } from 'lucide-react';
import { cn } from './utils';
import { ALPHALAKE_LOGO_WHITE } from './assets/alphalake-logo-white';

/** One row of createWorkspaces().listForUser() on the server. */
export interface Workspace {
  id: string;
  masterEntityId: string;
  name: string;
  description: string | null;
  subType: string | null;
  current: boolean;
}

export interface WorkspacesResponse {
  cloud: { id: string; name: string } | null;
  workspaces: Workspace[];
}

export interface WorkspaceDisplay {
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
  /** Where the card goes. Absolute URLs are full page loads; anything else goes through onNavigate. */
  href?: string;
}

// How each workspace looks in the switcher, keyed by the platform's subType.
// Apps override or extend this via the `display` prop (e.g. to add hrefs).
export const DEFAULT_WORKSPACE_DISPLAY: Record<string, WorkspaceDisplay> = {
  meds: { icon: RefreshCw, blurb: 'Manage patient prescriptions and dispensing workflows.' },
  finance: { icon: Receipt, blurb: 'Automated invoices, payments, queries + Customer Portal.' },
  ops: { icon: Package, blurb: 'Track deliveries and logistics.' },
  'customer-success': { icon: Headphones, blurb: 'View and submit support tickets.' },
};

export interface WorkspaceSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fetches the list, e.g. GET /api/workspaces. Called each time the switcher opens. */
  load: () => Promise<WorkspacesResponse>;
  orgName?: string | null;
  orgLogoUrl?: string | null;
  /** Merged over DEFAULT_WORKSPACE_DISPLAY. */
  display?: Record<string, Partial<WorkspaceDisplay>>;
  /** Where a workspace with no href goes. Default '/coming-soon'. */
  fallbackHref?: string;
  /** In-app navigation for non-absolute hrefs (e.g. react-router's navigate). Without it they're plain links. */
  onNavigate?: (href: string, workspace: Workspace) => void;
}

const isAbsolute = (href: string) => /^https?:\/\//.test(href);
const cardBase = 'group flex flex-col justify-between p-6 rounded-2xl bg-white text-left transition-all hover:-translate-y-0.5 duration-200';

// "Select Workspace" modal opened from the top bar's org card: lists the
// workspaces in this cloud the user can open, with this app's marked Current.
export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  open, onOpenChange, load, orgName, orgLogoUrl, display, fallbackHref = '/coming-soon', onNavigate,
}) => {
  const [state, setState] = useState<{ loading: boolean; error: boolean; workspaces: Workspace[] }>({ loading: false, error: false, workspaces: [] });
  const close = () => onOpenChange(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: false }));
    load()
      .then(data => { if (!cancelled) setState({ loading: false, error: false, workspaces: data?.workspaces ?? [] }); })
      .catch(() => { if (!cancelled) setState({ loading: false, error: true, workspaces: [] }); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelled = true; window.removeEventListener('keydown', onKey); };
  }, [open]); // `load`/`close` are usually new each render; refetch only when opening

  if (!open) return null;

  const describe = (w: Workspace) => {
    const d = { ...(w.subType ? DEFAULT_WORKSPACE_DISPLAY[w.subType] : undefined), ...(w.subType ? display?.[w.subType] : undefined) };
    return {
      title: w.name.replace(/\s+Workspace$/i, ''),
      Icon: d.icon ?? Building2,
      blurb: d.blurb ?? w.description ?? '',
      href: d.href ?? fallbackHref,
    };
  };

  const card = (w: Workspace) => {
    const { title, Icon, blurb, href } = describe(w);
    const body = (
      <>
        <div className="flex items-center justify-between">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-[#005961] transition-colors group-hover:bg-teal-100 group-hover:text-teal-700">
            <Icon className="size-5" />
          </div>
          {w.current ? (
            <span className="inline-flex items-center rounded-full bg-topbar/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-topbar ring-1 ring-topbar/20">Current</span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-emerald-700 ring-1 ring-emerald-200/60">Subscribed</span>
          )}
        </div>
        <div className="mt-5">
          <h3 className="text-[15px] font-bold text-gray-900 transition-colors group-hover:text-topbar">{title}</h3>
          <p className="mt-1.5 text-xs font-medium leading-relaxed text-gray-500">{blurb}</p>
        </div>
      </>
    );

    // The current workspace just closes the switcher — you're already in it.
    if (w.current) {
      return (
        <button
          key={w.id}
          type="button"
          onClick={close}
          className={cn(cardBase, 'cursor-pointer border-2 border-topbar shadow-[0_4px_16px_rgba(0,59,70,0.08)] hover:shadow-[0_8px_24px_rgba(0,59,70,0.12)]')}
        >
          {body}
        </button>
      );
    }
    return (
      <a
        key={w.id}
        href={href}
        onClick={e => {
          close();
          if (!isAbsolute(href) && onNavigate) {
            e.preventDefault();
            onNavigate(href, w);
          }
        }}
        className={cn(cardBase, 'border border-gray-100/80 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:border-teal-100 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]')}
      >
        {body}
      </a>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Select Workspace"
        className="relative flex w-[90%] max-w-4xl overflow-hidden rounded-[28px] bg-white shadow-2xl max-md:max-h-[90vh] max-md:flex-col max-md:overflow-y-auto md:h-[460px]"
      >
        {/* Left panel */}
        <div className="relative flex shrink-0 flex-col bg-topbar p-10 text-topbar-foreground max-md:p-6 md:w-[35%]">
          <div>
            {orgLogoUrl ? (
              <div className="inline-flex h-11 max-w-[12rem] items-center justify-center rounded-lg bg-white px-2.5 py-1 shadow-sm">
                <img src={orgLogoUrl} alt={orgName || 'Organisation'} className="h-8 w-auto object-contain" />
              </div>
            ) : (
              <img src={ALPHALAKE_LOGO_WHITE} alt="Alphalake Ai" className="h-10 w-auto object-contain" />
            )}
          </div>
          <div className="mt-16 max-md:mt-8">
            <h2 className="text-3xl font-bold tracking-tight">Select Workspace</h2>
            <p className="mt-2.5 text-[13.5px] font-medium leading-relaxed text-topbar-foreground/80">Access your automation workspaces.</p>
          </div>
          <div className="mt-auto text-[11px] font-semibold tracking-wider text-topbar-foreground/50 max-md:mt-6">
            © {new Date().getFullYear()} Alphalake Ai
          </div>
        </div>

        {/* Right panel */}
        <div className="relative flex flex-col bg-white p-10 max-md:p-6 md:w-[65%] md:overflow-y-auto">
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-6 top-6 rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none cursor-pointer"
          >
            <X className="size-5" />
          </button>

          <div className="grid grid-cols-2 gap-5 max-sm:grid-cols-1">
            {state.loading && [0, 1].map(i => (
              <div key={i} className="h-[170px] animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />
            ))}
            {!state.loading && state.workspaces.map(card)}
          </div>

          {state.error && (
            <p className="mt-5 text-xs font-medium text-gray-500">We couldn&apos;t load your workspaces. Close this and try again.</p>
          )}
          {!state.loading && !state.error && state.workspaces.length <= 1 && (
            <p className="mt-5 text-xs font-medium text-gray-500">
              You don&apos;t have access to any other workspaces. Ask your organisation admin if you need one.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
