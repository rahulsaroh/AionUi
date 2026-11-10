/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import EventEmitter from 'eventemitter3';
import type { AuditChannel, HeadlessGateItem, HeadlessGateStatus } from './types';

export interface ParkGateOptions {
  id?: string;
  jobId?: string;
  conversationId: string;
  callId: string;
  actionTitle?: string;
  actionDescription?: string;
  commandType?: string;
  teamId?: string;
  projectId?: string;
  agentName?: string;
  diffPreview?: string;
  commandPreview?: string;
  timeoutMs?: number; // Defaults to 12 hours (12 * 60 * 60 * 1000)
}

export interface GateResolution {
  approved: boolean;
  expired?: boolean;
  channel?: AuditChannel;
  reason?: string;
  resolvedBy?: string;
}

interface ActiveGate {
  item: HeadlessGateItem;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (res: GateResolution) => void;
}

export class HeadlessGateManager extends EventEmitter {
  private activeGates = new Map<string, ActiveGate>();
  private completedGates = new Map<string, HeadlessGateItem>();
  private defaultTimeoutMs = 12 * 60 * 60 * 1000; // 12 hours default

  constructor(defaultTimeoutMs?: number) {
    super();
    if (defaultTimeoutMs !== undefined) {
      this.defaultTimeoutMs = defaultTimeoutMs;
    }
  }

  public setDefaultTimeoutMs(ms: number): void {
    this.defaultTimeoutMs = ms;
  }

  /**
   * Parks a headless run on a gated action.
   * Returns a promise that settles when the gate is approved, denied, or expires.
   */
  public parkGate(options: ParkGateOptions): Promise<GateResolution> {
    const id = options.id || `gate_${options.conversationId}_${options.callId}`;
    const now = Date.now();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const expiresAt = now + timeoutMs;

    const item: HeadlessGateItem = {
      id,
      jobId: options.jobId,
      conversationId: options.conversationId,
      callId: options.callId,
      status: 'waiting_for_approval',
      actionTitle: options.actionTitle,
      actionDescription: options.actionDescription,
      commandType: options.commandType,
      teamId: options.teamId,
      projectId: options.projectId,
      agentName: options.agentName,
      diffPreview: options.diffPreview,
      commandPreview: options.commandPreview,
      expiresAt,
      createdAt: now,
    };

    return new Promise<GateResolution>((resolve) => {
      const timer = setTimeout(() => {
        this.expireGate(id);
      }, timeoutMs);

      // Unref the timer so it doesn't hold node processes open in test runners
      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      this.activeGates.set(id, {
        item,
        timer,
        resolve,
      });

      this.emit('gate:parked', item);
    });
  }

  /**
   * Resolves a parked gate with approval.
   */
  public approveGate(gateId: string, options?: { channel?: AuditChannel; resolvedBy?: string }): boolean {
    const active = this.activeGates.get(gateId);
    if (!active) return false;

    if (active.timer) {
      clearTimeout(active.timer);
    }

    const resolvedAt = Date.now();
    active.item.status = 'approved';
    active.item.resolvedAt = resolvedAt;

    this.activeGates.delete(gateId);
    this.completedGates.set(gateId, active.item);

    const resolution: GateResolution = {
      approved: true,
      channel: options?.channel ?? 'inbox',
      resolvedBy: options?.resolvedBy ?? 'user',
    };

    active.resolve(resolution);
    this.emit('gate:resolved', { item: active.item, resolution });
    return true;
  }

  /**
   * Resolves a parked gate with denial, ending the headless run gracefully.
   */
  public denyGate(gateId: string, options?: { channel?: AuditChannel; resolvedBy?: string; reason?: string }): boolean {
    const active = this.activeGates.get(gateId);
    if (!active) return false;

    if (active.timer) {
      clearTimeout(active.timer);
    }

    const resolvedAt = Date.now();
    active.item.status = 'denied';
    active.item.resolvedAt = resolvedAt;

    this.activeGates.delete(gateId);
    this.completedGates.set(gateId, active.item);

    const resolution: GateResolution = {
      approved: false,
      channel: options?.channel ?? 'inbox',
      resolvedBy: options?.resolvedBy ?? 'user',
      reason: options?.reason ?? 'User denied action',
    };

    active.resolve(resolution);
    this.emit('gate:resolved', { item: active.item, resolution });
    return true;
  }

  /**
   * Expires a parked gate after timeout.
   */
  public expireGate(gateId: string): boolean {
    const active = this.activeGates.get(gateId);
    if (!active) return false;

    if (active.timer) {
      clearTimeout(active.timer);
    }

    const resolvedAt = Date.now();
    active.item.status = 'expired';
    active.item.resolvedAt = resolvedAt;

    this.activeGates.delete(gateId);
    this.completedGates.set(gateId, active.item);

    const resolution: GateResolution = {
      approved: false,
      expired: true,
      channel: 'system_timeout',
      resolvedBy: 'system',
      reason: 'Gate expired waiting for approval',
    };

    active.resolve(resolution);
    this.emit('gate:expired', active.item);
    return true;
  }

  /**
   * Retrieves all currently waiting gates.
   */
  public getPendingGates(): HeadlessGateItem[] {
    return Array.from(this.activeGates.values()).map((a) => ({ ...a.item }));
  }

  /**
   * Retrieves a gate by ID.
   */
  public getGate(gateId: string): HeadlessGateItem | undefined {
    const active = this.activeGates.get(gateId);
    if (active) return { ...active.item };
    const completed = this.completedGates.get(gateId);
    if (completed) return { ...completed };
    return undefined;
  }

  /**
   * Cleans up all pending gates and timers (e.g. during test teardown).
   */
  public clear(): void {
    for (const [id, active] of this.activeGates) {
      if (active.timer) clearTimeout(active.timer);
      active.resolve({ approved: false, reason: 'cleared' });
    }
    this.activeGates.clear();
    this.completedGates.clear();
  }
}

export const headlessGateManager = new HeadlessGateManager();
