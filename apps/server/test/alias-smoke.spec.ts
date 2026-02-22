import { dbOrTx } from '@docmost/db/utils';
import { formatDate } from '@docmost/transactional/utils/utils';

describe('Alias resolution smoke test', () => {
  it('resolves @docmost/db and @docmost/transactional aliases', () => {
    expect(typeof dbOrTx).toBe('function');
    expect(typeof formatDate).toBe('function');
  });
});
