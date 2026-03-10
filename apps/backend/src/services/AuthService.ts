import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { StringValue } from "ms";
import crypto from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import type { Database } from "../config/database.js";
import type { Env } from "../config/env.js";
import { users, refreshTokens } from "../models/index.js";
import { UnauthorizedError } from "../utils/errors.js";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

export class AuthService {
  constructor(
    private db: Database,
    private env: Env
  ) {}

  async login(email: string, password: string, deviceInfo?: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), eq(users.isActive, true)))
      .limit(1);

    if (!user) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const accessToken = this.generateAccessToken(user);
    const { refreshToken, tokenHash } = this.generateRefreshToken();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      deviceInfo,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        team: user.team,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  async refresh(token: string) {
    const tokenHash = this.hashToken(token);

    const [stored] = await this.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
      .limit(1);

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    // Revoke old token (rotation)
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, stored.userId))
      .limit(1);

    if (!user || !user.isActive) {
      throw new UnauthorizedError("User not found or inactive");
    }

    const accessToken = this.generateAccessToken(user);
    const { refreshToken: newRefreshToken, tokenHash: newHash } = this.generateRefreshToken();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: newHash,
      deviceInfo: stored.deviceInfo,
      expiresAt,
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(token: string) {
    const tokenHash = this.hashToken(token);
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
  }

  verifyAccessToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.env.JWT_SECRET) as JwtPayload;
    } catch {
      throw new UnauthorizedError("Invalid or expired access token");
    }
  }

  private generateAccessToken(user: { id: string; email: string; role: string }): string {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return jwt.sign(payload, this.env.JWT_SECRET, { expiresIn: this.env.JWT_ACCESS_EXPIRY as StringValue });
  }

  private generateRefreshToken() {
    const refreshToken = crypto.randomBytes(64).toString("hex");
    const tokenHash = this.hashToken(refreshToken);
    return { refreshToken, tokenHash };
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
