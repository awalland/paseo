import { describe, expect, it } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
import { resolveProjectReadme } from "./readme";

function project(): SidebarProjectEntry {
  return {
    viewKey: "project",
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: "/repo",
    hosts: [
      {
        serverId: "host",
        projectId: "project",
        iconWorkingDir: "/repo",
        worktreeSupport: "supported",
      },
    ],
    workspaces: [
      {
        workspaceKey: "host:main",
        serverId: "host",
        workspaceId: "main",
        projectViewKey: "project",
        projectName: "Project",
        projectKind: "git",
        workspaceKind: "local_checkout",
        name: "main",
        workspaceDirectory: "/repo",
      },
    ],
  };
}

function client(names: string[]): Pick<DaemonClient, "listDirectory" | "createWorkspace"> {
  return {
    async listDirectory() {
      return {
        path: ".",
        entries: names.map((name) => ({
          name,
          path: name,
          kind: "file" as const,
          size: 10,
          modifiedAt: "2026-10-10T00:00:00Z",
        })),
      };
    },
    async createWorkspace() {
      throw new Error("Unexpected workspace creation");
    },
  };
}

function resolve(names: string[]) {
  return resolveProjectReadme({
    project: project(),
    selection: null,
    getClient: () => client(names),
    acceptWorkspace() {
      throw new Error("Unexpected workspace registration");
    },
  });
}

describe("project README", () => {
  it.each(["README.md", "readme.md", "Readme.MD"])("opens %s as a file tab", async (name) => {
    expect(await resolve([name])).toEqual({
      serverId: "host",
      workspaceId: "main",
      target: { kind: "file", path: `/repo/${name}` },
    });
  });

  it("does not create a workspace or open a tab when there is no README", async () => {
    expect(await resolve(["package.json", "README.md.txt"])).toBeNull();
  });

  it("prefers the conventional uppercase name when several variants exist", async () => {
    expect(await resolve(["readme.md", "README.md"])).toMatchObject({
      target: { path: "/repo/README.md" },
    });
  });

  it("uses the current workspace and its host for a grouped project", async () => {
    const grouped = project();
    grouped.hosts.push({
      serverId: "remote",
      projectId: "remote-project",
      iconWorkingDir: "/remote/repo",
      worktreeSupport: "supported",
    });
    grouped.workspaces.push({
      ...grouped.workspaces[0]!,
      workspaceKey: "remote:feature",
      serverId: "remote",
      workspaceId: "feature",
      workspaceDirectory: "/remote/worktree",
    });
    const requestedRoots: string[] = [];
    const remoteClient = client(["readme.md"]);
    remoteClient.listDirectory = async (cwd) => {
      requestedRoots.push(cwd);
      return {
        path: ".",
        entries: [
          {
            name: "readme.md",
            path: "readme.md",
            kind: "file",
            size: 10,
            modifiedAt: "2026-10-10T00:00:00Z",
          },
        ],
      };
    };
    expect(
      await resolveProjectReadme({
        project: grouped,
        selection: { serverId: "remote", workspaceId: "feature" },
        getClient: () => remoteClient,
        acceptWorkspace() {},
      }),
    ).toEqual({
      serverId: "remote",
      workspaceId: "feature",
      target: { kind: "file", path: "/remote/repo/readme.md" },
    });
    expect(requestedRoots).toEqual(["/remote/repo"]);
  });

  it.each([
    ["/repo ", "/repo /README.md"],
    ["/", "/README.md"],
    ["C:\\repo", "C:\\repo\\README.md"],
  ])("preserves the project path %s", async (root, readmePath) => {
    const entry = project();
    entry.hosts[0]!.iconWorkingDir = root;
    expect(
      await resolveProjectReadme({
        project: entry,
        selection: null,
        getClient: () => client(["README.md"]),
        acceptWorkspace() {},
      }),
    ).toMatchObject({ target: { path: readmePath } });
  });

  it("leaves a project without workspaces alone when there is no README", async () => {
    const entry = project();
    entry.workspaces = [];
    expect(
      await resolveProjectReadme({
        project: entry,
        selection: null,
        getClient: () => client([]),
        acceptWorkspace() {
          throw new Error("Unexpected workspace registration");
        },
      }),
    ).toBeNull();
  });

  it("surfaces directory read failures", async () => {
    const failingClient = client([]);
    failingClient.listDirectory = async () => {
      throw new Error("Permission denied");
    };
    await expect(
      resolveProjectReadme({
        project: project(),
        selection: null,
        getClient: () => failingClient,
        acceptWorkspace() {},
      }),
    ).rejects.toThrow("Permission denied");
  });

  it("surfaces disconnection instead of opening another host's README", async () => {
    await expect(
      resolveProjectReadme({
        project: project(),
        selection: { serverId: "host", workspaceId: "main" },
        getClient: () => null,
        acceptWorkspace() {},
      }),
    ).rejects.toThrow("Host is not connected");
  });
});
