export type MetaBudgetUpdateInput = {
  metaCampaignId: string;
  accessToken: string;
  newBudget: number;
};

export type MetaBudgetUpdateResult = {
  ok: boolean;
  status: number;
  body: any;
};

function toMetaMinorBudget(value: number) {
  return String(Math.round(value * 100));
}

export async function updateMetaCampaignBudget(input: MetaBudgetUpdateInput): Promise<MetaBudgetUpdateResult> {
  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(input.metaCampaignId)}`;
  const payload = new URLSearchParams({
    daily_budget: toMetaMinorBudget(input.newBudget),
    access_token: input.accessToken,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  const body = await response.json().catch(() => ({}));

  // Campaign-level daily_budget works for CBO campaigns. Some setups require adset-level budgets;
  // in those cases Meta returns an API error and we surface it unchanged for operator handling.
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}
