import { Module } from '@nestjs/common';
import { EngineGatewayService } from './engine-gateway.service';
import engineConfig from './engine.config';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forFeature(engineConfig)],
  providers: [EngineGatewayService],
  exports: [EngineGatewayService],
})
export class EngineGatewayModule {}
