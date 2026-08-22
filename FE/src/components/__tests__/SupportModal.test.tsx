import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SupportModal } from '../SupportModal';

describe('SupportModal', () => {
  it('shows verifiable transfer details and no fixed amount', () => {
    render(<SupportModal isOpen onClose={vi.fn()} isNightMode />);

    expect(screen.getByRole('dialog', { name: 'Ủng hộ tùy tâm' })).toBeInTheDocument();
    expect(screen.getByText('TPBank')).toBeInTheDocument();
    expect(screen.getByText('89325010618')).toBeInTheDocument();
    expect(screen.getAllByText('NGUYEN DUC THANH').length).toBeGreaterThan(0);
    expect(screen.getByText('UNGHO AIBED')).toBeInTheDocument();

    const qr = screen.getByRole('img', { name: /mã vietqr/i });
    expect(qr.getAttribute('src')).not.toContain('amount=');
  });

  it('closes from the explicit button and Escape key', () => {
    const onClose = vi.fn();
    render(<SupportModal isOpen onClose={onClose} isNightMode={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Đóng cửa sổ ủng hộ' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('uses the compact, viewport-bound layout without an inner scroll region', () => {
    render(<SupportModal isOpen onClose={vi.fn()} isNightMode />);

    const dialog = screen.getByRole('dialog', { name: 'Ủng hộ tùy tâm' });
    expect(dialog.className).toContain('support-modal-card');
    expect(dialog.querySelector('[data-compact="true"]')).toBeInTheDocument();
    expect(dialog.querySelector('.overflow-y-auto')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
  });
});
