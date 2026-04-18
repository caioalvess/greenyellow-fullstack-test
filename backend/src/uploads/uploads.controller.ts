import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UploadsService } from './uploads.service';
import { UploadStatus, UploadStatusStore } from './upload-status.store';

type UploadedCsvFile = Express.Multer.File;

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly statusStore: UploadStatusStore,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Envia um CSV pra storage e enfileira o processamento',
    description:
      'Streama o arquivo pro Azure Blob (Azurite em dev), publica uma ' +
      'mensagem em `csv.uploaded` no RabbitMQ e responde imediatamente. ' +
      'O processamento continua em background.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async upload(@UploadedFile() file?: UploadedCsvFile) {
    if (!file) {
      throw new BadRequestException(
        'campo "file" obrigatorio no multipart/form-data',
      );
    }
    return this.uploads.handleUpload(file);
  }

  @Get(':blobName/status')
  @ApiOperation({
    summary: 'Consulta o status de processamento de um CSV',
    description:
      'Retorna `pending | processing | completed | failed` + contagem de ' +
      'linhas processadas. Usado pelo front pra fazer polling.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        blobName: { type: 'string' },
        state: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed'],
        },
        rowsProcessed: { type: 'number' },
        error: { type: 'string', nullable: true },
        startedAt: { type: 'string', format: 'date-time' },
        completedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  getStatus(@Param('blobName') blobName: string): UploadStatus {
    const status = this.statusStore.get(blobName);
    if (!status) {
      throw new NotFoundException(
        `status desconhecido para blob '${blobName}'`,
      );
    }
    return status;
  }
}
