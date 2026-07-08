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

export function hasDirectWhatsappConversationEvidence(input: {
  lastInboundAt?: Date | string | null;
  lastOutboundAt?: Date | string | null;
  lastMessageAt?: Date | string | null;
  lastMessageText?: string | null;
  unreadCount?: number | null;
  hasMessage?: boolean | null;
}) {
  return Boolean(
    input.hasMessage ||
      input.lastInboundAt ||
      input.lastOutboundAt ||
      input.lastMessageAt ||
      input.lastMessageText?.trim() ||
      (typeof input.unreadCount === "number" && input.unreadCount > 0)
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

export function isEligibleIndividualWhatsappChat(input: Parameters<typeof isIndividualWhatsappChat>[0] & {
  lastInboundAt?: Date | string | null;
  lastOutboundAt?: Date | string | null;
  lastMessageAt?: Date | string | null;
  lastMessageText?: string | null;
  unreadCount?: number | null;
  hasMessage?: boolean | null;
}) {
  return isIndividualWhatsappChat(input) && hasDirectWhatsappConversationEvidence(input);
}

const DIRECT_CONVERSATION_EVIDENCE_WHERE: Prisma.WhatsappChatWhereInput = {
  OR: [
    {
      lastInboundAt: {
        not: null
      }
    },
    {
      lastOutboundAt: {
        not: null
      }
    },
    {
      lastMessageAt: {
        not: null
      }
    },
    {
      lastMessageText: {
        not: null
      }
    },
    {
      unreadCount: {
        gt: 0
      }
    }
  ]
};

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
      },
      DIRECT_CONVERSATION_EVIDENCE_WHERE
    ]
  };
}

export function getIndividualWhatsappChatIdentifierWhere(): Prisma.WhatsappChatWhereInput {
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
