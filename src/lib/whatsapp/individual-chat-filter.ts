import type { Prisma } from "@prisma/client";

const BLOCKED_JID_MARKERS = [
  "@g.us",
  "@broadcast",
  "@newsletter",
  "newsletter",
  "broadcast",
  "group",
  "status",
  "channel"
];

export function isNonIndividualWhatsappIdentifier(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";

  return (
    !normalized ||
    normalized === "status@broadcast" ||
    BLOCKED_JID_MARKERS.some((marker) => normalized.includes(marker))
  );
}

export function isIndividualWhatsappIdentifier(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (isNonIndividualWhatsappIdentifier(normalized)) {
    return false;
  }

  return (
    normalized.endsWith("@s.whatsapp.net") ||
    normalized.endsWith("@c.us") ||
    normalized.endsWith("@lid") ||
    /^\+?\d{8,16}$/.test(normalized)
  );
}

export function isIndividualWhatsappChat(input: {
  jid: string | null | undefined;
  isGroup?: boolean | null;
  type?: string | null;
  source?: string | null;
}) {
  if (input.isGroup) {
    return false;
  }

  if (
    isNonIndividualWhatsappIdentifier(input.jid) ||
    (input.type ? isNonIndividualWhatsappIdentifier(input.type) : false) ||
    (input.source ? isNonIndividualWhatsappIdentifier(input.source) : false)
  ) {
    return false;
  }

  return isIndividualWhatsappIdentifier(input.jid);
}

export function getIndividualWhatsappChatWhere(): Prisma.WhatsappChatWhereInput {
  return {
    isGroup: false,
    jid: {
      not: "status@broadcast"
    },
    AND: [
      {
        jid: {
          not: {
            contains: "@g.us"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "@broadcast"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "@newsletter"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "newsletter"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "broadcast"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "group"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "status"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "channel"
          }
        }
      }
    ]
  };
}

export function getIndividualWhatsappContactWhere(): Prisma.WhatsappContactWhereInput {
  return {
    jid: {
      not: "status@broadcast"
    },
    AND: [
      {
        jid: {
          not: {
            contains: "@g.us"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "@broadcast"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "@newsletter"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "newsletter"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "broadcast"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "group"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "status"
          }
        }
      },
      {
        jid: {
          not: {
            contains: "channel"
          }
        }
      }
    ]
  };
}
