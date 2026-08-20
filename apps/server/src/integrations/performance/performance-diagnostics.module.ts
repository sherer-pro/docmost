import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PerformanceDiagnosticsInterceptor } from './performance-diagnostics.interceptor';
import { PerformanceDiagnosticsService } from './performance-diagnostics.service';

@Module({
  providers: [
    PerformanceDiagnosticsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: PerformanceDiagnosticsInterceptor,
    },
  ],
})
export class PerformanceDiagnosticsModule {}
