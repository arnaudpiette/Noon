"use strict";

module.exports = {
  ...require("./goal-schema"),
  ...require("./goal-registry"),
  ...require("./goal-alignment-service"),
  ...require("./goal-progress-service"),
  ...require("./goal-strategy-engine"),
};
