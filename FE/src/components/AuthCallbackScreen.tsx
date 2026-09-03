import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { consumeTokenFromHash } from '../utils/authSession';

const ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: 'Bạn đã huỷ đăng nhập bằng Google.',
  oauth_failed: 'Đăng nhập bằng Google thất bại, vui lòng thử lại.',
};

/**
 * Where the BE drops the parent after Google. Its only job is to move the
 * access token out of the URL fragment and into memory, then get out of the way.
 */
export const AuthCallbackScreen: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const errorCode = searchParams.get('error');

  // Read during the first render, not in the effect: navigating home clears the
  // fragment, and StrictMode's second effect run would then find an empty hash
  // and report a failed login for one that actually worked.
  const [consumed] = useState(() => (errorCode ? false : consumeTokenFromHash()));

  useEffect(() => {
    if (errorCode) return;
    // replace, so Back does not return to a callback URL whose token is spent.
    navigate('/', { replace: true });
  }, [errorCode, consumed, navigate]);

  if (!errorCode) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center gap-4 p-6">
      <p className="text-center text-rose-400">
        {ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.oauth_failed}
      </p>
      <button
        onClick={() => navigate('/', { replace: true })}
        className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-sm hover:bg-slate-800"
      >
        Quay lại ứng dụng
      </button>
    </div>
  );
};

export default AuthCallbackScreen;
