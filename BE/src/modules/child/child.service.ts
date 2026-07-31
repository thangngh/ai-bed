import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ChildProfile } from './entities/child-profile.entity';
import { CreateChildProfileDto } from './dto/child-profile.dto';
import { UpdateChildProfileDto } from './dto/update-child-profile.dto';

@Injectable()
export class ChildService {
  private repo: Repository<ChildProfile>;

  constructor(@InjectDataSource('core') private dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(ChildProfile);
  }

  async getOrCreate(tenantId: string, dto: CreateChildProfileDto): Promise<ChildProfile> {
    const existing = await this.repo.findOne({
      where: { tenantId, childName: dto.child_name },
    });
    if (existing) return existing;

    const profile = new ChildProfile();
    profile.childId = uuidv4();
    profile.tenantId = tenantId;
    profile.childName = dto.child_name;
    profile.age = dto.age;
    profile.interests = dto.interests || null;
    profile.preferredCharacters = dto.preferred_characters || null;
    profile.bedtimeGoal = dto.bedtime_goal || null;
    profile.gender = dto.gender || null;
    return this.repo.save(profile);
  }

  async findByTenant(tenantId: string): Promise<ChildProfile[]> {
    return this.repo.find({ where: { tenantId, isActive: 1 } });
  }

  async findByName(tenantId: string, childName: string): Promise<ChildProfile | null> {
    return this.repo.findOne({ where: { tenantId, childName, isActive: 1 } });
  }

  async findById(childId: string): Promise<ChildProfile | null> {
    return this.repo.findOne({ where: { childId } });
  }

  async update(childId: string, tenantId: string, dto: UpdateChildProfileDto): Promise<ChildProfile> {
    const profile = await this.repo.findOne({ where: { childId, tenantId } });
    if (!profile) throw new NotFoundException('Child profile not found');
    if (dto.age !== undefined) profile.age = dto.age;
    if (dto.interests !== undefined) profile.interests = dto.interests;
    if (dto.preferred_characters !== undefined) profile.preferredCharacters = dto.preferred_characters;
    if (dto.bedtime_goal !== undefined) profile.bedtimeGoal = dto.bedtime_goal;
    if (dto.gender !== undefined) profile.gender = dto.gender;
    return this.repo.save(profile);
  }

  async delete(childId: string, tenantId: string): Promise<void> {
    const profile = await this.repo.findOne({ where: { childId, tenantId } });
    if (!profile) throw new NotFoundException('Child profile not found');
    profile.isActive = 0;
    await this.repo.save(profile);
  }
}
