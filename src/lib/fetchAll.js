import { supabase } from './supabaseClient';

/**
 * Fetch all rows from a Supabase query, paging past the default 1000-row cap.
 * Pass a callback that receives (from, to) and returns a supabase query builder
 * with .range(from, to) already applied — or use the simpler fetchAllFrom helper.
 */
export async function fetchAllPages(buildQuery, pageSize = 1000) {
  const all = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Convenience: fetch every row of a table with optional filters.
 * filters is a function (query) => query that adds .eq / .select etc.
 *
 * Example:
 *   await fetchAllFrom('payments', (q) =>
 *     q.select('estate_id, amount').eq('is_deleted', false)
 *   );
 */
export async function fetchAllFrom(table, apply = (q) => q.select('*'), pageSize = 1000) {
  return fetchAllPages(async (from, to) => {
    const base = apply(supabase.from(table));
    return base.range(from, to);
  }, pageSize);
}
