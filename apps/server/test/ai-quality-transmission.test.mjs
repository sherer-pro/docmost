import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  providerTextSegments,
  sourceWasTransmitted,
} from './ai-quality-transmission.mjs';

test('observes multiline evidence in actual JSON reference frames and multimodal text arrays', () => {
  const text = '## Quota\n\nA limit of 200 per organization.';
  const frame = JSON.stringify([
    { reference: 1, content: `Space search sources:\n[S2] Guide\n${text}` },
  ]);
  const requests = [
    {
      transmitted: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: `UNTRUSTED_REFERENCE_DATA_JSON\n${frame}\nEND_UNTRUSTED_REFERENCE_DATA_JSON\nUSER_REQUEST\nWhat is the quota?` }] }],
    },
  ];
  const segments = providerTextSegments(requests);
  assert(sourceWasTransmitted(segments, 'S2', text));
  assert(!sourceWasTransmitted(segments, 'S1', text));
  assert(!sourceWasTransmitted(segments, 'S2', 'An invented value of 100.'));
  assert(sourceWasTransmitted(providerTextSegments([{ transmitted: true, messages: [{ content: frame }] }]), 'S2', text));
  assert.deepEqual(
    providerTextSegments([{ ...requests[0], transmitted: false }]),
    [],
  );
  assert.deepEqual(
    providerTextSegments([{ ...requests[0], transportError: true }]),
    [],
  );
});

test('does not combine unrelated JSON string leaves or accept missing evidence', () => {
  const segments = providerTextSegments([
    {
      transmitted: true,
      messages: [
        {
          content: JSON.stringify({
            label: '[S1]',
            unrelated: 'A private fact.',
          }),
        },
      ],
    },
  ]);
  assert(!sourceWasTransmitted(segments, 'S1', 'A private fact.'));
  assert(!sourceWasTransmitted(['[S1]'], 'S1', ''));
});
