// Users table access.

import type { Kysely } from "kysely";

import type { DB } from "../../database/schema.ts";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
}

export class UsersRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  findByUsername(username: string): Promise<UserRow | undefined> {
    return this.db
      .selectFrom("users")
      .select(["id", "username", "password_hash"])
      .where("username", "=", username)
      .executeTakeFirst();
  }

  async create(username: string, passwordHash: string): Promise<number> {
    const res = await this.db
      .insertInto("users")
      .values({ username, password_hash: passwordHash })
      .executeTakeFirstOrThrow();
    return Number(res.insertId);
  }
}
