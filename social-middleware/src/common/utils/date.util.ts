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
