/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import type {
  DesktopAuditEntry,
  DesktopControlConfig,
  DesktopControlStatus,
  DesktopScreenshotResult,
} from '@/common/desktopControl';

export function useDesktopControlStatus() {
  const [status, setStatus] = useState<DesktopControlStatus | null>(null);
  const [auditLogs, setAuditLogs] = useState<DesktopAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.desktopControlGetStatus) {
      setLoading(false);
      return;
    }
    try {
      const [stRes, logsRes] = await Promise.all([
        window.electronAPI.desktopControlGetStatus(),
        window.electronAPI.desktopControlGetAuditLogs ? window.electronAPI.desktopControlGetAuditLogs(50) : null,
      ]);
      if (stRes?.success && stRes.data) {
        setStatus(stRes.data);
      }
      if (logsRes?.success && Array.isArray(logsRes.data)) {
        setAuditLogs(logsRes.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubStatus = window.electronAPI?.onDesktopControlStatusChanged?.((next) => {
      setStatus(next);
      if (window.electronAPI?.desktopControlGetAuditLogs) {
        void window.electronAPI.desktopControlGetAuditLogs(50).then((res) => {
          if (res?.success && Array.isArray(res.data)) {
            setAuditLogs(res.data);
          }
        });
      }
    });
    return () => {
      unsubStatus?.();
    };
  }, [refresh]);

  const updateConfig = useCallback(async (patch: Partial<DesktopControlConfig>) => {
    if (!window.electronAPI?.desktopControlUpdateConfig) return null;
    const res = await window.electronAPI.desktopControlUpdateConfig(patch);
    if (res?.success && res.data) {
      setStatus(res.data);
      return res.data;
    }
    return null;
  }, []);

  const emergencyStop = useCallback(async () => {
    if (!window.electronAPI?.desktopControlEmergencyStop) return null;
    const res = await window.electronAPI.desktopControlEmergencyStop();
    if (res?.success && res.data) {
      setStatus(res.data);
      return res.data;
    }
    return null;
  }, []);

  const resume = useCallback(async () => {
    if (!window.electronAPI?.desktopControlResume) return null;
    const res = await window.electronAPI.desktopControlResume();
    if (res?.success && res.data) {
      setStatus(res.data);
      return res.data;
    }
    return null;
  }, []);

  const clearAuditLogs = useCallback(async () => {
    if (!window.electronAPI?.desktopControlClearAuditLogs) return;
    const res = await window.electronAPI.desktopControlClearAuditLogs();
    if (res?.success) {
      setAuditLogs([]);
    }
  }, []);

  const capturePreview = useCallback(async (): Promise<DesktopScreenshotResult | null> => {
    if (!window.electronAPI?.desktopControlCapturePreview) return null;
    const res = await window.electronAPI.desktopControlCapturePreview(0);
    if (res?.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error || 'Failed to capture desktop preview');
  }, []);

  return {
    status,
    auditLogs,
    loading,
    refresh,
    updateConfig,
    emergencyStop,
    resume,
    clearAuditLogs,
    capturePreview,
  };
}
