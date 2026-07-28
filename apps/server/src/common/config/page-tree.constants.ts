/**
 * Hard depth cap for every recursive page-hierarchy query.
 *
 * `pages.parent_page_id` has no database-level cycle constraint, so a recursive
 * CTE that walks the tree without a bound can loop until the statement is
 * killed. Every recursive traversal must carry a `level` column and stop at this
 * value so a malformed or cyclic tree degrades to a truncated result instead of
 * pinning a Postgres backend.
 *
 * The value is also the effective nesting limit for the page tree.
 */
export const MAX_PAGE_TREE_DEPTH = 100;
