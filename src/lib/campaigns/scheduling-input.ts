import { CampaignStatus } from "@prisma/client";

export type CampaignSendMode = "NOW" | "SCHEDULED";

type CampaignScheduleInputResult =
  | {
      ok: true;
      sendMode: CampaignSendMode;
      status: CampaignStatus;
      scheduledAt: Date | null;
    }
  | {
      ok: false;
      error: string;
    };

const MINIMUM_SCHEDULE_LEAD_MS = 2 * 60 * 1000;
const ISO_UTC_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function parseCampaignScheduleInput(
  sendModeValue: unknown,
  scheduledAtValue: unknown,
  now = new Date()
): CampaignScheduleInputResult {
  const sendMode = String(sendModeValue ?? "NOW").trim().toUpperCase();

  if (sendMode === "NOW") {
    return {
      ok: true,
      sendMode,
      status: CampaignStatus.draft,
      scheduledAt: null
    };
  }

  if (sendMode !== "SCHEDULED") {
    return {
      ok: false,
      error: "Modo de envio invalido"
    };
  }

  const scheduledAtText = String(scheduledAtValue ?? "").trim();
  const scheduledAt = new Date(scheduledAtText);

  if (
    !scheduledAtText ||
    !ISO_UTC_DATE_TIME_PATTERN.test(scheduledAtText) ||
    Number.isNaN(scheduledAt.getTime())
  ) {
    return {
      ok: false,
      error: "Informe uma data e hora validas para o agendamento"
    };
  }

  if (scheduledAt.getTime() < now.getTime() + MINIMUM_SCHEDULE_LEAD_MS) {
    return {
      ok: false,
      error: "O agendamento deve ter pelo menos 2 minutos de antecedencia"
    };
  }

  return {
    ok: true,
    sendMode,
    status: CampaignStatus.scheduled,
    scheduledAt
  };
}
