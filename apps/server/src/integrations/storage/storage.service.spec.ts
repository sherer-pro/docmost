import { Test, TestingModule } from '@nestjs/testing';
import { StorageService } from './storage.service';
import { STORAGE_DRIVER_TOKEN } from './constants/storage.constants';

describe('StorageService', () => {
  let service: StorageService;
  const storageDriver = { readStream: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: STORAGE_DRIVER_TOKEN,
          useValue: storageDriver,
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('forwards an optional abort signal when acquiring a read stream', async () => {
    const signal = new AbortController().signal;
    const stream = {} as any;
    storageDriver.readStream.mockResolvedValue(stream);

    await expect(service.readStream('file.txt', signal)).resolves.toBe(stream);
    expect(storageDriver.readStream).toHaveBeenCalledWith('file.txt', signal);
  });
});
