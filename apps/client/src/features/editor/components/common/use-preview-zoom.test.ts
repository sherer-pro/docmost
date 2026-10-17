import { describe, expect, it } from "vitest";
import { constrainPreviewTransform, zoomPreviewAt } from "./use-preview-zoom";

describe("preview transform boundaries", () => {
  const size = { width: 400, height: 300 };

  it("keeps the point under the zoom anchor stationary", () => {
    const start = { scale: 2, x: 20, y: -10 };
    const anchor = { x: 100, y: 50 };
    const result = zoomPreviewAt(start, 4, anchor, size);
    expect((anchor.x - result.x) / result.scale).toBe(
      (anchor.x - start.x) / start.scale,
    );
    expect((anchor.y - result.y) / result.scale).toBe(
      (anchor.y - start.y) / start.scale,
    );
  });

  it("bounds zoom and drag offsets so media cannot be lost", () => {
    expect(
      constrainPreviewTransform({ scale: 100, x: 9000, y: -9000 }, size),
    ).toEqual({ scale: 8, x: 1400, y: -1050 });
    const fitted = constrainPreviewTransform(
      { scale: 0.1, x: 100, y: 100 },
      size,
    );
    expect(fitted.scale).toBe(1);
    expect(Math.abs(fitted.x) + Math.abs(fitted.y)).toBe(0);
  });

  it("constrains an existing pan after the viewport shrinks", () => {
    expect(
      constrainPreviewTransform(
        { scale: 2, x: 200, y: 150 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ scale: 2, x: 100, y: 50 });
  });
});
