import { prisma } from "../prisma/client";
import { DEFAULT_WHATSAPP_INSTANCE_ID } from "./whatsapp-instances";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

export async function clearWhatsappOperationalData(
  reason: string,
  instanceId = DEFAULT_WHATSAPP_INSTANCE_ID
) {
  console.log("[whatsapp-data] clearing operational data", { reason, instanceId });

  try {
    const counts = await prisma.$transaction(async (transaction) => {
      const campaignRecipients = await transaction.campaignRecipient.deleteMany({
        where: { instanceId }
      });
      const campaigns = await transaction.campaign.deleteMany({
        where: { instanceId }
      });
      const chatLabels = await transaction.whatsappChatLabel.deleteMany({
        where: { instanceId }
      });
      const messages = await transaction.whatsappMessage.deleteMany({
        where: { instanceId }
      });
      const labels = await transaction.whatsappLabel.deleteMany({
        where: { instanceId }
      });
      const contacts = await transaction.whatsappContact.deleteMany({
        where: { instanceId }
      });
      const chats = await transaction.whatsappChat.deleteMany({
        where: { instanceId }
      });

      return {
        campaignRecipients: campaignRecipients.count,
        campaigns: campaigns.count,
        chatLabels: chatLabels.count,
        messages: messages.count,
        labels: labels.count,
        contacts: contacts.count,
        chats: chats.count
      };
    });

    console.log("[whatsapp-data] operational data cleared", { reason, instanceId, counts });

    return counts;
  } catch (error) {
    console.error("[whatsapp-data] operational data clear failed", {
      reason,
      instanceId,
      error: getErrorMessage(error)
    });
    throw error;
  }
}
