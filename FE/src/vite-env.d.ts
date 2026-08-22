/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPPORT_BANK_BIN?: string;
  readonly VITE_SUPPORT_BANK_NAME?: string;
  readonly VITE_SUPPORT_ACCOUNT_NUMBER?: string;
  readonly VITE_SUPPORT_ACCOUNT_NAME?: string;
  readonly VITE_SUPPORT_OPERATOR_NAME?: string;
  readonly VITE_SUPPORT_OPERATOR_TYPE?: string;
  readonly VITE_SUPPORT_TAX_CODE?: string;
  readonly VITE_SUPPORT_CONTACT_EMAIL?: string;
  readonly VITE_SUPPORT_TRANSFER_CONTENT?: string;
  readonly VITE_SUPPORT_VIETQR_TEMPLATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
