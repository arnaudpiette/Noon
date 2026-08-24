"use strict";

const { execFile } = require("child_process");
const { createConnector, providerFetch } = require("./base-connector");
const FORBIDDEN_GIT_ACTIONS = new Set(["push_force", "reset_hard", "delete_remote_branch", "rewrite_history"]);

function runGitReadOnly(cwd, operation, runner = execFile) {
  const commands = {
    status: ["status", "--porcelain=v1", "--branch"], branch: ["branch", "--show-current"],
    log: ["log", "-20", "--pretty=format:%H%x09%cI%x09%s"], diff: ["diff", "--stat"],
    remote: ["remote", "-v"],
  };
  if (!commands[operation]) return Promise.reject(new Error("Commande Git non autorisée."));
  return new Promise((resolve, reject) => runner("git", commands[operation], { cwd, timeout: 5000, maxBuffer: 512 * 1024 },
    (error, stdout) => error ? reject(new Error("Lecture Git impossible.")) : resolve(String(stdout))));
}

function createGitHubConnector(deps) {
  const base = createConnector({ id: "github", displayName: "GitHub",
    capabilities: ["repositories", "commits", "issues", "pull_requests", "checks", "publish_with_approvals"],
    readCapabilities: ["repositories", "commits", "issues", "pull_requests", "checks"],
    writeCapabilities: ["stage", "commit", "push", "pull_request"], scopes: ["fine-grained:metadata:read"],
  }, deps);
  const token = () => deps.tokenStore.get("github")?.access_token;
  const api = (path) => providerFetch(`https://api.github.com${path}`, { token: token(), headers: { "X-GitHub-Api-Version": "2022-11-28" } });
  function prepareGitAction(action, target, payload) {
    if (FORBIDDEN_GIT_ACTIONS.has(action)) throw new Error("Action Git définitivement bloquée.");
    return deps.approvals.requestApproval({ provider: "github", action, target, payload, preview: payload,
      consequences: `Exécutera uniquement l’étape Git « ${action} » affichée.` });
  }
  return { ...base,
    getGitHubRepository: (owner, repo) => api(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
    listGitHubRepositories: () => api("/user/repos?per_page=50&sort=updated"),
    listGitHubCommits: (owner, repo) => api(`/repos/${owner}/${repo}/commits?per_page=30`),
    listGitHubIssues: (owner, repo) => api(`/repos/${owner}/${repo}/issues?per_page=30`),
    listGitHubPullRequests: (owner, repo) => api(`/repos/${owner}/${repo}/pulls?per_page=30`),
    getGitHubChecks: (owner, repo, ref) => api(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/check-runs`),
    compareLocalAndRemote: runGitReadOnly, runGitReadOnly, prepareGitAction };
}
module.exports = { createGitHubConnector, runGitReadOnly, FORBIDDEN_GIT_ACTIONS };
