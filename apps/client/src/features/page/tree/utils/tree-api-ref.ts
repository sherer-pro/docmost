/**
 * React calls callback refs with null before publishing the same imperative
 * handle again. Ignore that transient value so ref publication cannot trigger
 * a render loop through component state or an external atom.
 */
export function shouldPublishTreeApi<T>(
  currentTreeApi: T | null,
  nextTreeApi: T | null,
): nextTreeApi is T {
  return nextTreeApi !== null && nextTreeApi !== currentTreeApi;
}
