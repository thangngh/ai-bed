import { describe, expect, it } from 'vitest';
import { buildVietQrUrl, SUPPORT_CONFIG } from '../support';

describe('VietQR support configuration', () => {
  it('builds a TPBank QR without prescribing an amount', () => {
    const url = new URL(buildVietQrUrl());

    expect(url.origin).toBe('https://img.vietqr.io');
    expect(url.pathname).toBe('/image/970423-89325010618-compact.png');
    expect(url.searchParams.get('addInfo')).toBe('UNGHO AIBED');
    expect(url.searchParams.get('accountName')).toBe('NGUYEN DUC THANH');
    expect(url.searchParams.has('amount')).toBe(false);
  });

  it('keeps the public recipient identity consistent', () => {
    expect(SUPPORT_CONFIG.bankName).toBe('TPBank');
    expect(SUPPORT_CONFIG.operatorName).toBe('Nguyễn Đức Thành');
    expect(SUPPORT_CONFIG.taxCode).toBe('040200004384');
  });
});
