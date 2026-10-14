import { authHeaders, requireLogin } from "./auth-client";
import type { Asset, Project } from "./domain";
export async function request<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(
      "Backend jest niedostępny. Uruchom Docker Compose; projekt pozostaje zapisany w przeglądarce.",
    );
  }
  if (response.status === 401) requireLogin();
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ detail: `HTTP ${response.status}` }));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail),
    );
  }
  return response.json() as Promise<T>;
}
export type Health = {
  status: string;
  version: string;
  chat: "local" | "openai";
  meshy: boolean;
  queue: string;
  slicing: boolean;
};
export interface Job<T> {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result: T;
  error: string | null;
}
export async function waitJob<T>(
  id: string,
  progress?: (s: string) => void,
): Promise<T> {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const job = await request<Job<T>>(`/jobs/${id}`);
    progress?.(job.status);
    if (job.status === "succeeded") return job.result;
    if (job.status === "failed")
      throw new Error(job.error ?? "Nie udało się wykonać zadania");
    await new Promise((r) => setTimeout(r, 900));
  }
  throw new Error(
    `Przekroczono czas oczekiwania. Zadanie ${id} może nadal pracować; sprawdź API przed ponownym zleceniem.`,
  );
}
export async function upload(file: File): Promise<Asset> {
  const data = new FormData();
  data.append("file", file);
  const response = await fetch("/api/assets", { method: "POST", headers: authHeaders(), body: data });
  if (response.status === 401) requireLogin();
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.detail ?? "Nie udało się przesłać pliku");
  }
  return response.json();
}
export async function saveProject(project: Project, version: number | null) {
  return version === null
    ? request<{ project: Project; version: number }>("/projects", project)
    : request<{ project: Project; version: number }>(
        `/projects/${project.id}`,
        { project, base_version: version },
        "PUT",
      );
}
export function downloadJSON(project: Project) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }),
  );
  downloadURL(url, `${project.id}.forma.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadURL(url: string, name?: string) {
  const link = document.createElement("a");
  link.href = url;
  if (name) link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
