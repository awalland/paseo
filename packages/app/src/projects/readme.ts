import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { normalizeWorkspaceDescriptor, type WorkspaceDescriptor } from "@/stores/session-store";
import { i18n } from "@/i18n/i18next";

interface ProjectReadmeInput {
  project: SidebarProjectEntry;
  selection: ActiveWorkspaceSelection | null;
  getClient: (serverId: string) => Pick<DaemonClient, "listDirectory" | "createWorkspace"> | null;
  acceptWorkspace: (serverId: string, workspace: WorkspaceDescriptor) => void;
}

export interface ProjectReadmeTarget extends ActiveWorkspaceSelection {
  target: { kind: "file"; path: string };
}

export async function resolveProjectReadme(
  input: ProjectReadmeInput,
): Promise<ProjectReadmeTarget | null> {
  const { project, selection } = input;
  const selectedWorkspace = project.workspaces.find(
    (workspace) =>
      workspace.serverId === selection?.serverId && workspace.workspaceId === selection.workspaceId,
  );
  const preferredHost = project.hosts.find((host) => host.serverId === selectedWorkspace?.serverId);
  const host =
    preferredHost ??
    project.hosts.find((candidate) => input.getClient(candidate.serverId) !== null);
  if (!host) throw new Error(i18n.t("sidebar.project.toasts.hostDisconnected"));
  const client = input.getClient(host.serverId);
  if (!client) throw new Error(i18n.t("sidebar.project.toasts.hostDisconnected"));

  const directory = await client.listDirectory(host.iconWorkingDir, ".");
  const readmes = directory.entries.filter(
    (entry) => entry.kind === "file" && entry.name.toLowerCase() === "readme.md",
  );
  const readme = readmes.find((entry) => entry.name === "README.md") ?? readmes[0];
  if (!readme) return null;

  const hostWorkspaces = project.workspaces.filter(
    (workspace) => workspace.serverId === host.serverId,
  );
  const rootWorkspace = hostWorkspaces.find(
    (workspace) => workspace.workspaceDirectory === host.iconWorkingDir,
  );
  let workspaceId =
    selectedWorkspace?.workspaceId ?? rootWorkspace?.workspaceId ?? hostWorkspaces[0]?.workspaceId;
  if (!workspaceId) {
    const payload = await client.createWorkspace({
      source: { kind: "directory", path: host.iconWorkingDir, projectId: host.projectId },
    });
    if (payload.error || !payload.workspace)
      throw new Error(payload.error ?? i18n.t("sidebar.project.toasts.openReadmeFailed"));
    const workspace = normalizeWorkspaceDescriptor(payload.workspace);
    input.acceptWorkspace(host.serverId, workspace);
    workspaceId = workspace.id;
  }

  const separator = host.iconWorkingDir.includes("\\") ? "\\" : "/";
  const rootPath = host.iconWorkingDir.replace(/[\\/]+$/, "");
  return {
    serverId: host.serverId,
    workspaceId,
    target: {
      kind: "file",
      path: `${rootPath}${separator}${readme.name}`,
    },
  };
}
