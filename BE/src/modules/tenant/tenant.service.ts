import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Tenant } from './entities/tenant.entity';

@Injectable()
export class TenantService {
  private repo: Repository<Tenant>;

  constructor(@InjectDataSource('core') private dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(Tenant);
  }

  async create(existingId?: string): Promise<Tenant> {
    const tenant = new Tenant();
    tenant.tenantId = existingId || uuidv4();
    return this.repo.save(tenant);
  }

  async findById(tenantId: string): Promise<Tenant | null> {
    return this.repo.findOne({ where: { tenantId } });
  }

  async findOrCreate(tenantId: string): Promise<Tenant> {
    const existing = await this.findById(tenantId);
    if (existing) return existing;
    return this.create(tenantId);
  }
}
