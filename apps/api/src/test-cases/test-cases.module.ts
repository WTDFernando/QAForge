import { Module } from '@nestjs/common';
import { SharedStepsController, SharedStepsService } from './shared-steps.controller';
import { TestCasesController } from './test-cases.controller';
import { TestCasesService } from './test-cases.service';

@Module({
  controllers: [TestCasesController, SharedStepsController],
  providers: [TestCasesService, SharedStepsService],
  exports: [TestCasesService],
})
export class TestCasesModule {}
