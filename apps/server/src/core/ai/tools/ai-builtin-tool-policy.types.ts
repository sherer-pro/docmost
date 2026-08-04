import { AiBuiltinToolCapability } from '@docmost/api-contract';

export interface AiBuiltinToolRunSnapshot {
  schemaVersion: 1;
  registryManifestFingerprint: string;
  workspacePolicyVersion: number;
  spacePolicyVersion: number;
  capabilities: AiBuiltinToolCapability[];
  toolNames: string[];
}
