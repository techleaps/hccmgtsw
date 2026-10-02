// Postgres rejects an empty string ("") for a real `date` (or other typed,
// non-text) column — it wants either a valid value or SQL NULL. Form inputs
// naturally produce "" when left blank, so run every save payload through
// this before sending it to Supabase for any keys that are typed columns
// (dates, numbers) rather than free text.
export function blankToNull(obj, keys) {
  const copy = { ...obj };
  keys.forEach((k) => {
    if (copy[k] === '' || copy[k] === undefined) copy[k] = null;
  });
  return copy;
}
