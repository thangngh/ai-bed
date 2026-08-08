import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getToken } from './adminSession';

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  // getToken() already treats an expired token as absent.
  if (!getToken()) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
