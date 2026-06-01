import { describe, expect, it } from "vitest";
import { parsePersistedReviewPartsUi } from "./persistedReviewPartsUi";

describe("parsePersistedReviewPartsUi", () => {
  it("returns defaults for invalid JSON", () => {
    const ui = parsePersistedReviewPartsUi("not-json");
    expect(ui.viewMode).toBe("edit");
    expect(ui.includedFilter).toBe("included");
  });

  it("parses stored filters", () => {
    const ui = parsePersistedReviewPartsUi(
      JSON.stringify({
        search: "bracket",
        printFilter: "partial",
        viewMode: "print",
        compactMode: true,
      }),
    );
    expect(ui.search).toBe("bracket");
    expect(ui.printFilter).toBe("partial");
    expect(ui.viewMode).toBe("print");
    expect(ui.compactMode).toBe(true);
  });
});
