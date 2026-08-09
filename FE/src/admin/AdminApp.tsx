import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLoginScreen from './AdminLoginScreen';
import AdminFeedbackScreen from './AdminFeedbackScreen';
import RequireAdmin from './RequireAdmin';

export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLoginScreen />} />
      <Route
        path="feedback"
        element={<RequireAdmin><AdminFeedbackScreen /></RequireAdmin>}
      />
      <Route path="*" element={<Navigate to="/admin/feedback" replace />} />
    </Routes>
  );
}
