import {
  Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards, ParseIntPipe, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { DashboardService } from '../services/dashboard.service';
import { TrafficIngestDto } from '../dto/traffic-ingest.dto';
import { TrafficQueryDto } from '../dto/traffic-query.dto';
import { LlmQueryDto } from '../dto/llm-query.dto';
import { RangeQueryDto } from '../dto/range-query.dto';
import { RuleDto } from '../dto/rule.dto';
import { IpStateDto } from '../dto/ip-state.dto';

@Controller('admin/dashboard')
@UseGuards(AdminGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('traffic/overview')
  async trafficOverview(@Query() query: RangeQueryDto) {
    return this.service.trafficOverview(query);
  }

  @Get('traffic/events')
  async trafficEvents(
    @Query() query: TrafficQueryDto & {
      ip?: string; route?: string; status?: string;
      limit?: string; offset?: string;
    },
  ) {
    const parsed: any = { ...query };
    if (parsed.status) {
      const s = parseInt(parsed.status, 10);
      if (isNaN(s)) throw new BadRequestException('status must be a number');
      parsed.status = s;
    }
    if (parsed.limit) parsed.limit = parseInt(parsed.limit, 10);
    if (parsed.offset) parsed.offset = parseInt(parsed.offset, 10);
    return this.service.trafficEvents(parsed);
  }

  @Post('traffic/ingest')
  async ingestTraffic(@Body() dto: TrafficIngestDto) {
    return this.service.ingestTraffic(dto);
  }

  @Get('llm/overview')
  async llmOverview(@Query() query: LlmQueryDto) {
    return this.service.llmOverview(query);
  }

  @Get('llm/events')
  async llmEvents(
    @Query() query: LlmQueryDto & {
      provider?: string; model?: string;
      limit?: string; offset?: string;
    },
  ) {
    const parsed: any = { ...query };
    if (parsed.limit) parsed.limit = parseInt(parsed.limit, 10);
    if (parsed.offset) parsed.offset = parseInt(parsed.offset, 10);
    return this.service.llmEvents(parsed);
  }

  @Get('ip/rules')
  async ipRules() {
    return this.service.listIpRules();
  }

  @Post('ip/rules')
  async createIpRule(@Body() dto: RuleDto) {
    return this.service.createIpRule(dto);
  }

  @Patch('ip/rules/:id')
  async updateIpRule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<RuleDto>,
  ) {
    const result = await this.service.updateIpRule(id, dto);
    if (!result) throw new NotFoundException('IP rule not found');
    return result;
  }

  @Delete('ip/rules/:id')
  async deleteIpRule(@Param('id', ParseIntPipe) id: number) {
    const ok = await this.service.deleteIpRule(id);
    if (!ok) throw new NotFoundException('IP rule not found');
    return { deleted: true };
  }

  @Post('ip/rules/apply')
  async applyIpRules() {
    return this.service.applyIpRules();
  }

  @Get('ip/states')
  async ipStates(
    @Query() query: { status?: string; limit?: string; offset?: string },
  ) {
    const parsed: any = { ...query };
    if (parsed.limit) parsed.limit = parseInt(parsed.limit, 10);
    if (parsed.offset) parsed.offset = parseInt(parsed.offset, 10);
    return this.service.listIpStates(parsed);
  }

  @Get('ip/states/:ip')
  async getIpState(@Param('ip') ip: string) {
    const result = await this.service.getIpState(ip);
    if (!result) throw new NotFoundException('IP not found');
    return result;
  }

  @Delete('ip/states/:ip')
  async unblockIp(@Param('ip') ip: string) {
    await this.service.unblockIp(ip);
    return { unblocked: true };
  }

  @Get('alerts')
  async alerts(
    @Query() query: { resolved?: string; limit?: string; offset?: string },
  ) {
    const parsed: any = { ...query };
    if (parsed.resolved !== undefined) parsed.resolved = parsed.resolved === 'true';
    if (parsed.limit) parsed.limit = parseInt(parsed.limit, 10);
    if (parsed.offset) parsed.offset = parseInt(parsed.offset, 10);
    return this.service.listAlerts(parsed);
  }

  @Patch('alerts/:id/resolve')
  async resolveAlert(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.resolveAlert(id);
    if (!result) throw new NotFoundException('Alert not found');
    return result;
  }

  @Get('settings')
  async settings() {
    return this.service.getSettings();
  }

  @Patch('settings/:key')
  async setSetting(@Param('key') key: string, @Body('value') value: string) {
    if (!value || typeof value !== 'string') {
      throw new BadRequestException('value is required');
    }
    return this.service.setSetting(key, value);
  }
}
