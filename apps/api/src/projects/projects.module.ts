import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectMembersController } from './project-members.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController, ProjectMembersController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
