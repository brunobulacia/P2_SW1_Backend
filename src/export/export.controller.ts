//export.controller.ts
import {
  Controller,
  Get,
  Query,
  Res,
  Post,
  Body,
  Param,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import { ZipExportService } from './zip-export.service';
import { SpringGeneratorService } from './spring-generator.service';
import { PostmanGeneratorService } from './postman-generator.service';
import { FlutterGeneratorService } from './flutter-generator.service';
import { DiagramsService } from 'src/diagrams/diagrams.service';
import type { Response } from 'express';
import * as path from 'path';

@Controller('export')
export class ExportController {
  constructor(
    private readonly zipExportService: ZipExportService,
    private readonly springGeneratorService: SpringGeneratorService,
    private readonly postmanGeneratorService: PostmanGeneratorService,
    private readonly flutterGeneratorService: FlutterGeneratorService,
    private readonly diagramsService: DiagramsService,
  ) {}

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Genera un proyecto Spring directamente desde un modelo enviado en el body
  @Post('generate-spring')
  async generateSpringFromModel(@Body() body: any, @Res() res: Response) {
    const model = body?.model || body;

    const os = require('os');
    const tmp = path.join(os.tmpdir(), `generated-demo-${Date.now()}`);
    this.ensureDir(tmp);

    await this.springGeneratorService.generateFromModel(model, tmp);

    const zipFilePath = path.join(
      os.tmpdir(),
      `generated-demo-${Date.now()}.zip`,
    );
    await this.zipExportService.exportFolderAsZip(tmp, zipFilePath);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="demo_generated.zip"',
    });

    const zipStream = fs.createReadStream(zipFilePath);
    zipStream.pipe(res);
    zipStream.on('end', () => {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.unlink(zipFilePath, () => {});
      } catch {}
    });
  }

  // Genera un proyecto Spring leyendo el modelo guardado de un diagrama por ID
  @Get('generate-spring/:id')
  async generateSpringFromDiagram(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const diagram = await this.diagramsService.findOne(id).catch(() => null);
    if (!diagram)
      throw new NotFoundException(`Diagram with id ${id} not found`);

    const model = (diagram as any).model;

    const os = require('os');
    const tmp = path.join(os.tmpdir(), `generated-demo-${Date.now()}`);
    this.ensureDir(tmp);

    await this.springGeneratorService.generateFromModel(model, tmp);

    const zipFilePath = path.join(
      os.tmpdir(),
      `generated-demo-${Date.now()}.zip`,
    );
    await this.zipExportService.exportFolderAsZip(tmp, zipFilePath);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="demo_generated.zip"',
    });

    const zipStream = fs.createReadStream(zipFilePath);
    zipStream.pipe(res);
    zipStream.on('end', () => {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.unlink(zipFilePath, () => {});
      } catch {}
    });
  }

  // Generar collections de Postman desde el modelo
  @Post('generate-postman')
  async generatePostmanFromModel(@Body() body: any, @Res() res: Response) {
    const collections =
      this.postmanGeneratorService.generateCollectionsFromModel(body);

    res.set({
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="postman-collections.json"',
    });

    res.json(collections);
  }

  // Generar collections de Postman desde un diagrama por ID
  @Get('generate-postman/:id')
  async generatePostmanFromDiagram(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const diagram = await this.diagramsService.findOne(id).catch(() => null);
    if (!diagram)
      throw new NotFoundException(`Diagram with id ${id} not found`);

    const model = (diagram as any).model;
    const collections =
      this.postmanGeneratorService.generateCollectionsFromModel(model);

    res.set({
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="postman-collections.json"',
    });

    res.json(collections);
  }

  // generar flutter desde modelo 
  @Post('generate-flutter')
  async generateFlutterFromModel(@Body() body: any, @Res() res: Response) {
    const model = body?.model || body;

    const os = require('os');
    const tmp = path.join(os.tmpdir(), `flutter-app-${Date.now()}`);
    this.ensureDir(tmp);

    await this.flutterGeneratorService.generateFromModel(model, tmp);

    const zipFilePath = path.join(
      os.tmpdir(),
      `flutter-app-${Date.now()}.zip`,
    );
    await this.zipExportService.exportFolderAsZip(tmp, zipFilePath);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="flutter_app.zip"',
    });

    const zipStream = fs.createReadStream(zipFilePath);
    zipStream.pipe(res);
    zipStream.on('end', () => {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.unlink(zipFilePath, () => {});
      } catch {}
    });
  }

  // generar flutter desde diagrama por id
  @Get('generate-flutter/:id')
  async generateFlutterFromDiagram(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const diagram = await this.diagramsService.findOne(id).catch(() => null);
    if (!diagram)
      throw new NotFoundException(`Diagram with id ${id} not found`);

    const model = (diagram as any).model;

    const os = require('os');
    const tmp = path.join(os.tmpdir(), `flutter-app-${Date.now()}`);
    this.ensureDir(tmp);

    await this.flutterGeneratorService.generateFromModel(model, tmp);

    const zipFilePath = path.join(
      os.tmpdir(),
      `flutter-app-${Date.now()}.zip`,
    );
    await this.zipExportService.exportFolderAsZip(tmp, zipFilePath);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="flutter_app.zip"',
    });

    const zipStream = fs.createReadStream(zipFilePath);
    zipStream.pipe(res);
    zipStream.on('end', () => {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.unlink(zipFilePath, () => {});
      } catch {}
    });
  }
}
