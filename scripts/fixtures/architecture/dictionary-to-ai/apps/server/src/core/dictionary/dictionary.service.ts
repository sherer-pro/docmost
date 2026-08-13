import { AiConfigService } from "../ai/services/ai-config.service";

export class DictionaryService {
  constructor(private readonly aiConfigService: AiConfigService) {}
}
