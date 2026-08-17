import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RangeQueryDto } from '../dto/range-query.dto';

describe('RangeQueryDto', () => {
  it('accepts an hour bucket', () => {
    const dto = plainToInstance(RangeQueryDto, { from: '2026-08-14T10', to: '2026-08-14T11' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a full timestamp', () => {
    const dto = plainToInstance(RangeQueryDto, { from: '2026-08-14T10:30:00' });
    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('rejects garbage', () => {
    const dto = plainToInstance(RangeQueryDto, { from: 'yesterday' });
    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('accepts an empty query', () => {
    const dto = plainToInstance(RangeQueryDto, {});
    expect(validateSync(dto)).toHaveLength(0);
  });
});
