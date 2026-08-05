import {
  getMailErrorMetadata,
  getMailLogMetadata,
} from './mail-log-metadata.util';

describe('mail log metadata', () => {
  it('reports sizes without returning message content or the recipient', () => {
    const metadata = getMailLogMetadata({
      to: 'person@example.com',
      subject: 'Private subject',
      text: 'https://example.com/invites/id?token=secret',
      html: '<p>Private body</p>',
    });

    expect(metadata).toEqual({
      recipientPresent: true,
      subjectLength: 15,
      textBytes: 43,
      htmlBytes: 19,
    });
    expect(JSON.stringify(metadata)).not.toContain('person@example.com');
    expect(JSON.stringify(metadata)).not.toContain('secret');
  });

  it('keeps only a bounded machine-readable error code', () => {
    const error = Object.assign(new Error('recipient leaked here'), {
      code: 'ECONNECTION',
    });

    expect(getMailErrorMetadata(error)).toEqual({
      errorName: 'Error',
      errorCode: 'ECONNECTION',
    });
  });
});
