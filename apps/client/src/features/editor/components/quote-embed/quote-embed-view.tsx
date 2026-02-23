import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Alert, Loader, Stack, Text } from "@mantine/core";
import { IconQuote, IconAlertCircle } from "@tabler/icons-react";
import { getQuoteContent } from "@/features/page/services/page-service";

/**
 * Отрисовывает встраиваемую цитату и регулярно обновляет её содержимое.
 *
 * Мы используем короткий polling-интервал, чтобы целевой документ
 * получал изменения из документа-источника практически сразу.
 */
export default function QuoteEmbedView(props: NodeViewProps) {
  const { node } = props;
  const { sourcePageId, quoteId } = node.attrs;

  const [text, setText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isDisposed = false;

    const loadQuote = async () => {
      try {
        const result = await getQuoteContent({ sourcePageId, quoteId });

        if (!isDisposed) {
          setText(result.text);
          setError(null);
          setIsLoading(false);
        }
      } catch (err) {
        if (!isDisposed) {
          setError("Failed to load quote content");
          setIsLoading(false);
        }
      }
    };

    void loadQuote();
    const timer = window.setInterval(loadQuote, 1500);

    return () => {
      isDisposed = true;
      window.clearInterval(timer);
    };
  }, [sourcePageId, quoteId]);

  return (
    <NodeViewWrapper data-drag-handle>
      <Alert icon={<IconQuote size={16} />} title="Linked quote" radius="md" variant="light">
        <Stack gap={6}>
          <Text size="xs" c="dimmed">
            {quoteId}
          </Text>

          {isLoading ? (
            <Loader size="sm" />
          ) : error ? (
            <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
              {error}
            </Alert>
          ) : (
            <Text style={{ whiteSpace: "pre-wrap" }}>{text || "—"}</Text>
          )}
        </Stack>
      </Alert>
    </NodeViewWrapper>
  );
}
