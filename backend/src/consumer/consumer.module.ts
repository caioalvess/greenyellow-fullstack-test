import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsModule } from '../metrics/metrics.module';
import { CsvUpload } from '../uploads/entities/csv-upload.entity';
import { CsvConsumerService } from './csv-consumer.service';

@Module({
  imports: [MetricsModule, TypeOrmModule.forFeature([CsvUpload])],
  providers: [CsvConsumerService],
})
export class ConsumerModule {}
