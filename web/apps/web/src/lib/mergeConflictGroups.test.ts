import { describe, expect, it } from "vitest";
import { groupMergeConflictsByFilename } from "./mergeConflictGroups";

describe("groupMergeConflictsByFilename", () => {
  it("groups merge_conflict issues by filename", () => {
    const groups = groupMergeConflictsByFilename([
      {
        severity: "warning",
        code: "merge_conflict",
        message: "Merge conflict for widget.stl — exclude duplicates or pick one in Build.",
      },
      {
        severity: "warning",
        code: "merge_conflict",
        message: "Merge conflict for widget.stl — exclude duplicates or pick one in Build.",
      },
      {
        severity: "warning",
        code: "merge_conflict",
        message: "Merge conflict for bracket.stl — exclude duplicates or pick one in Build.",
      },
    ]);
    expect(groups).toEqual([
      ["bracket.stl", 1],
      ["widget.stl", 2],
    ]);
  });
});
