export function compareDates(date1: string, date2: string): boolean {
  try {
    const d1 = new Date(date1);
    const d2 = new Date(date2);

    // Check if both dates are valid
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      return false;
    }

    // Compare year, month, and day
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  } catch (error) {
    return false;
  }
}

/**
 * Converts an ISO date string (YYYY-MM-DD) or Date object to MM/DD/YYYY format for Siebel
 * @param dateInput - ISO date string or Date object
 * @returns Formatted date string in MM/DD/YYYY format
 */
export function formatDateForSiebel(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateInput}`);
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
}
