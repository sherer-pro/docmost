import {
  closeApplicationOnStartupFailure,
  DatabaseConnectionError,
  terminateStartup,
} from './startup.errors';

describe('startup failure handling', () => {
  it('closes a partially initialized application', async () => {
    const close = jest.fn().mockResolvedValue(undefined);

    await closeApplicationOnStartupFailure({ close }, 100);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not wait forever for a blocked application close', async () => {
    jest.useFakeTimers();
    const close = jest.fn(() => new Promise(() => undefined));
    const cleanup = closeApplicationOnStartupFailure({ close }, 100);

    await jest.advanceTimersByTimeAsync(100);
    await expect(cleanup).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('ignores cleanup errors so fatal termination can continue', async () => {
    const close = jest.fn().mockRejectedValue(new Error('close failed'));

    await expect(
      closeApplicationOnStartupFailure({ close }, 100),
    ).resolves.toBeUndefined();
  });

  it('forces a non-zero exit even when other handles remain open', () => {
    const exit = jest.fn((code: number): never => {
      throw new Error(`exit:${code}`);
    });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    expect(() =>
      terminateStartup(new DatabaseConnectionError(15), exit),
    ).toThrow('exit:1');
    expect(exit).toHaveBeenCalledWith(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to connect to the database after 15 attempts',
    );

    consoleError.mockRestore();
  });
});
