import { Module } from '@nestjs/common';
import { DiagramsService } from './diagrams.service';
import { DiagramsController } from './diagrams.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DiagramsController],
  providers: [DiagramsService],
  exports: [DiagramsService],
})
export class DiagramsModule {}
