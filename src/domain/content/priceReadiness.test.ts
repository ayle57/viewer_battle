import { describe, expect, it } from "vitest";
import { getGuessThePricePlaylistReadiness, isPriceItemComplete } from "./priceReadiness";

describe("isPriceItemComplete", () => {
  it("true only when title, imageUrl, and price are all present", () => {
    expect(isPriceItemComplete({ title: "X", imageUrl: "/images/price/x.png", price: 9.99 })).toBe(true);
    expect(isPriceItemComplete({ title: null, imageUrl: "/images/price/x.png", price: 9.99 })).toBe(false);
    expect(isPriceItemComplete({ title: "X", imageUrl: null, price: 9.99 })).toBe(false);
    expect(isPriceItemComplete({ title: "X", imageUrl: "/images/price/x.png", price: null })).toBe(false);
    expect(isPriceItemComplete({ title: null, imageUrl: null, price: null })).toBe(false);
  });
});

describe("getGuessThePricePlaylistReadiness", () => {
  it("empty when there are no items at all", () => {
    const readiness = getGuessThePricePlaylistReadiness([]);
    expect(readiness.status).toBe("empty");
    expect(readiness.ready).toBe(false);
    expect(readiness.summary).toBe("Add an item to get started.");
  });

  it("incomplete when an item exists but is missing title, image, or price", () => {
    const readiness = getGuessThePricePlaylistReadiness([{ id: "i1", title: null, imageUrl: "/images/price/x.png", price: null }]);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.ready).toBe(false);
    expect(readiness.incompleteItems).toEqual([{ itemId: "i1", missingTitle: true, missingImage: false, missingPrice: true }]);
    expect(readiness.firstProblemItemId).toBe("i1");
  });

  it("ready once every item has a title, an image, and a price", () => {
    const readiness = getGuessThePricePlaylistReadiness([
      { id: "i1", title: "Item A", imageUrl: "/images/price/a.png", price: 19.99 },
      { id: "i2", title: "Item B", imageUrl: "/images/price/b.png", price: 249 },
    ]);
    expect(readiness.status).toBe("ready");
    expect(readiness.ready).toBe(true);
    expect(readiness.completeItemCount).toBe(2);
    expect(readiness.incompleteItems).toEqual([]);
    expect(readiness.firstProblemItemId).toBeNull();
    expect(readiness.summary).toBe("Ready to play.");
  });

  it("counts complete/incomplete independently across a mixed list", () => {
    const readiness = getGuessThePricePlaylistReadiness([
      { id: "i1", title: "Item A", imageUrl: "/images/price/a.png", price: 10 },
      { id: "i2", title: null, imageUrl: null, price: null },
      { id: "i3", title: "Item C", imageUrl: null, price: 10 },
      { id: "i4", title: "Item D", imageUrl: "/images/price/d.png", price: 10 },
    ]);
    expect(readiness.itemCount).toBe(4);
    expect(readiness.completeItemCount).toBe(2);
    expect(readiness.incompleteItems).toEqual([
      { itemId: "i2", missingTitle: true, missingImage: true, missingPrice: true },
      { itemId: "i3", missingTitle: false, missingImage: true, missingPrice: false },
    ]);
    expect(readiness.firstProblemItemId).toBe("i2");
    expect(readiness.summary).toBe("2 items are missing a title, photo, or price.");
  });
});
