import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  /** A profile the parent asked for explicitly. Names are display labels; the
   * UUID is the identity, so siblings may deliberately share the same name. */
  async create(tenantId: string, dto: CreateChildProfileDto): Promise<ChildProfile> {
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

  /**
   * The profile for this child, creating it on first use.
   *
   * The age on an existing profile is refreshed from the request rather than
   * kept, and that is a safety decision, not a convenience one. `StoryService`
   * sends `child.age` to the Engine, which picks the developer prompt and the
   * age-appropriate rules from it -- so a stale age means a story written to
   * the wrong rules for the child in front of it. This lookup matches on name
   * alone, so it used to return a profile created a year ago and silently
   * discard the age the parent had just re-entered on the form: a 3-year-old
   * kept getting stories written for the 5-6 band.
   *
   * The value is safe to trust here because it is the same validated field the
   * DTO bounded to 3..6, and the Engine bounds it again.
   */
  async getOrCreate(tenantId: string, dto: CreateChildProfileDto): Promise<ChildProfile> {
    // Deleted profiles must not match: a name that comes back is a new child
    // as far as stories, memories and analytics are concerned. Without this
    // filter the dead row was returned, the API reported success, and the
    // child never appeared in `findByTenant` again.
    const matches = await this.repo.find({
      where: { tenantId, childName: dto.child_name, isActive: 1 },
      order: { createdAt: 'ASC' },
    });
    // Modern clients always send child_id. A name-only legacy request is safe
    // only while that name identifies exactly one active profile; choosing an
    // arbitrary sibling here would attach stories, memories and analytics to
    // the wrong UUID.
    if (matches.length > 1) {
      throw new BadRequestException('child_id is required when multiple child profiles share a name');
    }
    const existing = matches[0];
    if (existing) {
      if (existing.age !== dto.age) {
        existing.age = dto.age;
        return this.repo.save(existing);
      }
      return existing;
    }

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
    // Without an explicit order the list is whatever Postgres hands back, so the
    // children could swap places between two loads of the same screen.
    return this.repo.find({ where: { tenantId, isActive: 1 }, order: { createdAt: 'ASC' } });
  }

  async findByName(tenantId: string, childName: string): Promise<ChildProfile | null> {
    const matches = await this.repo.find({
      where: { tenantId, childName, isActive: 1 },
      order: { createdAt: 'ASC' },
      take: 2,
    });
    // A singular name lookup must never guess between duplicate profiles.
    return matches.length === 1 ? matches[0] : null;
  }

  async findById(childId: string): Promise<ChildProfile | null> {
    return this.repo.findOne({ where: { childId } });
  }

  async update(childId: string, tenantId: string, dto: UpdateChildProfileDto): Promise<ChildProfile> {
    const profile = await this.repo.findOne({ where: { childId, tenantId, isActive: 1 } });
    if (!profile) throw new NotFoundException('Child profile not found');
    if (dto.child_name !== undefined) profile.childName = dto.child_name;
    if (dto.age !== undefined) profile.age = dto.age;
    if (dto.interests !== undefined) profile.interests = dto.interests;
    if (dto.preferred_characters !== undefined) profile.preferredCharacters = dto.preferred_characters;
    if (dto.bedtime_goal !== undefined) profile.bedtimeGoal = dto.bedtime_goal;
    if (dto.gender !== undefined) profile.gender = dto.gender;
    return this.repo.save(profile);
  }

  async delete(childId: string, tenantId: string): Promise<void> {
    const profile = await this.repo.findOne({ where: { childId, tenantId, isActive: 1 } });
    if (!profile) throw new NotFoundException('Child profile not found');
    profile.isActive = 0;
    await this.repo.save(profile);
  }
}
