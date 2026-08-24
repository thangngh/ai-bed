// class-transformer decorators (e.g. @Type) call Reflect.getMetadata, which
// only exists once this polyfill runs. Some specs happened to get it for
// free via a transitive TypeORM import; load it explicitly here so every
// spec file can rely on it regardless of import order.
import 'reflect-metadata';

// AdminModule refuses to boot without a real secret. Tests that build the
// module need one; this keeps every spec file from repeating it.
process.env.ADMIN_JWT_SECRET =
  process.env.ADMIN_JWT_SECRET || 'test-only-admin-secret-at-least-32-chars-long';
