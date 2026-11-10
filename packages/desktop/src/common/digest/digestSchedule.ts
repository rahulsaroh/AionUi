/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_DIGEST_TIME = '08:00';

export function getDefaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Returns a cron expression representing daily execution at targetTimeStr
 * (default "08:00").
 */
export function formatCronForDigest(
  targetTimeStr = DEFAULT_DIGEST_TIME,
  timeZone = getDefaultTimeZone()
): { expr: string; timeZone: string } {
  const [hourStr, minuteStr] = targetTimeStr.split(':');
  const hour = parseInt(hourStr || '8', 10);
  const minute = parseInt(minuteStr || '0', 10);

  return {
    expr: `${minute} ${hour} * * *`,
    timeZone,
  };
}

/**
 * Helper that formats a Date into year, month, day, hour, minute in a specific timezone
 */
function getPartsInTimeZone(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;

  for (const p of parts) {
    if (p.type === 'year') year = parseInt(p.value, 10);
    else if (p.type === 'month') month = parseInt(p.value, 10);
    else if (p.type === 'day') day = parseInt(p.value, 10);
    else if (p.type === 'hour') hour = parseInt(p.value, 10) % 24;
    else if (p.type === 'minute') minute = parseInt(p.value, 10);
  }

  return { year, month, day, hour, minute };
}

/**
 * Timezone and DST aware calculation of the next execution time for a daily target time.
 * For example: if target is "08:00" and fromTime is 2026-03-08 07:00 in America/New_York (DST transition day),
 * this returns the exact UTC moment corresponding to 08:00 AM local time in that timezone.
 */
export function getNextDailyScheduleTime(
  fromTime: Date,
  targetTimeStr = DEFAULT_DIGEST_TIME,
  timeZone = getDefaultTimeZone()
): Date {
  const [targetHourStr, targetMinuteStr] = targetTimeStr.split(':');
  const targetHour = parseInt(targetHourStr || '8', 10);
  const targetMinute = parseInt(targetMinuteStr || '0', 10);

  const currentLocal = getPartsInTimeZone(fromTime, timeZone);

  // Determine target date in local timezone: either today or tomorrow
  let targetYear = currentLocal.year;
  let targetMonth = currentLocal.month;
  let targetDay = currentLocal.day;

  const currentMinutes = currentLocal.hour * 60 + currentLocal.minute;
  const targetMinutes = targetHour * 60 + targetMinute;

  if (currentMinutes >= targetMinutes) {
    // Already passed today, schedule for tomorrow
    const tomorrow = new Date(fromTime.getTime() + 25 * 60 * 60 * 1000);
    const tomorrowLocal = getPartsInTimeZone(tomorrow, timeZone);
    targetYear = tomorrowLocal.year;
    targetMonth = tomorrowLocal.month;
    targetDay = tomorrowLocal.day;
  }

  // To find the exact UTC timestamp where local time equals targetHour:targetMinute in timeZone:
  // We approximate UTC from naive timestamp then adjust for the timezone offset at that exact moment.
  const naiveUtc = Date.UTC(targetYear, targetMonth - 1, targetDay, targetHour, targetMinute, 0, 0);

  // Binary/iterative search around naiveUtc to find exact millisecond where getPartsInTimeZone matches
  let candidate = new Date(naiveUtc);
  for (let i = 0; i < 3; i++) {
    const parts = getPartsInTimeZone(candidate, timeZone);
    const diffMinutes =
      (targetYear - parts.year) * 365 * 24 * 60 +
      (targetMonth - parts.month) * 30 * 24 * 60 +
      (targetDay - parts.day) * 24 * 60 +
      (targetHour - parts.hour) * 60 +
      (targetMinute - parts.minute);

    if (diffMinutes === 0) break;
    candidate = new Date(candidate.getTime() + diffMinutes * 60 * 1000);
  }

  return candidate;
}
