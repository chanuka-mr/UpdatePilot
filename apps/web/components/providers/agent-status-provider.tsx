'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type AgentStatus = {
  paired: boolean;
  online: boolean;
  lastSeenAt: string | null;
  activeJob: boolean;
  executionEnabled: boolean;
  deviceName: string;
  job: {
    id: string;
    state: string;
    operation: string | null;
    error: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    updateExecutionId: string | null;
  } | null;
};

type AgentStatusValue = {
  status: AgentStatus;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const initialStatus: AgentStatus = {
  paired: false, online: false, lastSeenAt: null, activeJob: false,
  executionEnabled: false, deviceName: 'Local Windows PC', job: null,
};

const AgentStatusContext = createContext<AgentStatusValue | null>(null);

export function AgentStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AgentStatus>(initialStatus);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/agent/status', { cache: 'no-store' });
      const payload = await response.json() as Partial<AgentStatus> & { error?: string };
      if (!response.ok) throw new Error(payload.error || `Status request failed (${response.status})`);
      setStatus({
        paired: !!payload.paired, online: !!payload.online,
        lastSeenAt: typeof payload.lastSeenAt === 'string' ? payload.lastSeenAt : null,
        activeJob: !!payload.activeJob, executionEnabled: !!payload.executionEnabled,
        deviceName: typeof payload.deviceName === 'string' ? payload.deviceName : 'Local Windows PC',
        job: payload.job && typeof payload.job.id === 'string' ? payload.job as AgentStatus['job'] : null,
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to read agent status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const value = useMemo(() => ({ status, loading, error, refresh }), [status, loading, error, refresh]);
  return <AgentStatusContext.Provider value={value}>{children}</AgentStatusContext.Provider>;
}

export function useAgentStatus() {
  const value = useContext(AgentStatusContext);
  if (!value) throw new Error('useAgentStatus must be used inside AgentStatusProvider.');
  return value;
}
