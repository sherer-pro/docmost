import { describe, expect, it } from "vitest";
import {
  databaseFileIds,
  databaseUserIds,
  normalizeDatabaseValue,
  remapDatabaseAttachmentReferences,
} from "../../../../../../packages/api-contract/src/database-values";

describe("database identity and attachment contracts", () => {
  const id = "abcdef01-2345-4234-8234-123456789abc";
  const target = "abcdef02-2345-4234-8234-123456789abc";
  it("canonicalizes identities and rejects duplicate file identities regardless of case", () => {
    expect(databaseUserIds([{ id }, { id: id.toUpperCase() }])).toEqual([id]);
    expect(normalizeDatabaseValue("user", { id: id.toUpperCase() })).toEqual({
      id,
    });
    expect(normalizeDatabaseValue("page_reference", id.toUpperCase())).toBe(id);
    expect(
      normalizeDatabaseValue("file", [{ attachmentId: id.toUpperCase() }]),
    ).toEqual([{ attachmentId: id }]);
    expect(() =>
      normalizeDatabaseValue("file", [
        { attachmentId: id },
        { attachmentId: id.toUpperCase() },
      ]),
    ).toThrow();
  });
  it("remaps legacy uppercase file identities through canonical attachment mappings", () => {
    const value = [{ attachmentId: id.toUpperCase() }];
    expect(databaseFileIds(value)).toEqual([id]);
    expect(
      remapDatabaseAttachmentReferences(value, new Map([[id, target]])),
    ).toEqual([{ attachmentId: target }]);
    expect(() => remapDatabaseAttachmentReferences(value, new Map())).toThrow(
      "mapping",
    );
    expect(remapDatabaseAttachmentReferences(value, new Map(), true)).toEqual(
      [],
    );
  });
});
