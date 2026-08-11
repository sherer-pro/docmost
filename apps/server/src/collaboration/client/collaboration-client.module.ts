import { Module } from '@nestjs/common';
import { COLLABORATION_DOCUMENT_PORT } from '../collaboration-document.port';
import { CollaborationHttpClientService } from './collaboration-http-client.service';

@Module({
  providers: [
    CollaborationHttpClientService,
    {
      provide: COLLABORATION_DOCUMENT_PORT,
      useExisting: CollaborationHttpClientService,
    },
  ],
  exports: [COLLABORATION_DOCUMENT_PORT],
})
export class CollaborationClientModule {}
