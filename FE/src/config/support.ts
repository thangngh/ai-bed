export interface SupportConfig {
  bankBin: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  operatorName: string;
  operatorType: string;
  taxCode: string;
  contactEmail: string;
  transferContent: string;
  vietQrTemplate: string;
}

const publicEnv = import.meta.env;

const envOr = (key: keyof ImportMetaEnv, fallback: string) => {
  const value = publicEnv[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};

// These values are deliberately public: the same details are shown beside the
// QR so parents can verify the recipient before confirming in their bank app.
// VITE_* variables allow a deployment to replace them without editing UI code.
export const SUPPORT_CONFIG: SupportConfig = {
  bankBin: envOr('VITE_SUPPORT_BANK_BIN', '970423'),
  bankName: envOr('VITE_SUPPORT_BANK_NAME', 'TPBank'),
  accountNumber: envOr('VITE_SUPPORT_ACCOUNT_NUMBER', '89325010618'),
  accountName: envOr('VITE_SUPPORT_ACCOUNT_NAME', 'NGUYEN DUC THANH'),
  operatorName: envOr('VITE_SUPPORT_OPERATOR_NAME', 'Nguyễn Đức Thành'),
  operatorType: envOr('VITE_SUPPORT_OPERATOR_TYPE', 'Cá nhân'),
  taxCode: envOr('VITE_SUPPORT_TAX_CODE', '040200004384'),
  contactEmail: envOr('VITE_SUPPORT_CONTACT_EMAIL', 'thanhndptt@gmail.com'),
  transferContent: envOr('VITE_SUPPORT_TRANSFER_CONTENT', 'UNGHO AIBED'),
  vietQrTemplate: envOr('VITE_SUPPORT_VIETQR_TEMPLATE', 'compact'),
};

export const buildVietQrUrl = (config: SupportConfig = SUPPORT_CONFIG) => {
  const imageName = [config.bankBin, config.accountNumber, config.vietQrTemplate]
    .map(encodeURIComponent)
    .join('-');
  const query = new URLSearchParams({
    addInfo: config.transferContent,
    accountName: config.accountName,
  });

  // Deliberately omit `amount`: support is voluntary and the parent chooses
  // the value in their bank app instead of being presented with a price.
  return `https://img.vietqr.io/image/${imageName}.png?${query.toString()}`;
};
