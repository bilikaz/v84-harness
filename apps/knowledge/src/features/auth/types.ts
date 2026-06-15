// Request DTOs for the auth routes.

export interface Credentials {
  username?: string;
  password?: string;
}

export interface RefreshBody {
  refreshToken?: string;
}
