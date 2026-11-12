import { z } from 'zod';
import { ROLES } from './roles';
import { projectSettingsSchema } from './qa';

/** Slugs that would collide with top-level app routes. */
export const RESERVED_SLUGS = new Set([
  'api',
  'v1',
  'docs',
  'login',
  'signup',
  'logout',
  'onboarding',
  'invite',
  'settings',
  'new',
  'admin',
  'health',
  'static',
  'assets',
  '_next',
  'app',
  'auth',
]);

export const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes')
  .refine((s) => !RESERVED_SLUGS.has(s), 'This URL is reserved');

/** Short project key used in human IDs, e.g. "PAY" -> PAY-TC-12. */
export const projectKeySchema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[A-Z][A-Z0-9]*$/, 'Use 2-8 uppercase letters/numbers, starting with a letter');

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema,
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = createOrganizationSchema.partial();
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  key: projectKeySchema,
  description: z.string().max(2000).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial().extend({
  archived: z.boolean().optional(),
  /** Partial: only the given module flags change. */
  modules: projectSettingsSchema.shape.modules,
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const inviteMemberSchema = z.object({
  email: z.email(),
  role: z.enum(ROLES),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberSchema = z.object({ role: z.enum(ROLES) });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const paginationSchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'archive',
  'restore',
  'approve',
  'reject',
  'login',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
