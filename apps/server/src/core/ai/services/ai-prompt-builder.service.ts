import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { AiRun } from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AiProviderMessage, AiSafeRetrievalSource } from '../ai.types';
import type { AiResolvedRunContextSource } from './ai-context.service';

interface PromptFileSource {
  sourceTitle: string;
}

interface PromptImage {
  type: 'image_url';
  image_url: { url: string };
}

@Injectable()
export class AiPromptBuilderService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async build(params: {
    run: AiRun;
    instructions: string | null;
    currentUserContent: string;
    fileText: string;
    fileSources: PromptFileSource[];
    contextSources: AiResolvedRunContextSource[];
    images: PromptImage[];
    retrievalSources: AiSafeRetrievalSource[];
    contextWindow: number;
    maxOutputTokens: number;
  }): Promise<AiProviderMessage[]> {
    const {
      run,
      instructions,
      currentUserContent,
      fileText,
      fileSources,
      contextSources,
      images,
      retrievalSources,
      contextWindow,
      maxOutputTokens,
    } = params;
    const maxChars = Math.min(
      2_000_000,
      Math.max(4_000, (contextWindow - maxOutputTokens) * 3),
    );
    const currentPrompt = currentUserContent.slice(0, maxChars);
    const baseInstructions = [
      instructions || 'You are a document assistant. Be accurate and concise.',
      'Cite only server-provided [S1], [S2], and similar markers. Never invent source markers.',
    ].join('\n\n');
    const available = Math.max(
      0,
      maxChars - currentPrompt.length - baseInstructions.length,
    );
    const primaryBudget = Math.floor(available * 0.25);
    const explicitBudget = Math.floor(available * 0.25);
    const fileBudget = Math.floor(available * 0.2);
    const historyBudget = Math.floor(available * 0.2);
    const retrievalBudget =
      available - primaryBudget - explicitBudget - fileBudget - historyBudget;

    const currentDocument = contextSources.find(
      (source) => source.origin === 'current_document',
    );
    const explicitSources = contextSources.filter(
      (source) => source.origin === 'explicit',
    );
    const currentDocumentMarkdown =
      currentDocument?.markdown || run.documentSnapshot;
    const primaryContext = run.selectionText
      ? `Selected text (${run.selectionFrom}-${run.selectionTo}):\n${run.selectionText}`
      : currentDocumentMarkdown
        ? `Current document snapshot:\n${currentDocumentMarkdown}`
        : '';
    const explicitContext = explicitSources.length
      ? `Selected context sources:\n${explicitSources
          .map(
            (source, index) =>
              `[S${index + 1}] ${source.sourceTitle}\n${source.markdown}`,
          )
          .join('\n\n')}`
      : '';
    const fileLabels = fileSources.length
      ? `Attached source labels:\n${fileSources
          .map(
            (source, index) =>
              `[S${explicitSources.length + index + 1}] ${source.sourceTitle}`,
          )
          .join('\n')}`
      : '';
    const retrievalContext = retrievalSources.length
      ? `Space search sources:\n${retrievalSources
          .map(
            (source, index) =>
              `[S${explicitSources.length + fileSources.length + index + 1}] ${source.sourceTitle}\n${source.excerpt}`,
          )
          .join('\n\n')}`
      : '';
    const context = [
      baseInstructions,
      this.truncate(primaryContext, primaryBudget),
      this.truncate(explicitContext, explicitBudget),
      this.truncate(
        [fileLabels, fileText].filter(Boolean).join('\n\n'),
        fileBudget,
      ),
      this.truncate(retrievalContext, retrievalBudget),
    ]
      .filter(Boolean)
      .join('\n\n');

    const history = await this.loadCompleteHistory(run, historyBudget);
    return [
      { role: 'system', content: context },
      ...history,
      {
        role: 'user',
        content: images.length
          ? [{ type: 'text', text: currentPrompt }, ...images]
          : currentPrompt,
      },
    ];
  }

  private async loadCompleteHistory(
    run: AiRun,
    budget: number,
  ): Promise<AiProviderMessage[]> {
    if (budget <= 0) return [];
    const rows = await this.db
      .selectFrom('aiMessages')
      .select(['id', 'role', 'content', 'createdAt'])
      .where('conversationId', '=', run.conversationId)
      .where('id', 'not in', [run.userMessageId, run.assistantMessageId])
      .where('status', '=', 'completed')
      .where((eb) =>
        eb.or([
          eb('createdAt', '<', run.createdAt),
          eb.and([
            eb('createdAt', '=', run.createdAt),
            eb('id', '<', run.userMessageId),
          ]),
        ]),
      )
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(40)
      .execute();

    const chronological = rows.reverse();
    const pairs: Array<[AiProviderMessage, AiProviderMessage]> = [];
    for (let index = 0; index < chronological.length - 1; index += 1) {
      const user = chronological[index];
      const assistant = chronological[index + 1];
      if (
        user.role !== 'user' ||
        assistant.role !== 'assistant' ||
        !user.content ||
        !assistant.content
      ) {
        continue;
      }
      pairs.push([
        { role: 'user', content: user.content },
        { role: 'assistant', content: assistant.content },
      ]);
      index += 1;
    }

    let remaining = budget;
    const selected: Array<[AiProviderMessage, AiProviderMessage]> = [];
    for (const pair of pairs.reverse()) {
      if (selected.length >= 10) break;
      const pairChars =
        String(pair[0].content).length + String(pair[1].content).length;
      if (pairChars > remaining) continue;
      selected.push(pair);
      remaining -= pairChars;
    }
    return selected.reverse().flat();
  }

  private truncate(value: string, limit: number): string {
    if (!value || limit <= 0) return '';
    return value.slice(0, limit);
  }
}
