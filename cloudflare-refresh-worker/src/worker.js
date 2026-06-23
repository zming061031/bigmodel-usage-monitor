export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerWorkflow(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/trigger") {
      return Response.json({ ok: true, service: "bigmodel-usage-refresh" });
    }

    const token = request.headers.get("x-refresh-token") || "";
    if (!env.REFRESH_TOKEN || token !== env.REFRESH_TOKEN) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    return Response.json(await triggerWorkflow(env));
  }
};

async function triggerWorkflow(env) {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_ID}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "bigmodel-usage-refresh-worker",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({
        ref: env.GITHUB_REF || "main",
        inputs: {
          source: "cloudflare-cron"
        }
      })
    }
  );

  if (response.status === 204) {
    return {
      ok: true,
      triggeredAt: new Date().toISOString(),
      workflow: env.GITHUB_WORKFLOW_ID
    };
  }

  const detail = await response.text();
  return {
    ok: false,
    status: response.status,
    detail: detail.slice(0, 500)
  };
}
