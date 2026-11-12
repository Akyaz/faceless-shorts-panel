// GitHub API katmanı: panelin yaptığı her şey faceless-shorts deposundaki iş akışlarına giden isteklerdir.
// Tarayıcıya ya da arayüze bağlı değildir; Node ile de sınanabilir.

const API = "https://api.github.com";
export const WORKFLOWS = { short: "make-short.yml", weekly: "weekly.yml" };
export const REUPLOAD_WORKFLOW = "upload-video.yml"; // üretilmiş ama yüklenememiş videoları yeniden yükler
export const LONGFORM_WORKFLOW = "longform.yml"; // tarih videoları: dosyası saklanmaz, yeniden üretilir
const PRIVACY_VARIABLE = "YT_PRIVACY";
const FEED_BRANCH = "panel-data";
const SCHEDULED_DIR = "scripts/scheduled";

// Günlük plan: pipeline/slots.py'deki saatlerle aynı olmalı. slot, iş akışının "slot" girdisine giden saat adıdır.
// days: yalnızca bu günlerde (0 pazar, 1 pazartesi ... 6 cumartesi); yoksa her gün
export const PLAN = [
  { time: "08:00", slot: "pazartesi 08:00", file: WORKFLOWS.short, mode: "horoscope1", days: [1] },
  { time: "08:30", slot: "pazartesi 08:30", file: WORKFLOWS.short, mode: "horoscope2", days: [1] },
  { time: "09:00", slot: "pazartesi 09:00", file: WORKFLOWS.short, mode: "horoscope3", days: [1] },
  { time: "10:00", slot: "10:00", file: WORKFLOWS.short, mode: "platform" },
  { time: "11:00", slot: "pazar 11:00", file: WORKFLOWS.weekly, mode: "weekly", days: [0] },
  { time: "12:00", slot: "12:00", file: WORKFLOWS.short, mode: "fact" },
  { time: "13:00", slot: "13:00", file: WORKFLOWS.short, mode: "scheduled", prepared: true },
  { time: "13:30", slot: "13:30", file: WORKFLOWS.short, mode: "matchday", days: [0, 2, 3, 4, 5, 6] },
  { time: "15:00", slot: "15:00", file: WORKFLOWS.short, mode: "fact" },
  { time: "17:00", slot: "17:00", file: WORKFLOWS.short, mode: "culture" },
  { time: "19:00", slot: "19:00", file: WORKFLOWS.short, mode: "sportstory" },
  { time: "20:30", slot: "20:30", file: WORKFLOWS.short, mode: "debate" },
  { time: "21:00", slot: "21:00", file: LONGFORM_WORKFLOW, mode: "longform" },
];

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

    // Önceden hazırlanmış videolar ve iptaller (scripts/scheduled/YYYY-AA-GG-SSDD.json / .skip); klasör yoksa boş
    async scheduledFiles() {
      try {
        return (await request("GET", `${base}/contents/${SCHEDULED_DIR}`)).map((file) => file.name);
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
