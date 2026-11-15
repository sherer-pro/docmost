import type { User } from '@docmost/db/types/entity.types';
import type {
  AiDatabaseContext,
  AiDatabaseCellOperation,
} from '@docmost/api-contract';
import type { AiPageOperation } from '../../../common/helpers/prosemirror/ai-page-operation';
import type { AiCitationCandidate } from '../ai.types';

export type AiToolExposure = 'agent' | 'mcp';
export type AiToolWriteClass = 'read_only' | 'write';

export type AiToolExecutionContext = {
  user: User;
  workspaceId: string;
  spaceId: string;
  currentPageId?: string;
  databaseContext?: AiDatabaseContext;
  source: AiToolExposure;
};

export type AiToolWriteProposal = {
  pageId: string;
  baseContentHash: string | null;
  expectedAfterHash: string | null;
  operation: AiPageOperation | AiDatabaseCellOperation;
};

export type AiToolExecutionResult = {
  dependencyPageIds?: string[];
  content: unknown;
  writeProposal?: AiToolWriteProposal;
  citations?: Array<Omit<AiCitationCandidate, 'marker'>>;
};
