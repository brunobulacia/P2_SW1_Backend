import { Module } from '@nestjs/common';
import { ZipExportService } from './zip-export.service';
import { SpringGeneratorService } from './spring-generator.service';
import { PostmanGeneratorService } from './postman-generator.service';
import { FlutterGeneratorService } from './flutter-generator.service';
import { ExportController } from './export.controller';
import { DiagramsModule } from 'src/diagrams/diagrams.module';

@Module({
  providers: [
    ZipExportService,
    SpringGeneratorService,
    PostmanGeneratorService,
    FlutterGeneratorService,
  ],
  controllers: [ExportController],
  imports: [DiagramsModule],
})
export class ExportModule {}
