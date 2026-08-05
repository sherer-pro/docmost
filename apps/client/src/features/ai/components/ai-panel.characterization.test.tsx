// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';

const { atomValues } = vi.hoisted(() => ({
  atomValues: new Map<unknown, unknown>(),
}));

vi.mock('jotai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jotai')>()),
  useAtomValue: (atom: unknown) => atomValues.get(atom),
  useSetAtom: () => vi.fn(),
  useAtom: () => [{}, vi.fn()],
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@mantine/hooks', () => ({
  useMediaQuery: () => false,
  useReducedMotion: () => false,
}));

vi.mock('react-dnd', () => ({
  useDrop: () => [{ isOver: false, isAllowed: false }, vi.fn()],
}));

vi.mock('@tiptap/react', () => ({
  useEditorState: () => '',
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: vi.fn(),
    fetchQuery: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@/features/ai/queries/ai-query.ts', () => {
  const query = () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  const mutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  });

  return {
    useAiChatFilesQuery: query,
    useAiConversationsQuery: query,
    useAiMessagesQuery: query,
    useAiPageAttachmentsQuery: query,
    useAiSpaceStatusQuery: query,
    useAiConversationContextQuery: query,
    useAiRunQuery: query,
    useAiAssistantProfilesQuery: query,
    useAiAssistantProfilePreferencesQuery: query,
    useUpdateAiConversationContextMutation: mutation,
    useCancelAiRunMutation: mutation,
    useCreateAiConversationMutation: mutation,
    useDeleteAiChatFileMutation: mutation,
    useDeleteAiConversationMutation: mutation,
    useRegenerateAiMessageMutation: mutation,
    useRetryAiRunMutation: mutation,
    useSendAiMessageMutation: mutation,
    useUploadAiChatFilesMutation: mutation,
    useOpenAiConversationMutation: mutation,
    useUpdateAiConversationMutation: mutation,
    useApproveAiRunStepMutation: mutation,
    useRejectAiRunStepMutation: mutation,
    useUpdateAiAssistantProfilePreferencesMutation: mutation,
  };
});

import { aiDocumentContextAtom, aiStreamingRunsAtom } from '../atoms/ai-atoms';
import { asideStateAtom } from '@/components/layouts/global/hooks/atoms/sidebar-atom';
import { AiPanel } from './ai-panel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('AiPanel characterization', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    atomValues.clear();
    atomValues.set(aiDocumentContextAtom, null);
    atomValues.set(aiStreamingRunsAtom, {});
    atomValues.set(asideStateAtom, { tab: '', isAsideOpen: false });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps the panel gated until a document context is available', () => {
    act(() => {
      root.render(
        <MantineProvider>
          <AiPanel />
        </MantineProvider>,
      );
    });

    expect(container.textContent).toContain('ai.openDocument');
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
