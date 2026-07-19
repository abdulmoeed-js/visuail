// Slack + email senders for drift alerts. Both are best-effort: a failed
// notification should never fail the scan itself, since the alert is
// already durably recorded in drift_alerts regardless.

export async function sendSlackDrift(webhookUrl: string, projectName: string, itemCount: number, appOrigin: string, projectId: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `:rotating_light: *${projectName}* — ${itemCount} change${itemCount === 1 ? "" : "s"} detected in the source. <${appOrigin}/project/${projectId}|Review in Visuail>`,
    }),
  });
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
}

export async function sendEmailDrift(resendApiKey: string, to: string, projectName: string, itemCount: number, appOrigin: string, projectId: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${resendApiKey}` },
    body: JSON.stringify({
      from: "Visuail <alerts@notifications.visuail.app>",
      to: [to],
      subject: `Drift detected in ${projectName}`,
      html: `<p><strong>${projectName}</strong> has ${itemCount} change${itemCount === 1 ? "" : "s"} detected in its source since the last check.</p>` +
        `<p><a href="${appOrigin}/project/${projectId}">Review in Visuail</a></p>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}`);
}
