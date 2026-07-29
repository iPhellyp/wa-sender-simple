import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  brazilianPhoneAliases,
  chooseResolvedPhone,
  phoneFromIndividualJid,
  phoneJids
} from "./phone-resolution";

test("gera apenas o alias brasileiro conservador de oito/nove dígitos", () => {
  assert.deepEqual(
    brazilianPhoneAliases("5538999990000"),
    ["5538999990000", "553899990000"]
  );
  assert.deepEqual(
    brazilianPhoneAliases("553899990000"),
    ["553899990000", "5538999990000"]
  );
  assert.deepEqual(brazilianPhoneAliases("12025550123"), ["12025550123"]);
});

test("reconhece JIDs telefônicos s.whatsapp.net e c.us", () => {
  assert.deepEqual(phoneJids("5538999990000"), [
    "5538999990000@s.whatsapp.net",
    "5538999990000@c.us"
  ]);
  assert.equal(
    phoneFromIndividualJid("5538999990000@s.whatsapp.net"),
    "5538999990000"
  );
  assert.equal(phoneFromIndividualJid("5538999990000@c.us"), "5538999990000");
  assert.equal(phoneFromIndividualJid("123@lid"), null);
});

test("prioriza exato e rejeita aliases ambíguos", () => {
  assert.equal(
    chooseResolvedPhone("5538999990000", ["5538999990000", "553899990000"]),
    "5538999990000"
  );
  assert.equal(
    chooseResolvedPhone("5538999990000", ["553899990000"]),
    "553899990000"
  );
  assert.equal(
    chooseResolvedPhone("5538999990000", ["553899990000", "553899980000"]),
    "AMBIGUOUS"
  );
  assert.equal(chooseResolvedPhone("5538999990000", []), null);
});

test("catalog e history atualizam o índice telefônico persistente", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/lib/baileys/sync.ts"),
    "utf8"
  );
  assert.match(
    source,
    /syncMessagingHistorySet[\s\S]*upsertContactFromBaileys\(contact, instanceId\)/
  );
  assert.match(
    source,
    /upsertContactFromBaileys[\s\S]*resolvedPhone[\s\S]*whatsappContact\.upsert/
  );
  assert.match(source, /jid: lidJid[\s\S]*phone: resolvedPhone/);
});

test("índice telefônico usa Prisma/PostgreSQL e não cache em memória", async () => {
  const services = await readFile(
    resolve(process.cwd(), "src/lib/internal-api/services.ts"),
    "utf8"
  );
  assert.match(services, /prisma\.whatsappContact\.findMany/);
  assert.match(services, /prisma\.whatsappChat\.findMany/);
  assert.doesNotMatch(services, /new Map\(|new WeakMap\(/);
});
