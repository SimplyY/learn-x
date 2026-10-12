export function isoWeeksInYear(yearInput) {
  const year = Number(yearInput);
  if (!Number.isInteger(year) || year < 1 || year > 9999) return 0;
  const jan1 = new Date(0);
  jan1.setUTCFullYear(year, 0, 1);
  jan1.setUTCHours(0, 0, 0, 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return jan1.getUTCDay() === 4 || (jan1.getUTCDay() === 3 && leapYear) ? 53 : 52;
}
