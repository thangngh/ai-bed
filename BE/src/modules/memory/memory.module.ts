import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { MemoryItem } from './entities/memory-item.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MemoryItem], 'local')],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
