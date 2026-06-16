// The one id generator (constants-and-identifiers rule 4). ULID: sortable by creation time,
// client-generated, collision-free, and stable across local↔remote — so it survives a row
// moving between backends and foreign keys (containerId, sessionId) never break.
//
// 26 chars Crockford base32 = 48-bit ms timestamp (sortable prefix) + 80 bits of randomness.

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 — no I, L, O, U

export function newId(): string {
  let time = Date.now();
  let ts = "";
  for (let i = 0; i < 10; i++) {
    ts = ENCODING[time % 32] + ts;
    time = Math.floor(time / 32);
  }
  // 256 % 32 === 0, so byte % 32 is uniform — no modulo bias.
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ENCODING[rnd[i] % 32];
  return ts + rand;
}
