export interface TableColumnDemand {
  start: number;
  span: number;
  minimumWidth: number;
  preferredWidth: number;
}

export interface TableColumnLayoutOptions {
  columnCount: number;
  containerWidth: number;
  minColumnWidth: number;
  demands: readonly TableColumnDemand[];
}

const EPSILON = 0.01;

function allocateEqualWidthsWithFloors(
  minimumWidths: readonly number[],
  budget: number,
): number[] {
  const widths = [...minimumWidths];
  const flexible = new Set(widths.map((_, index) => index));
  let remainingBudget = budget;

  while (flexible.size > 0) {
    const sharedWidth = remainingBudget / flexible.size;
    const constrained = Array.from(flexible).filter(
      (index) => minimumWidths[index] > sharedWidth + EPSILON,
    );

    if (constrained.length === 0) {
      flexible.forEach((index) => {
        widths[index] = sharedWidth;
      });
      break;
    }

    constrained.forEach((index) => {
      widths[index] = minimumWidths[index];
      remainingBudget -= minimumWidths[index];
      flexible.delete(index);
    });
  }

  return widths;
}

/**
 * Allocate fixed table column widths without persisting derived values in the
 * document. Each column keeps its intrinsic content minimum, so the table grows
 * beyond its container only when those minima no longer fit.
 */
export function allocateTableColumnWidths({
  columnCount,
  containerWidth,
  minColumnWidth,
  demands,
}: TableColumnLayoutOptions): number[] {
  if (columnCount <= 0) return [];

  const safeMinWidth = Math.max(0, minColumnWidth);
  const minimumWidths = Array<number>(columnCount).fill(safeMinWidth);
  const preferredWidths = Array<number>(columnCount).fill(safeMinWidth);

  for (const demand of demands) {
    const start = Math.max(0, Math.min(columnCount - 1, demand.start));
    const span = Math.max(1, Math.min(columnCount - start, demand.span));
    const sharedMinimum = Math.max(0, demand.minimumWidth) / span;
    const sharedPreferred =
      Math.max(demand.minimumWidth, demand.preferredWidth, 0) / span;

    for (let index = start; index < start + span; index += 1) {
      minimumWidths[index] = Math.max(minimumWidths[index], sharedMinimum);
      preferredWidths[index] = Math.max(
        preferredWidths[index],
        sharedPreferred,
      );
    }
  }

  const minimumBudget = minimumWidths.reduce(
    (total, width) => total + width,
    0,
  );
  const budget = Math.max(containerWidth, minimumBudget);
  const widths = allocateEqualWidthsWithFloors(minimumWidths, budget);
  const requestedGrowth = preferredWidths.map((width, index) =>
    Math.max(0, width - widths[index]),
  );
  const donorSpare = preferredWidths.map((width, index) =>
    requestedGrowth[index] > EPSILON
      ? 0
      : Math.max(0, widths[index] - Math.max(minimumWidths[index], width)),
  );

  const totalRequestedGrowth = requestedGrowth.reduce(
    (total, width) => total + width,
    0,
  );
  const totalDonorSpare = donorSpare.reduce((total, width) => total + width, 0);

  if (totalRequestedGrowth <= EPSILON || totalDonorSpare <= EPSILON) {
    return widths;
  }

  const redistributed = Math.min(totalRequestedGrowth, totalDonorSpare);

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
