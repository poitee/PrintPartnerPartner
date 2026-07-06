export type AuthIdentityProvider = "github" | "discord";

export type SessionUser = {
  user_id: string;
  tenant_id: string;
  login: string;
  display_name: string;
  email: string | null;
  provider: "github" | "discord" | "email" | "basic" | "anonymous";
  is_admin: boolean;
};

export type PublicUser = {
  user_id: string;
  login: string;
  display_name: string;
  email: string | null;
  provider: SessionUser["provider"];
  is_admin: boolean;
};

export function toPublicUser(user: SessionUser): PublicUser {
  return {
    user_id: user.user_id,
    login: user.login,
    display_name: user.display_name,
    email: user.email,
    provider: user.provider,
    is_admin: user.is_admin,
  };
}
