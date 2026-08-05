export interface AiQuickCommand {
  id: string;
  label: string;
  prompt: string;
  description?: string;
  enabled: boolean;
  position: number;
}
