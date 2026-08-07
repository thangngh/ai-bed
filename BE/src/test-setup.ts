// AdminModule refuses to boot without a real secret. Tests that build the
// module need one; this keeps every spec file from repeating it.
process.env.ADMIN_JWT_SECRET =
  process.env.ADMIN_JWT_SECRET || 'test-only-admin-secret-at-least-32-chars-long';
