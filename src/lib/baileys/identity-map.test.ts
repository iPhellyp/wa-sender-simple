import assert from "node:assert/strict";
import test from "node:test";
import { extractIdentityPairs } from "./identity-map";

test("extrai pares determinísticos PN/LID de eventos e histórico", () => {
  const pairs = extractIdentityPairs({
    key: {
      remoteJid: "5531999990001@lid",
      remoteJidAlt: "5531999990001@s.whatsapp.net",
      participant: "5531999990002@lid",
      participantAlt: "5531999990002@s.whatsapp.net"
    },
    senderPn: "5531999990003@s.whatsapp.net",
    senderLid: "5531999990003@lid",
    contact: {
      jid: "5531999990004@s.whatsapp.net",
      lid: "5531999990004@lid"
    },
    chat: {
      oldJid: "5531999990005@lid",
      newJid: "5531999990005@s.whatsapp.net"
    }
  }, "TEST");

  assert.deepEqual(
    new Set(pairs.map(({ lidJid, phoneJid }) => `${lidJid}|${phoneJid}`)),
    new Set([
      "5531999990001@lid|5531999990001@s.whatsapp.net",
      "5531999990002@lid|5531999990002@s.whatsapp.net",
      "5531999990003@lid|5531999990003@s.whatsapp.net",
      "5531999990004@lid|5531999990004@s.whatsapp.net",
      "5531999990005@lid|5531999990005@s.whatsapp.net"
    ])
  );
});

test("não cria vínculo por nome nem por campos isolados", () => {
  assert.deepEqual(extractIdentityPairs({
    name: "Pessoa 5511999999999",
    jid: "5511999999999@lid",
    addressingMode: "lid"
  }), []);
});

test("deduplica a mesma evidência observada no evento histórico", () => {
  const pair = {
    remoteJid: "5521999990000@lid",
    remoteJidAlt: "5521999990000@s.whatsapp.net"
  };
  assert.equal(extractIdentityPairs({ messages: [pair, pair] }).length, 1);
});
