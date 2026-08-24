import React, { useEffect, useState } from 'react';
import { Check, Copy, Landmark, QrCode, ShieldCheck } from 'lucide-react';
import { buildVietQrUrl, SUPPORT_CONFIG } from '../config/support';

interface SupportPaymentPanelProps {
  isNightMode: boolean;
  compact?: boolean;
}

type CopyTarget = 'account' | 'content' | null;

export const SupportPaymentPanel: React.FC<SupportPaymentPanelProps> = ({ isNightMode, compact = false }) => {
  const [copied, setCopied] = useState<CopyTarget>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const qrUrl = buildVietQrUrl();

  useEffect(() => {
    setQrFailed(false);
  }, [qrUrl]);

  const copyText = async (value: string, target: Exclude<CopyTarget, null>) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied((current) => current === target ? null : current), 1800);
    } catch {
      // All transfer details remain selectable below when Clipboard API is
      // unavailable (for example on an HTTP origin).
      setCopied(null);
    }
  };

  const rowClass = isNightMode
    ? 'bg-slate-950/70 border-slate-700 text-slate-100'
    : 'bg-amber-50/70 border-amber-200 text-amber-950';

  const qrFrameClass = compact
    ? 'support-qr-compact aspect-square rounded-2xl p-2 shadow-md'
    : 'w-full max-w-[300px] rounded-3xl p-3 shadow-lg';

  const detailPadding = compact ? 'p-2.5' : 'p-3.5';

  return (
    <div
      className={compact
        ? 'support-payment-compact grid items-center gap-3 sm:grid-cols-[minmax(8.5rem,11rem)_1fr] sm:gap-4'
        : 'space-y-4'}
      data-compact={compact ? 'true' : undefined}
    >
      <div className={`mx-auto shrink-0 bg-white ring-1 ring-slate-200 ${qrFrameClass}`}>
        {qrFailed ? (
          <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 px-3 text-center text-slate-700">
            <QrCode className={compact ? 'h-9 w-9 text-slate-400' : 'h-12 w-12 text-slate-400'} />
            <p className="text-sm font-semibold">Không tải được mã QR</p>
            {!compact && <p className="text-xs text-slate-500">Ba mẹ có thể dùng thông tin chuyển khoản bên dưới.</p>}
          </div>
        ) : (
          <img
            src={qrUrl}
            alt={`Mã VietQR chuyển khoản đến ${SUPPORT_CONFIG.accountName} tại ${SUPPORT_CONFIG.bankName}`}
            className={`block w-full rounded-xl object-contain ${compact ? 'h-full' : 'h-auto'}`}
            referrerPolicy="no-referrer"
            onError={() => setQrFailed(true)}
          />
        )}
      </div>

      <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
        <div className={`rounded-2xl border ${detailPadding} ${rowClass}`}>
          <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
            <Landmark className="h-3.5 w-3.5" />
            <span>Ngân hàng thụ hưởng</span>
          </div>
          <div className={compact ? 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5' : ''}>
            <p className="font-bold">{SUPPORT_CONFIG.bankName}</p>
            <p className={compact ? 'text-xs' : 'mt-0.5 text-sm'}>{SUPPORT_CONFIG.accountName}</p>
          </div>
        </div>

        <div className={compact ? 'grid grid-cols-2 gap-2' : 'space-y-2.5'}>
          <div className={`flex min-w-0 items-center justify-between gap-1.5 rounded-2xl border ${detailPadding} ${rowClass}`}>
            <div className="min-w-0">
              <p className="text-[11px] opacity-70 sm:text-xs">Số tài khoản</p>
              <p className={`select-all break-all font-mono font-bold tracking-wide ${compact ? 'text-sm' : 'text-base'}`}>
                {SUPPORT_CONFIG.accountNumber}
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyText(SUPPORT_CONFIG.accountNumber, 'account')}
              className="shrink-0 rounded-xl p-1.5 text-indigo-500 transition-colors hover:bg-indigo-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              aria-label="Sao chép số tài khoản"
            >
              {copied === 'account' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>

          <div className={`flex min-w-0 items-center justify-between gap-1.5 rounded-2xl border ${detailPadding} ${rowClass}`}>
            <div className="min-w-0">
              <p className="text-[11px] opacity-70 sm:text-xs">Nội dung</p>
              <p className="select-all break-all font-mono text-sm font-bold tracking-wide">
                {SUPPORT_CONFIG.transferContent}
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyText(SUPPORT_CONFIG.transferContent, 'content')}
              className="shrink-0 rounded-xl p-1.5 text-indigo-500 transition-colors hover:bg-indigo-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              aria-label="Sao chép nội dung chuyển khoản"
            >
              {copied === 'content' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className={`flex items-start gap-2 rounded-2xl border text-xs leading-relaxed ${
          compact ? 'p-2.5' : 'p-3'
        } ${
          isNightMode
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
            : 'border-emerald-200 bg-emerald-50 text-emerald-900'
        }`}>
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <p>
            Kiểm tra đúng tên <strong>{SUPPORT_CONFIG.accountName}</strong> trước khi chuyển.
            {!compact && ' Ứng dụng không tự đọc hoặc lưu giao dịch ngân hàng.'}
          </p>
        </div>
      </div>
    </div>
  );
};
