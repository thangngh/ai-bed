import React from 'react';
import { Navigate } from 'react-router-dom';
import { getToken } from './adminSession';

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  // getToken() already treats an expired token as absent.
  if (!getToken()) {
    return <Navigate to="/admin/login" replace />;
  }
  return <>{children}</>;
}
