import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './controllers/dashboard.controller';
import { DashboardService } from './services/dashboard.service';
import {
  TrafficEvent,
  TrafficHourly,
  LlmUsageEvent,
  LlmUsageHourly,
  IpRule,
  IpState,
  Alert,
  AdminSetting,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TrafficEvent,
      TrafficHourly,
      LlmUsageEvent,
      LlmUsageHourly,
      IpRule,
      IpState,
      Alert,
      AdminSetting,
    ], 'core'),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
