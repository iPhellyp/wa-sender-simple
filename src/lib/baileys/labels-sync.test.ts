import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  LabelAssociationType,
  type ChatLabelAssociation
} from "@whiskeysockets/baileys/lib/Types/LabelAssociation.js";

let pendingCorrelation: string | null = null;
let recorded: Array<Record<string, unknown>> = [];
let labelExists = true;
let placeholderLabelsCreated = 0;

mock.module("../prisma/client", {
  namedExports: {
    prisma: {
      whatsappLabel: {
        findUnique: async () =>
          labelExists
            ? {
                id: "label-internal-1",
                waLabelId: "10",
                deleted: false
              }
            : null,
        upsert: async () => {
          placeholderLabelsCreated += 1;
          return {
            id: "label-internal-1",
            waLabelId: "10",
            deleted: false
          };
        }
      }
    }
  }
});
mock.module("./sync", {
  namedExports: {
    isGroupJid: (jid: string) => jid.endsWith("@g.us")
  }
});
mock.module("../labels/label-events", {
  namedExports: {
    classifyLabelEventTarget: (jid: string) => ({
      eligibleForCrm: jid.endsWith("@s.whatsapp.net")
    }),
    consumePendingInternalLabelMutation: () =>
      pendingCorrelation ? { correlationKey: pendingCorrelation } : null,
    normalizeLabelEventJid: (jid: string) => jid.trim().toLowerCase(),
    recordLabelAssociationChange: async (change: Record<string, unknown>) => {
      recorded.push(change);
      return { changed: true, eventId: "event-1" };
    }
  }
});

let labelsSync: typeof import("./labels-sync");

test.before(async () => {
  labelsSync = await import("./labels-sync");
});

test.beforeEach(() => {
  pendingCorrelation = null;
  recorded = [];
  labelExists = true;
  placeholderLabelsCreated = 0;
});

function association(
  type: "add" | "remove",
  chatId = "5511987654321@s.whatsapp.net"
): { type: "add" | "remove"; association: ChatLabelAssociation } {
  return {
    type,
    association: {
      type: LabelAssociationType.Chat,
      chatId,
      labelId: "10"
    }
  };
}

test("labels.association add manual é persistido como APPLY/WHATSAPP", async () => {
  await labelsSync.syncLabelsAssociation(association("add"), "instance-1");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.operation, "APPLY");
  assert.equal(recorded[0]?.source, "WHATSAPP");
  assert.equal(recorded[0]?.instanceId, "instance-1");
});

test("labels.association remove manual é persistido como REMOVE/WHATSAPP", async () => {
  await labelsSync.syncLabelsAssociation(association("remove"), "instance-1");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.operation, "REMOVE");
  assert.equal(recorded[0]?.source, "WHATSAPP");
});

test("evento correlacionado com job interno mantém INTERNAL_API", async () => {
  pendingCorrelation = "request-123";
  await labelsSync.syncLabelsAssociation(association("add"), "instance-1");
  assert.equal(recorded[0]?.source, "INTERNAL_API");
  assert.equal(recorded[0]?.correlationKey, "request-123");
});

test("grupo é preservado na outbox como não elegível", async () => {
  const result = await labelsSync.syncLabelsAssociation(
    association("add", "123@g.us"),
    "instance-1"
  );
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.jid, "123@g.us");
  assert.equal(result.groupsSkipped, 1);
  assert.equal(result.x1Saved, 0);
});

test("add recebido antes de labels.edit cria placeholder e não perde o evento", async () => {
  labelExists = false;
  await labelsSync.syncLabelsAssociation(association("add"), "instance-1");
  assert.equal(placeholderLabelsCreated, 1);
  assert.equal(recorded.length, 1);
});
