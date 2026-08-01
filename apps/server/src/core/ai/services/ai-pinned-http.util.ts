import { Agent, Dispatcher } from 'undici';
import type { AiResolvedAddress } from './ai-outbound-url-policy.service';

export type AiPinnedDispatcher = {
  dispatcher: Dispatcher;
  close: () => Promise<void>;
};

export function createAiPinnedDispatcher(
  approvedAddresses: readonly AiResolvedAddress[],
): AiPinnedDispatcher {
  if (approvedAddresses.length === 0) {
    throw new Error('AI outbound request has no approved address');
  }

  const dispatcher = new Agent({
    connect: {
      lookup: ((
        _hostname: string,
        options: { all?: boolean; family?: number } | number,
        callback: (
          error: NodeJS.ErrnoException | null,
          address?: string | Array<{ address: string; family: number }>,
          family?: number,
        ) => void,
      ) => {
        const requestedFamily =
          typeof options === 'number' ? options : options?.family;
        const candidates = approvedAddresses.filter(
          (entry) =>
            requestedFamily !== 4 &&
            requestedFamily !== 6 ||
            entry.family === requestedFamily,
        );
        if (candidates.length === 0) {
          const error = new Error(
            'No approved address matches the requested family',
          ) as NodeJS.ErrnoException;
          error.code = 'ENOTFOUND';
          callback(error);
          return;
        }

        if (typeof options !== 'number' && options?.all) {
          callback(
            null,
            candidates.map((entry) => ({
              address: entry.address,
              family: entry.family,
            })),
          );
          return;
        }

        callback(null, candidates[0].address, candidates[0].family);
      }) as never,
    },
  });

  return {
    dispatcher,
    close: () => dispatcher.destroy(),
  };
}
