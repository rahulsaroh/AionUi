/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { formatCronForDigest, getNextDailyScheduleTime } from '@/common/digest/digestSchedule';

describe('Morning Digest Schedule & Timezone/DST', () => {
  it('formats daily 08:00 cron expression with timezone', () => {
    const schedule = formatCronForDigest('08:00', 'America/New_York');
    expect(schedule.expr).toBe('0 8 * * *');
    expect(schedule.timeZone).toBe('America/New_York');
  });

  it('schedules next run for 8:00 AM today if current time is before 8:00 AM', () => {
    // 06:30 UTC on 2026-06-15
    const fromTime = new Date(Date.UTC(2026, 5, 15, 6, 30, 0));
    const nextRun = getNextDailyScheduleTime(fromTime, '08:00', 'UTC');

    expect(nextRun.toISOString()).toBe('2026-06-15T08:00:00.000Z');
  });

  it('schedules next run for 8:00 AM tomorrow if current time is after 8:00 AM', () => {
    // 09:30 UTC on 2026-06-15
    const fromTime = new Date(Date.UTC(2026, 5, 15, 9, 30, 0));
    const nextRun = getNextDailyScheduleTime(fromTime, '08:00', 'UTC');

    expect(nextRun.toISOString()).toBe('2026-06-16T08:00:00.000Z');
  });

  it('accurately resolves 8:00 AM local across positive timezone offsets (Asia/Tokyo UTC+9)', () => {
    // 2026-06-15 07:00 in Tokyo (which is 2026-06-14 22:00 UTC)
    const fromTime = new Date('2026-06-14T22:00:00.000Z');
    const nextRun = getNextDailyScheduleTime(fromTime, '08:00', 'Asia/Tokyo');

    // 08:00 JST is 23:00 UTC previous day (UTC+9)
    expect(nextRun.toISOString()).toBe('2026-06-14T23:00:00.000Z');
  });

  it('accurately handles Daylight Saving Time (DST) spring-forward transitions', () => {
    // In America/New_York, DST starts on Sunday, March 8, 2026:
    // Before DST (March 7, EST, UTC-5): 08:00 EST = 13:00 UTC
    // After DST (March 8, EDT, UTC-4): 08:00 EDT = 12:00 UTC
    const beforeDst = new Date('2026-03-07T10:00:00.000Z'); // 05:00 EST on March 7
    const nextRunEst = getNextDailyScheduleTime(beforeDst, '08:00', 'America/New_York');
    expect(nextRunEst.toISOString()).toBe('2026-03-07T13:00:00.000Z');

    // On March 8 morning (EDT active, UTC-4):
    const duringDstTransition = new Date('2026-03-08T10:00:00.000Z'); // 06:00 EDT on March 8
    const nextRunEdt = getNextDailyScheduleTime(duringDstTransition, '08:00', 'America/New_York');
    // Notice that 08:00 EDT is 12:00 UTC (1 hour earlier in UTC due to DST transition)
    expect(nextRunEdt.toISOString()).toBe('2026-03-08T12:00:00.000Z');
  });

  it('accurately handles Daylight Saving Time (DST) fall-back transitions', () => {
    // In America/New_York, DST ends on Sunday, November 1, 2026 (EDT UTC-4 -> EST UTC-5):
    // October 31 (EDT, UTC-4): 08:00 EDT = 12:00 UTC
    const beforeFallBack = new Date('2026-10-31T10:00:00.000Z');
    const nextRunEdt = getNextDailyScheduleTime(beforeFallBack, '08:00', 'America/New_York');
    expect(nextRunEdt.toISOString()).toBe('2026-10-31T12:00:00.000Z');

    // November 1 (EST, UTC-5): 08:00 EST = 13:00 UTC
    const afterFallBack = new Date('2026-11-01T10:00:00.000Z');
    const nextRunEst = getNextDailyScheduleTime(afterFallBack, '08:00', 'America/New_York');
    expect(nextRunEst.toISOString()).toBe('2026-11-01T13:00:00.000Z');
  });
});
