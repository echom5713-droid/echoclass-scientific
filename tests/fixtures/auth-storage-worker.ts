import assert from "node:assert/strict";
import { RepositoryConflictError } from "../../src/domain/repositories.js";
import type { User } from "../../src/domain/types.js";
import { hashPassword } from "../../src/infrastructure/security/node-security.js";
import {
  ensureData,
  saveUsers,
  readUsers,
  updateUser,
  createSession,
  readSession,
  changeUserPassword,
} from "../../src/infrastructure/database/storage.js";

async function allUsers(): Promise<User[]> {
  return (await readUsers()) as User[];
}
async function getUser(id: string): Promise<User> {
  const user = (await allUsers()).find((item) => item.id === id);
  assert.ok(user);
  return user;
}

await ensureData();
const user: User = {
  id: "real-user",
  role: "student",
  username: "real-user",
  name: "Synthetic",
  class_name: "Class A",
  group_name: "Group A",
  status: "active",
  defaultPassword: false,
  passwordHash: hashPassword("First-private-password"),
};
const second: User = { ...user, id: "second-user", username: "second-user" };
await saveUsers([user, second], []);
const session = (sidHash: string, actor: User) =>
  createSession({ sidHash, user: actor, ip: "127.0.0.1", ua: "test" });
await session("old-1", user);
await session("old-2", user);
const temporaryHash = hashPassword("Temporary-private-password");
await updateUser(user.id, { passwordHash: temporaryHash, defaultPassword: true });
assert.equal(await readSession("old-1"), null);
assert.equal(await readSession("old-2"), null);
await assert.rejects(session("stale-login", user), RepositoryConflictError);
const current = await getUser(user.id);
await session("limited-1", current);
await session("limited-2", current);
const limited = await readSession("limited-1");
assert.ok(limited);
assert.equal(limited?.defaultPassword, true);
assert.equal("passwordHash" in limited, false);
assert.equal("password" in limited, false);
const newHash = hashPassword("New-private-password");
assert.equal(
  await changeUserPassword({
    userId: user.id,
    sidHash: "limited-1",
    expectedPasswordHash: user.passwordHash,
    passwordHash: newHash,
    changedAt: new Date().toISOString(),
  }),
  false,
);
assert.equal((await allUsers()).find((u: User) => u.id === user.id)?.passwordHash, temporaryHash);
assert.equal(
  await changeUserPassword({
    userId: user.id,
    sidHash: "limited-1",
    expectedPasswordHash: temporaryHash,
    passwordHash: newHash,
    changedAt: new Date().toISOString(),
  }),
  true,
);
assert.equal(await readSession("limited-1"), null);
assert.equal(await readSession("limited-2"), null);
const beforeImport = await allUsers();
const otherHash = hashPassword("Other-private-password");
await updateUser(second.id, { passwordHash: otherHash, defaultPassword: true });
await assert.rejects(saveUsers(beforeImport, beforeImport), RepositoryConflictError);
const live = await allUsers();
assert.equal(live.find((u: User) => u.id === second.id)?.passwordHash, otherHash);
const unrestricted = live.find((u: User) => u.id === user.id) as User;
await session("unrestricted", unrestricted);
await saveUsers(live, live);
assert.ok(await readSession("unrestricted"));
await updateUser(user.id, { status: "disabled" });
assert.equal(await readSession("unrestricted"), null);
await assert.rejects(session("disabled-login", unrestricted), RepositoryConflictError);
const disabled = await getUser(user.id);
await updateUser(user.id, { status: "demo" });
const demo = await getUser(user.id);
assert.equal(disabled.status, "disabled");
await assert.rejects(session("demo-disabled", demo), RepositoryConflictError);
console.log("AUTH_STORAGE_PASS");
