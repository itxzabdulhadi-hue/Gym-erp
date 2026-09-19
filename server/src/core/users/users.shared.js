export const BCRYPT_ROUNDS = 11;

/** Serialise a user row for the API. password_hash never leaves the service. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    avatarUrl: user.avatar_url,
    status: user.status,
    isPlatformAdmin: Boolean(user.is_platform_admin),
    mustChangePassword: Boolean(user.must_change_password),
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}
