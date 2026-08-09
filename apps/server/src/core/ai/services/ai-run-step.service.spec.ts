jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { approvedStepRecoveryAction } from './ai-run-step-recovery';
import { AiRunStepService } from './ai-run-step.service';

describe('approvedStepRecoveryAction', () => {
  const base = 'a'.repeat(64);
  const expected = 'b'.repeat(64);

  it('reapplies a durable approval only when the page is still at its base hash', () => {
    expect(approvedStepRecoveryAction(base, expected, base)).toBe('apply');
  });

  it('completes recovery without replay when the expected hash is already live', () => {
    expect(approvedStepRecoveryAction(base, expected, expected)).toBe(
      'complete',
    );
  });

  it('fails safely for a conflicting page or a legacy step without an expected hash', () => {
    expect(approvedStepRecoveryAction(base, expected, 'c'.repeat(64))).toBe(
      'stale',
    );
    expect(approvedStepRecoveryAction(base, null, base)).toBe('stale');
  });
});

describe('AiRunStepService approval lifecycle', () => {
  const user = { id: 'initiator' } as any;
  const workspace = { id: 'workspace' } as any;
  const run = {
    id: 'run',
    userId: user.id,
    workspaceId: workspace.id,
    status: 'awaiting_approval',
  } as any;
  const pendingStep = {
    id: 'step',
    runId: run.id,
    status: 'pending_approval',
    result: { expectedAfterHash: 'b'.repeat(64) },
    expiresAt: new Date(Date.now() + 60_000),
  } as any;

  function createService() {
    const runs = {
      getOwnedRun: jest.fn(async () => run),
      withProviderAdmission: jest.fn(async () => ({
        ...pendingStep,
        status: 'approved',
        decidedById: user.id,
      })),
      toRun: jest.fn((value) => value),
      enqueue: jest.fn(async () => true),
    };
    const service = new AiRunStepService(
      {} as any,
      runs as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'getPendingStep').mockResolvedValue(pendingStep);
    return { service, runs };
  }

  it('checks run ownership before reading an approval step', async () => {
    const { service, runs } = createService();
    runs.getOwnedRun.mockRejectedValueOnce(
      new NotFoundException('AI run not found'),
    );

    await expect(
      service.approve(run.id, pendingStep.id, {} as any, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((service as any).getPendingStep).not.toHaveBeenCalled();
    expect(runs.withProviderAdmission).not.toHaveBeenCalled();
  });

  it('expires a proposal instead of claiming it after its deadline', async () => {
    const { service, runs } = createService();
    (service as any).getPendingStep.mockResolvedValueOnce({
      ...pendingStep,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const resumed = {
      run: { ...run, status: 'queued' },
      step: { ...pendingStep, status: 'expired' },
    };
    const decide = jest
      .spyOn(service as any, 'decideAndResume')
      .mockResolvedValue(resumed);

    await expect(
      service.approve(run.id, pendingStep.id, user, workspace),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'agent_write_expired' }),
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'expired',
        errorCode: 'agent_write_expired',
      }),
    );
    expect(runs.withProviderAdmission).not.toHaveBeenCalled();
  });

  it('claims and recovers one approval while a duplicate fails closed', async () => {
    const { service, runs } = createService();
    const recovered = {
      run: { ...run, status: 'queued' },
      step: { ...pendingStep, status: 'approved' },
    };
    const recover = jest
      .spyOn(service as any, 'recoverApprovedStep')
      .mockResolvedValueOnce(recovered);

    await expect(
      service.approve(run.id, pendingStep.id, user, workspace),
    ).resolves.toEqual(recovered);

    runs.withProviderAdmission.mockResolvedValueOnce(undefined);
    await expect(
      service.approve(run.id, pendingStep.id, user, workspace),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('rejects through the same atomic decide-and-resume path', async () => {
    const { service, runs } = createService();
    const resumed = {
      run: { ...run, status: 'queued' },
      step: { ...pendingStep, status: 'rejected' },
    };
    const decide = jest
      .spyOn(service as any, 'decideAndResume')
      .mockResolvedValue(resumed);

    await expect(
      service.reject(run.id, pendingStep.id, user, workspace),
    ).resolves.toEqual(resumed);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        errorCode: 'agent_write_rejected',
      }),
    );
    expect(runs.withProviderAdmission).not.toHaveBeenCalled();
  });
});
