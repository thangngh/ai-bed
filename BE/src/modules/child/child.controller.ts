import { Controller, Post, Get, Put, Delete, Param, Body, Query, Req, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { ChildService } from './child.service';
import { CreateChildProfileDto } from './dto/child-profile.dto';
import { UpdateChildProfileDto } from './dto/update-child-profile.dto';

@Controller('child-profile')
export class ChildController {
  constructor(private readonly childService: ChildService) {}

  @Post()
  async create(@Body() dto: CreateChildProfileDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const profile = await this.childService.getOrCreate(tenantId, dto);
    return { child_id: profile.childId, child_name: profile.childName, age: profile.age };
  }

  @Get()
  async get(@Query('child_name') childName: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    if (childName) {
      const profiles = await this.childService.findByTenant(tenantId);
      const found = profiles.find(p => p.childName === childName);
      return found ? { child_id: found.childId, child_name: found.childName, age: found.age } : { child_id: null };
    }
    const profiles = await this.childService.findByTenant(tenantId);
    return { children: profiles.map(p => ({ child_id: p.childId, child_name: p.childName, age: p.age })) };
  }

  @Put(':childId')
  async update(
    @Param('childId') childId: string,
    @Body() dto: UpdateChildProfileDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const profile = await this.childService.update(childId, tenantId, dto);
    return { child_id: profile.childId, child_name: profile.childName, age: profile.age };
  }

  @Delete(':childId')
  @HttpCode(204)
  async delete(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    await this.childService.delete(childId, tenantId);
  }
}
