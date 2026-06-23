const STORAGE_KEY = "bigmodel-storage-state.gz.b64";
const MAX_STORAGE_BYTES = 1_000_000;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerWorkflow(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/trigger") {
      const auth = requireRefreshToken(request, env);
      if (auth) return auth;
      return Response.json(await triggerWorkflow(env));
    }

    if (url.pathname === "/storage-state") {
      const auth = requireRefreshToken(request, env);
      if (auth) return auth;
      return handleStorageState(request, env);
    }

    return Response.json({ ok: true, service: "bigmodel-usage-refresh" });
  }
};

function requireRefreshToken(request, env) {
  const token = request.headers.get("x-refresh-token") || "";
  if (!env.REFRESH_TOKEN || token !== env.REFRESH_TOKEN) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

async function handleStorageState(request, env) {
  if (!env.BIGMODEL_STORAGE_KV) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 500 });
  }

  if (request.method === "GET") {
    const value = await env.BIGMODEL_STORAGE_KV.get(STORAGE_KEY);
    if (!value) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

    return new Response(value, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }

  if (request.method === "POST" || request.method === "PUT") {
    const value = (await request.text()).trim();
    if (!isValidStorageValue(value)) {
      return Response.json({ ok: false, error: "invalid_storage_state" }, { status: 400 });
    }

    await env.BIGMODEL_STORAGE_KV.put(STORAGE_KEY, value);
    return Response.json({ ok: true, updatedAt: new Date().toISOString(), bytes: value.length });
  }

  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}

function isValidStorageValue(value) {
  if (!value || value.length > MAX_STORAGE_BYTES) return false;
  return /^[A-Za-z0-9+/=]+$/.test(value);
}

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
