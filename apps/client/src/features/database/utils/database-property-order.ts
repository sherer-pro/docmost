export function sortDatabasePropertiesByPosition<
  T extends { position: number },
>(properties: T[]): T[] {
  return [...properties].sort(
    (leftProperty, rightProperty) =>
      leftProperty.position - rightProperty.position,
  );
}
