import { Module } from '@nestjs/common';
import { WatcherService } from './watcher.service';
import { CaslModule } from '../casl/casl.module';

@Module({
  imports: [CaslModule],
  // Watchers are managed internally; no public watcher HTTP endpoints are registered here.
  controllers: [],
  providers: [WatcherService],
  exports: [WatcherService],
})
export class WatcherModule {}
