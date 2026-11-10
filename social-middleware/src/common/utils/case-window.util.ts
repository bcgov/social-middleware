import { BadRequestException } from '@nestjs/common';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const toIsoLocal = (d: Date): string => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

export function isRealIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00`);
  return (
    ISO_DATE.test(value) &&
    !Number.isNaN(parsed.getTime()) &&
    toIsoLocal(parsed) === value // rejects 2026-02-31
  );
}

/**
 * A date supplied by the caregiver must be a real calendar date, not before the
 * resource case opened, and not more than 2 years from today. Past dates are fine.
 */
export function assertWithinCaseWindow(
  value: string,
  caseOpenDate: Date | string | null | undefined,
  label = 'Date',
): void {
  if (!isRealIsoDate(value)) {
    throw new BadRequestException(`${label} is not a valid date`);
  }

  const max = new Date();
  max.setFullYear(max.getFullYear() + 2);
  if (value > todayInPacific(max)) {
    throw new BadRequestException(`${label} is more than 2 years from today`);
  }

  if (caseOpenDate && value < toIsoLocal(new Date(caseOpenDate))) {
    throw new BadRequestException(
      `${label} is before the resource case opened`,
    );
  }
}

// today's calendar date in BC, whatever timezone the server runs in (YYYY-MM-DD)
export const todayInPacific = (now: Date = new Date()): string =>
  now.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
