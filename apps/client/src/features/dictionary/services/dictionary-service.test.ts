import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportDictionaryTerms,
  generateAllDictionaryWordForms,
  generateDictionaryWordForms,
  getDictionaryWordFormGenerationStatus,
  getDictionaryTerm,
  importDictionaryTerms,
  parseDictionaryImportJson,
} from "./dictionary-service";

const { downloadBlobFromAxiosResponseMock, getMock, postMock } = vi.hoisted(
  () => ({
    downloadBlobFromAxiosResponseMock: vi.fn(),
    getMock: vi.fn(),
    postMock: vi.fn(),
  }),
);

vi.mock("@/lib/api-client", () => ({
  default: {
    get: getMock,
    post: postMock,
  },
}));

vi.mock("@/lib/download", () => ({
  downloadBlobFromAxiosResponse: downloadBlobFromAxiosResponseMock,
}));

describe("dictionary-service JSON import/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports dictionary terms as a blob download", async () => {
    const response = {
      data: new Blob(["{}"], { type: "application/json" }),
      headers: {
        "content-disposition": 'attachment; filename="dictionary.json"',
      },
    };
    postMock.mockResolvedValue(response);

    await exportDictionaryTerms("space-1");

    expect(postMock).toHaveBeenCalledWith(
      "/dictionary-terms/actions/export",
      { spaceId: "space-1" },
      {
        responseType: "blob",
        skipEnvelopeUnwrap: true,
      },
    );
    expect(downloadBlobFromAxiosResponseMock).toHaveBeenCalledWith(
      response,
      "dictionary.json",
    );
  });

  it("imports dictionary terms through the action endpoint", async () => {
    postMock.mockResolvedValue({
      data: { created: 1, updated: 2, total: 3 },
    });

    await expect(
      importDictionaryTerms({
        spaceId: "space-1",
        terms: [
          {
            term: "Alpha",
            forms: ["Alphas"],
            definitionMarkdown: "Definition",
          },
        ],
      }),
    ).resolves.toEqual({ created: 1, updated: 2, total: 3 });

    expect(postMock).toHaveBeenCalledWith("/dictionary-terms/actions/import", {
      spaceId: "space-1",
      terms: [
        {
          term: "Alpha",
          forms: ["Alphas"],
          definitionMarkdown: "Definition",
        },
      ],
    });
  });

  it("parses exported dictionary JSON", () => {
    expect(
      parseDictionaryImportJson(
        JSON.stringify({
          version: 1,
          exportedAt: "2026-01-01T00:00:00.000Z",
          terms: [
            {
              term: "Alpha",
              forms: ["Alphas"],
              definitionMarkdown: "Definition",
            },
          ],
        }),
      ),
    ).toEqual([
      {
        term: "Alpha",
        forms: ["Alphas"],
        definitionMarkdown: "Definition",
      },
    ]);
  });

  it("parses top-level term arrays", () => {
    expect(
      parseDictionaryImportJson(
        JSON.stringify([
          {
            term: "Alpha",
            definitionMarkdown: "Definition",
          },
        ]),
      ),
    ).toEqual([
      {
        term: "Alpha",
        forms: [],
        definitionMarkdown: "Definition",
      },
    ]);
  });

  it("rejects invalid dictionary JSON shapes", () => {
    expect(() => parseDictionaryImportJson("{")).toThrow(
      "Invalid dictionary JSON file",
    );
    expect(() =>
      parseDictionaryImportJson(JSON.stringify({ terms: [{ term: "Alpha" }] })),
    ).toThrow("Invalid dictionary JSON file");
  });

  it("reads word-form generation availability", async () => {
    getMock.mockResolvedValue({ data: { available: true } });

    await expect(
      getDictionaryWordFormGenerationStatus("space-1"),
    ).resolves.toEqual({ available: true });
    expect(getMock).toHaveBeenCalledWith(
      "/dictionary-terms/word-form-generation/status",
      { params: { spaceId: "space-1" } },
    );
  });

  it("loads one term lazily for search disclosure", async () => {
    getMock.mockResolvedValue({ data: { id: "term-1", forms: [] } });

    await expect(getDictionaryTerm("term-1")).resolves.toEqual({
      id: "term-1",
      forms: [],
    });
    expect(getMock).toHaveBeenCalledWith("/dictionary-terms/term-1");
  });

  it("generates word forms for an unsaved term form", async () => {
    postMock.mockResolvedValue({ data: { forms: ["Alphas"] } });

    await expect(
      generateDictionaryWordForms({
        spaceId: "space-1",
        term: "Alpha",
        forms: [],
      }),
    ).resolves.toEqual({ forms: ["Alphas"] });
    expect(postMock).toHaveBeenCalledWith(
      "/dictionary-terms/actions/generate-word-forms",
      { spaceId: "space-1", term: "Alpha", forms: [] },
    );
  });

  it("generates and saves word forms for all terms", async () => {
    postMock.mockResolvedValue({
      data: { updatedTerms: 2, generatedForms: 4 },
    });

    await expect(generateAllDictionaryWordForms("space-1")).resolves.toEqual({
      updatedTerms: 2,
      generatedForms: 4,
    });
    expect(postMock).toHaveBeenCalledWith(
      "/dictionary-terms/actions/generate-all-word-forms",
      { spaceId: "space-1" },
    );
  });
});
