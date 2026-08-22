import { Controller, Post, Get, Put, Delete, Param, Body, Query, Req, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { ChildService } from './child.service';
import { ChildProfile } from './entities/child-profile.entity';
import { CreateChildProfileDto } from './dto/child-profile.dto';
import { UpdateChildProfileDto } from './dto/update-child-profile.dto';

@Controller('child-profile')
export class ChildController {
  constructor(private readonly childService: ChildService) {}

  /**
   * One shape for every response.
   *
   * Each handler used to build its own object and all of them stopped at
   * name/age, so the SPA's editor could not prefill the rest -- it sent blanks
   * back and wiped the fields the Engine writes stories from. Keeping this in
   * one place is what stops the four responses drifting apart again.
   */
  private toResponse(p: ChildProfile) {
    return {
      child_id: p.childId,
      child_name: p.childName,
      age: p.age,
      gender: p.gender ?? null,
      interests: p.interests ?? null,
      preferred_characters: p.preferredCharacters ?? null,
      bedtime_goal: p.bedtimeGoal ?? null,
    };
  }

  @Post()
  async create(@Body() dto: CreateChildProfileDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.toResponse(await this.childService.create(tenantId, dto));
  }

  @Get()
  async get(@Query('child_name') childName: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    if (childName) {
      const found = await this.childService.findByName(tenantId, childName);
      // The miss keeps its bare shape: the SPA tests `data.child_id` for null.
      return found ? this.toResponse(found) : { child_id: null };
    }
    const profiles = await this.childService.findByTenant(tenantId);
    return { children: profiles.map(p => this.toResponse(p)) };
  }

  @Put(':childId')
  async update(
    @Param('childId') childId: string,
    @Body() dto: UpdateChildProfileDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return this.toResponse(await this.childService.update(childId, tenantId, dto));
  }

  /**
   * POST compatibility route for deployments whose upstream proxy blocks PUT.
   * Keep the PUT route above for existing API consumers.
   */
  @Post(':childId/update')
  @HttpCode(200)
  async updateViaPost(
    @Param('childId') childId: string,
    @Body() dto: UpdateChildProfileDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return this.toResponse(await this.childService.update(childId, tenantId, dto));
  }

  @Delete(':childId')
  @HttpCode(204)
  async delete(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    await this.childService.delete(childId, tenantId);
  }

  /**
   * POST compatibility route for deployments whose upstream proxy blocks DELETE.
   * It intentionally keeps the original 204/no-body response contract.
   */
  @Post(':childId/delete')
  @HttpCode(204)
  async deleteViaPost(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    await this.childService.delete(childId, tenantId);
  }
}
