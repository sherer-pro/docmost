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
      status: 200,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `UNTRUSTED_REFERENCE_DATA_JSON\n${frame}\nEND_UNTRUSTED_REFERENCE_DATA_JSON\nUSER_REQUEST\nWhat is the quota?`,
            },
          ],
        },
      ],
    },
  ];
  const segments = providerTextSegments(requests);
  assert(sourceWasTransmitted(segments, 'S2', text));
  assert(!sourceWasTransmitted(segments, 'S1', text));
  assert(!sourceWasTransmitted(segments, 'S2', 'An invented value of 100.'));
  assert(
    sourceWasTransmitted(
      providerTextSegments([
        { transmitted: true, status: 200, messages: [{ content: frame }] },
      ]),
      'S2',
      text,
    ),
  );
  assert.deepEqual(
    providerTextSegments([{ ...requests[0], transmitted: false }]),
    [],
  );
  assert.deepEqual(
    providerTextSegments([
      { ...requests[0], status: undefined, transportError: true },
    ]),
    [],
  );
});

test('does not combine unrelated JSON string leaves or accept missing evidence', () => {
  const segments = providerTextSegments([
    {
      transmitted: true,
      status: 200,
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

test('observes exact input evidence after a confirmed successful response has a transport error', () => {
  const text = '## Terms\n\nThe minimum term is 12 months.';
  const content = `UNTRUSTED_REFERENCE_DATA_JSON\n${JSON.stringify([
    { reference: 1, content: `[S3] Terms\n${text}` },
  ])}\nEND_UNTRUSTED_REFERENCE_DATA_JSON\nUSER_REQUEST\nWhat is the term?`;
  for (const status of [200, 201, 299]) {
    const segments = providerTextSegments([
      {
        transmitted: true,
        status,
        transportError: true,
        messages: [{ content }],
      },
    ]);
    assert(sourceWasTransmitted(segments, 'S3', text));
    assert(!sourceWasTransmitted(segments, 'S2', text));
    assert(!sourceWasTransmitted(segments, 'S3', text.replace('12', '6')));
    assert(!sourceWasTransmitted(segments, 'S3', text.replaceAll('\n', ' ')));
  }
});

test('rejects failed, unknown and unconfirmed delivery even when input text is present', () => {
  const messages = [{ content: '[S1] Exact evidence.' }];
  for (const status of [undefined, null, 0, 199, 300, 400, 500, '200']) {
    for (const transportError of [undefined, false, true])
      assert.deepEqual(
        providerTextSegments([
          { transmitted: true, status, transportError, messages },
        ]),
        [],
      );
  }
  for (const transmitted of [false, null, undefined, 1]) {
    assert.deepEqual(
      providerTextSegments([
        { transmitted, status: 200, transportError: true, messages },
      ]),
      [],
    );
  }
  assert.deepEqual(
    providerTextSegments([{ transmitted: true, status: 400, messages }]),
    [],
  );
  assert.deepEqual(
    providerTextSegments([
      { transmitted: true, status: 200, transportError: true, messages: [] },
    ]),
    [],
  );
});
