"use strict";

module.exports = {
  ...require("./handoff-service"),
  ...require("./remote-approval-service"),
  ...require("./remote-auth"),
  ...require("./remote-health"),
  ...require("./remote-interaction-engine"),
  ...require("./remote-media-service"),
  ...require("./remote-presence-service"),
  ...require("./remote-repository"),
  ...require("./remote-response-policy"),
  ...require("./remote-schema"),
  ...require("./remote-stream-service"),
  ...require("./remote-transport-router"),
};
