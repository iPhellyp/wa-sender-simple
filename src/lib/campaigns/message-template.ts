export type CampaignTemplateSample = {
  name?: string | null;
  phoneNormalized?: string | null;
  email?: string | null;
  cidade?: string | null;
  estado?: string | null;
  source?: string | null;
};

export function applySpintax(value: string) {
  return value.replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_match, group: string) => {
    const options = group
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    return options[Math.floor(Math.random() * options.length)] ?? "";
  });
}

export function renderCampaignVariables(value: string, sample: CampaignTemplateSample | null) {
  const variables: Record<string, string> = {
    nome: sample?.name ?? "",
    telefone: sample?.phoneNormalized ?? "",
    email: sample?.email ?? "",
    cidade: sample?.cidade ?? "",
    estado: sample?.estado ?? "",
    origem: sample?.source ?? "",
    lista: sample?.source ?? ""
  };

  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return variables[key.toLowerCase()] ?? "";
  });
}

export function renderCampaignMessage(template: string, sample: CampaignTemplateSample | null) {
  return renderCampaignVariables(applySpintax(template), sample).trim();
}
