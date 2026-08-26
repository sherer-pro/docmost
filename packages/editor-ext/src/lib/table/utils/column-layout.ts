export interface TableColumnDemand {
  start: number;
  span: number;
  width: number;
}

export interface TableColumnLayoutOptions {
  columnCount: number;
  containerWidth: number;
  minColumnWidth: number;
  demands: readonly TableColumnDemand[];
}

const EPSILON = 0.01;

/**
 * Allocate fixed table column widths without persisting derived values in the
 * document. Content can only redistribute the current table budget; it never
 * grows the table beyond the structural minimum.
 */
export function allocateTableColumnWidths({
  columnCount,
  containerWidth,
  minColumnWidth,
  demands,
}: TableColumnLayoutOptions): number[] {
  if (columnCount <= 0) return [];

  const safeMinWidth = Math.max(0, minColumnWidth);
  const budget = Math.max(containerWidth, columnCount * safeMinWidth);
  const baseline = budget / columnCount;
  const demandPerColumn = Array<number>(columnCount).fill(0);

  for (const demand of demands) {
    const start = Math.max(0, Math.min(columnCount - 1, demand.start));
    const span = Math.max(1, Math.min(columnCount - start, demand.span));
    const sharedDemand = Math.max(0, demand.width) / span;

    for (let index = start; index < start + span; index += 1) {
      demandPerColumn[index] = Math.max(demandPerColumn[index], sharedDemand);
    }
  }

  const requestedGrowth = demandPerColumn.map((width) =>
    Math.max(0, width - baseline),
  );
  const donorSpare = requestedGrowth.map((growth) =>
    growth > EPSILON ? 0 : Math.max(0, baseline - safeMinWidth),
  );

  const totalRequestedGrowth = requestedGrowth.reduce(
    (total, width) => total + width,
    0,
  );
  const totalDonorSpare = donorSpare.reduce((total, width) => total + width, 0);

  if (totalRequestedGrowth <= EPSILON || totalDonorSpare <= EPSILON) {
    return Array<number>(columnCount).fill(baseline);
  }

  const redistributed = Math.min(totalRequestedGrowth, totalDonorSpare);
  const widths = Array<number>(columnCount).fill(baseline);

  for (let index = 0; index < columnCount; index += 1) {
    if (requestedGrowth[index] > EPSILON) {
      widths[index] +=
        redistributed * (requestedGrowth[index] / totalRequestedGrowth);
    } else if (donorSpare[index] > EPSILON) {
      widths[index] -= redistributed * (donorSpare[index] / totalDonorSpare);
    }
  }

  const roundingDelta =
    budget - widths.reduce((total, width) => total + width, 0);
  widths[widths.length - 1] += roundingDelta;

  return widths;
}
