import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLoginScreen from './AdminLoginScreen';
import AdminFeedbackScreen from './AdminFeedbackScreen';
import AdminLayout from './AdminLayout';
import RequireAdmin from './RequireAdmin';

export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLoginScreen />} />
      {/* One guard and one layout for every authenticated screen: a new screen
          is a single <Route> line and cannot forget either. */}
      <Route
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route path="feedback" element={<AdminFeedbackScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin/feedback" replace />} />
    </Routes>
  );
}
