import type {
  DocmostImportOptions,
  ImportPreview,
  ImportReport,
} from "@docmost/api-contract";

export interface IFileTask {
  id: string;
  type: "import" | "export";
  source: string;
  status: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileExt: string;
  errorMessage: string | null;
  creatorId: string;
  spaceId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  options?: DocmostImportOptions | null;
  result?: {
    preview?: ImportPreview;
    report?: ImportReport;
  } | null;
}
