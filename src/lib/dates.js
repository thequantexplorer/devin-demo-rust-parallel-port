// Calendar dates are "YYYY-MM-DD" strings in UTC. There is no time of day.

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toDayNumber(value) {
  return Math.round(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
}

// Whole days from a to b (positive when b is later).
function daysBetween(a, b) {
  return toDayNumber(b) - toDayNumber(a);
}

module.exports = { isDate, daysBetween };
