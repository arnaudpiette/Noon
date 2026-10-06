"use strict";

const assert =
  require("node:assert/strict");
const fs =
  require("node:fs");
const path =
  require("node:path");
const test =
  require("node:test");

const serverPath =
  path.join(
    __dirname,
    "..",
    "server.js"
  );

function source() {
  return fs.readFileSync(
    serverPath,
    "utf8"
  );
}

function section(
  value,
  startMarker,
  endMarker
) {
  const start =
    value.indexOf(startMarker);

  const end =
    value.indexOf(
      endMarker,
      start
    );

  assert.ok(
    start >= 0,
    `Début introuvable : ${startMarker}`
  );

  assert.ok(
    end > start,
    `Fin introuvable : ${endMarker}`
  );

  return value.slice(
    start,
    end
  );
}

test(
  "Native UI est construit après le Terminal DEV et avec sa source d’autorisation serveur",
  () => {
    const value =
      source();

    const terminal =
      value.indexOf(
        "const devWorkspaceTerminalService = createDevWorkspaceTerminalService"
      );

    const nativeUi =
      value.indexOf(
        "const nativeDevUiExecutionService = createNativeDevUiExecutionService"
      );

    assert.ok(
      terminal >= 0
    );

    assert.ok(
      nativeUi > terminal
    );

    const wiring =
      value.slice(
        nativeUi,
        nativeUi + 1800
      );

    assert.match(
      wiring,
      /terminalService:\s*devWorkspaceTerminalService/
    );

    assert.match(
      wiring,
      /nativeDevFacade:\s*nativeDevB3Facade/
    );
  }
);

test(
  "POST Native UI exige la trusted UI et délègue exclusivement au service sécurisé",
  () => {
    const value =
      source();

    const route =
      section(
        value,
        '"/api/dev/native-ui/executions"',
        "const nativeDevUiCancel"
      );

    const trusted =
      route.indexOf(
        "requireTrustedDevUi(req)"
      );

    const start =
      route.indexOf(
        "nativeDevUiExecutionService"
      );

    assert.ok(
      trusted >= 0
    );

    assert.ok(
      start > trusted
    );

    assert.match(
      route,
      /\.start\(\{/
    );

    assert.match(
      route,
      /body\.workspaceSessionId/
    );

    assert.match(
      route,
      /body\.validationCommand/
    );

    assert.doesNotMatch(
      route,
      /nativeDevB3Facade\.runTask/
    );

    assert.doesNotMatch(
      route,
      /nativeDevCoordinator\.runTask/
    );

    assert.doesNotMatch(
      route,
      /nativeDevReasoner/
    );

    assert.doesNotMatch(
      route,
      /openAIProviderAdapter/
    );
  }
);

test(
  "cancel Native UI reste derrière trusted UI et le service dédié",
  () => {
    const value =
      source();

    const route =
      section(
        value,
        "const nativeDevUiCancel",
        "const nativeDevUiStatus"
      );

    const trusted =
      route.indexOf(
        "requireTrustedDevUi(req)"
      );

    const cancel =
      route.indexOf(
        ".cancel("
      );

    assert.ok(
      trusted >= 0
    );

    assert.ok(
      cancel > trusted
    );

    assert.match(
      route,
      /nativeDevUiExecutionService/
    );

    assert.match(
      route,
      /\.get\(/
    );

    assert.doesNotMatch(
      route,
      /nativeDevB3Facade/
    );
  }
);

test(
  "status Native UI reste derrière trusted UI et le service dédié",
  () => {
    const value =
      source();

    const route =
      section(
        value,
        "const nativeDevUiStatus",
        'if (requestPath === "/api/dev/native/tasks"'
      );

    const trusted =
      route.indexOf(
        "requireTrustedDevUi(req)"
      );

    const get =
      route.indexOf(
        ".get("
      );

    assert.ok(
      trusted >= 0
    );

    assert.ok(
      get > trusted
    );

    assert.match(
      route,
      /nativeDevUiExecutionService/
    );

    assert.doesNotMatch(
      route,
      /nativeDevB3Facade/
    );

    assert.doesNotMatch(
      route,
      /nativeDevCoordinator/
    );
  }
);
