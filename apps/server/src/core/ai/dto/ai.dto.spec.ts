import 'reflect-metadata';
import {
  UpdateAiOpenWebUiRetrievalConfigDto,
  UpdateAiRetrievalConfigDto,
} from './ai.dto';

describe('AI configuration DTOs', () => {
  it('loads nested Open WebUI DTO metadata without a declaration-order cycle', () => {
    expect(new UpdateAiRetrievalConfigDto()).toBeInstanceOf(
      UpdateAiRetrievalConfigDto,
    );
    expect(new UpdateAiOpenWebUiRetrievalConfigDto()).toBeInstanceOf(
      UpdateAiOpenWebUiRetrievalConfigDto,
    );
  });
});
