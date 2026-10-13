// GitHub API katmanı: panelin yaptığı her şey faceless-shorts deposundaki iş akışlarına giden isteklerdir.
// Tarayıcıya ya da arayüze bağlı değildir; Node ile de sınanabilir.

const API = "https://api.github.com";
export const WORKFLOWS = { short: "make-short.yml", weekly: "weekly.yml" };
export const REUPLOAD_WORKFLOW = "upload-video.yml"; // üretilmiş ama yüklenememiş videoları yeniden yükler
const PRIVACY_VARIABLE = "YT_PRIVACY";
const FEED_BRANCH = "panel-data";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createClient({ owner, repo, token }) {
  const base = `/repos/${owner}/${repo}`;

  async function request(method, path, { body, raw } = {}) {
    const response = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!response.ok) {
      let message = response.statusText;
      try {
        message = (await response.json()).message || message;
      } catch {
        // gövde JSON değilse durum metni yeterli
      }
      throw new ApiError(response.status, message);
    }
    if (response.status === 204) return null;
    return raw ? response.text() : response.json();
  }

  return {
    // Bağlantı sınaması: depo okunabiliyor mu
    repository: () => request("GET", base),

    workflow: (file) => request("GET", `${base}/actions/workflows/${file}`),

    setWorkflowEnabled: (file, enabled) =>
      request("PUT", `${base}/actions/workflows/${file}/${enabled ? "enable" : "disable"}`),

    runs: (count = 20) => request("GET", `${base}/actions/runs?per_page=${count}`).then((data) => data.workflow_runs),

    // Tanımlı değilse iş akışı "public" varsayar
    async privacy() {
      try {
        return (await request("GET", `${base}/actions/variables/${PRIVACY_VARIABLE}`)).value;
      } catch (error) {
        if (error.status === 404) return "public";
        throw error;
      }
    },

    async setPrivacy(value) {
      try {
        await request("PATCH", `${base}/actions/variables/${PRIVACY_VARIABLE}`, {
          body: { name: PRIVACY_VARIABLE, value },
        });
      } catch (error) {
        if (error.status !== 404) throw error;
        await request("POST", `${base}/actions/variables`, { body: { name: PRIVACY_VARIABLE, value } });
      }
    },

    // Üretilen videoların kaydı; henüz hiç çalışma bildirilmemişse dal ya da dosya yoktur
    async feed() {
      try {
        return JSON.parse(await request("GET", `${base}/contents/feed.json?ref=${FEED_BRANCH}`, { raw: true }));
      } catch (error) {
        if (error.status === 404) return [];
        throw error;
      }
    },

    // inputs değerleri GitHub'a metin olarak gider
    dispatch: (file, inputs = {}) =>
      request("POST", `${base}/actions/workflows/${file}/dispatches`, {
        body: { ref: "main", inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v)])) },
      }),
  };
}
