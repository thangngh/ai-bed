import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { MemoryItem } from './entities/memory-item.entity';
import memoryConfig from '../../config/memory.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([MemoryItem], 'core'),
    ConfigModule.forFeature(memoryConfig),
  ],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
