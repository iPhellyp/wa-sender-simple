import { prisma } from "../prisma/client";

export async function clearWhatsappOperationalData(reason: string) {
  console.log("[whatsapp-data] clearing operational data", { reason });

  const result = await prisma.$transaction(async (transaction) => {
    const campaignRecipients = await transaction.campaignRecipient.deleteMany();
    const campaigns = await transaction.campaign.deleteMany();
    const chatLabels = await transaction.whatsappChatLabel.deleteMany();
    const messages = await transaction.whatsappMessage.deleteMany();
    const labels = await transaction.whatsappLabel.deleteMany();
    const contacts = await transaction.whatsappContact.deleteMany();
    const chats = await transaction.whatsappChat.deleteMany();

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

  console.log("[whatsapp-data] operational data cleared", { reason, ...result });

  return result;
}
