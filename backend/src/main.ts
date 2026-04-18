import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:4200'),
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger UI em /api + JSON puro em /api-json pra quem quiser importar
  // (Postman, Insomnia, gerador de client SDK, etc.).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('GreenYellow — Metrics API')
    .setDescription(
      'Upload streaming de CSVs de métricas, ingestão assíncrona via ' +
        'RabbitMQ, consulta agregada (dia/mês/ano) e relatório Excel.',
    )
    .setVersion('1.0')
    .addTag('uploads', 'Upload e status de processamento de arquivos CSV')
    .addTag('metrics', 'Consulta agregada e geração de relatório')
    .addTag('health', 'Health check dos serviços dependentes')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document, {
    customSiteTitle: 'GreenYellow API',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on port ${port}`, 'Bootstrap');
  Logger.log(`Swagger UI: http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap();
