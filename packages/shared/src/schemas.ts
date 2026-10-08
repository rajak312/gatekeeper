import { z } from 'zod';
import { GRANT_TYPES, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USER_ROLES } from './constants';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }))
  .refine((v) => v.length <= 254, 'Email is too long');

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

// ---------------------------------------------------------------- auth / account

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
  interaction: z.string().max(100).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email,
  password: passwordSchema,
  interaction: z.string().max(100).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const mfaVerifySchema = z
  .object({
    code: totpCode.optional(),
    recoveryCode: z.string().trim().min(8).max(32).optional(),
    interaction: z.string().max(100).optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'Provide either a TOTP code or a recovery code',
  });
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaActivateSchema = z.object({ code: totpCode });
export const mfaDisableSchema = z.object({ password: z.string().min(1), code: totpCode });
export const mfaRegenerateSchema = z.object({ code: totpCode });

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});
export const verifyEmailSchema = z.object({ token: z.string().min(10).max(200) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({ name: z.string().trim().min(1).max(100) });

export const consentDecisionSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  remember: z.boolean().default(true),
});
export type ConsentDecisionInput = z.infer<typeof consentDecisionSchema>;

export const logoutSchema = z.object({
  post_logout_redirect_uri: z.string().max(2000).optional(),
  client_id: z.string().max(200).optional(),
  state: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------- admin

const scopeName = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_:.-]{1,63}$/, 'Scopes are lowercase, 2-64 chars: letters, digits, _ : . -');

export const createClientSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  type: z.enum(['PUBLIC', 'CONFIDENTIAL']),
  redirectUris: z.array(z.string().trim().max(2000)).max(20).default([]),
  postLogoutRedirectUris: z.array(z.string().trim().max(2000)).max(20).default([]),
  allowedScopes: z.array(scopeName).min(1).max(50),
  grantTypes: z.array(z.enum(GRANT_TYPES)).min(1),
  requireConsent: z.boolean().default(true),
  accessTokenTtl: z.number().int().min(60).max(3600).default(900),
  refreshTokenTtl: z
    .number()
    .int()
    .min(300)
    .max(60 * 60 * 24 * 90)
    .default(60 * 60 * 24 * 30),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = createClientSchema.omit({ type: true }).partial().extend({
  disabled: z.boolean().optional(),
});
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const createClientRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_:.-]{1,63}$/, 'Role names are lowercase, 2-64 chars'),
  description: z.string().trim().max(200).optional(),
});

export const createScopeSchema = z.object({
  name: scopeName,
  description: z.string().trim().min(3).max(200),
});

export const updateUserRolesSchema = z.object({
  roles: z.array(z.enum(USER_ROLES)).min(1),
});

export const assignClientRoleSchema = z.object({ clientRoleId: z.uuid() });

export const lockUserSchema = z.object({ reason: z.string().trim().max(200).optional() });

export const auditQuerySchema = z.object({
  type: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
  success: z.enum(['true', 'false']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const userListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
