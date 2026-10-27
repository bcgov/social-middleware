import { BadRequestException } from '@nestjs/common';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const toIsoLocal = (d: Date): string => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

/**
 * A date supplied by the caregiver must be a real calendar date, not before the
 * resource case opened, and not more than 2 years from today. Past dates are fine.
 */
export function assertWithinCaseWindow(
  value: string,
  caseOpenDate: Date | string | null | undefined,
  label = 'Date',
): void {
  const parsed = new Date(`${value}T00:00:00`);
  if (
    !ISO_DATE.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    toIsoLocal(parsed) !== value // rejects 2026-02-31
  ) {
    throw new BadRequestException(`${label} is not a valid date`);
  }

  const max = new Date();
  max.setFullYear(max.getFullYear() + 2);
  if (value > toIsoLocal(max)) {
    throw new BadRequestException(`${label} is more than 2 years from today`);
  }

  if (caseOpenDate && value < toIsoLocal(new Date(caseOpenDate))) {
    throw new BadRequestException(
      `${label} is before the resource case opened`,
    );
  }
}
