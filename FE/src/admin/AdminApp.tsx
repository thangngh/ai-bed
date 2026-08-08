import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLoginScreen from './AdminLoginScreen';
import RequireAdmin from './RequireAdmin';

// Replaced by AdminFeedbackScreen in FE-5.
function FeedbackPlaceholder() {
  return <p>Danh sách feedback</p>;
}

export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLoginScreen />} />
      <Route
        path="feedback"
        element={<RequireAdmin><FeedbackPlaceholder /></RequireAdmin>}
      />
      <Route path="*" element={<Navigate to="/admin/feedback" replace />} />
    </Routes>
  );
}
