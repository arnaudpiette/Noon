"use strict";

// V3-L7 — inspection du dépôt par le moteur d'implémentation Native DEV (lecture du contexte,
// dépendances locales), sortie telle quelle de native-dev-implementation-engine.js. Le moteur la
// construit avec son propre `journal` : mêmes lectures, mêmes entrées de journal.

const { readText, searchRepository } = require("./native-repository-tools");
const {
  LOCAL_DEPENDENCY_MAX_FILES,
  localDependencyCandidates,
  relativeDependencySpecifiers,
  unique,
} = require("./native-dev-implementation-helpers");

function createNativeDevInspection({ journal }) {
  function inspect(
    contract,
    taskId,
    requestedFiles,
    searchTerms,
    snapshots
  ) {
    const searched =
      searchTerms.length
        ? searchRepository(
            contract,
            searchTerms
          )
        : [];

    const read = [];
    const unavailable = [];

    for (
      const file of unique([
        ...requestedFiles,
        ...searched,
      ]).slice(0, 40)
    ) {
      try {
        const item =
          readText(
            contract,
            file
          );

        snapshots.set(
          item.relative,
          item
        );

        journal.recordRead(
          taskId,
          item.relative,
          item.hash
        );

        read.push(
          item.relative
        );
      } catch (error) {
        // REPOSITORY_CONTEXT_UNAVAILABLE_NORMALIZATION
        const unavailableCode =
          ["ENOENT", "ENOTDIR"].includes(
            error?.code
          )
            ? "FILE_UNAVAILABLE"
            : error?.code;

        if (
          ![
            "FILE_UNAVAILABLE",
            "BINARY_FILE_DENIED",
          ].includes(
            unavailableCode
          )
        ) {
          throw error;
        }

        unavailable.push({
          path:
            String(file)
              .slice(0, 400),
          code:
            String(
              unavailableCode
            ).slice(0, 80),
        });
      }
    }

    return {
      read,
      searched,
      unavailable,
    };
  }

  function inspectLocalDependencies(
    contract,
    taskId,
    snapshots,
    seedFiles
  ) {
    const read = [];

    const seeds =
      unique(
        Array.isArray(seedFiles)
          ? seedFiles
          : []
      ).slice(0, 40);

    for (const seed of seeds) {
      const snapshot =
        snapshots.get(seed);

      if (
        !snapshot ||
        typeof snapshot.content !==
          "string"
      ) {
        continue;
      }

      const specifiers =
        relativeDependencySpecifiers(
          snapshot.content
        );

      for (const specifier of specifiers) {
        const candidates =
          localDependencyCandidates(
            seed,
            specifier
          );

        for (const candidate of candidates) {
          if (
            snapshots.has(candidate)
          ) {
            break;
          }

          try {
            const item =
              readText(
                contract,
                candidate
              );

            snapshots.set(
              item.relative,
              item
            );

            journal.recordRead(
              taskId,
              item.relative,
              item.hash
            );

            read.push(
              item.relative
            );

            break;
          } catch (error) {
            if (
              [
                "ENOENT",
                "ENOTDIR",
                "FILE_UNAVAILABLE",
                "BINARY_FILE_DENIED",
                "OUT_OF_SCOPE_CHANGE",
              ].includes(
                error?.code
              )
            ) {
              continue;
            }

            throw error;
          }
        }

        if (
          read.length >=
          LOCAL_DEPENDENCY_MAX_FILES
        ) {
          return {
            read:
              unique(read),
          };
        }
      }
    }

    return {
      read:
        unique(read),
    };
  }

  return { inspect, inspectLocalDependencies };
}

module.exports = { createNativeDevInspection };
