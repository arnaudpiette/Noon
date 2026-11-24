"use strict";

// V3-L7 — lectures déterministes de askAI (agenda et emails récents), sorties telles quelles de
// ask-ai.js. askAI les appelle à la même place, avec les mêmes valeurs : chaque branche se
// terminait déjà par un return sur tous ses chemins, et n'écrivait dans aucune variable de askAI.

const { localDayRange } = require("../connectors/google-calendar");

// Lecture déterministe de l'agenda (Google Calendar) : branche de askAI déplacée telle quelle ; elle se termine toujours par un return.
async function handleDeterministicCalendarRead({ calendarConnector, calendarNormalized, sessionId, setSessionActivity }) {
  setSessionActivity(
    sessionId,
    "thinking",
    "Lecture de Google Calendar…"
  );

  try {
    const now = new Date();

    const target = new Date(now);
    target.setSeconds(0, 0);

    const months = {
      janvier: 0,
      fevrier: 1,
      mars: 2,
      avril: 3,
      mai: 4,
      juin: 5,
      juillet: 6,
      aout: 7,
      septembre: 8,
      octobre: 9,
      novembre: 10,
      decembre: 11,
    };

    const explicitDate =
      calendarNormalized.match(
        /\b([0-3]?\d)\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(\d{4}))?\b/
      );

    if (explicitDate) {
      const day = Number(explicitDate[1]);
      const month = months[explicitDate[2]];
      const year = explicitDate[3]
        ? Number(explicitDate[3])
        : now.getFullYear();

      target.setFullYear(year, month, day);
    } else if (/\bavant hier\b/.test(calendarNormalized)) {
      target.setDate(target.getDate() - 2);
    } else if (/\bhier\b/.test(calendarNormalized)) {
      target.setDate(target.getDate() - 1);
    } else if (/\bapres demain\b/.test(calendarNormalized)) {
      target.setDate(target.getDate() + 2);
    } else if (/\bdemain\b/.test(calendarNormalized)) {
      target.setDate(target.getDate() + 1);
    } else if (/\baujourd hui\b/.test(calendarNormalized)) {
      // target reste aujourd'hui
    } else {
      const weekdays = {
        dimanche: 0,
        lundi: 1,
        mardi: 2,
        mercredi: 3,
        jeudi: 4,
        vendredi: 5,
        samedi: 6,
      };

      const weekdayMatch =
        calendarNormalized.match(
          /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?:\s+(dernier|derniere|prochain|prochaine))?\b/
        );

      if (weekdayMatch) {
        const wanted = weekdays[weekdayMatch[1]];
        const qualifier = weekdayMatch[2] || "prochain";

        if (
          qualifier === "dernier" ||
          qualifier === "derniere"
        ) {
          let distance =
            (now.getDay() - wanted + 7) % 7;

          if (distance === 0) {
            distance = 7;
          }

          target.setDate(
            target.getDate() - distance
          );
        } else {
          let distance =
            (wanted - now.getDay() + 7) % 7;

          if (distance === 0) {
            distance = 7;
          }

          target.setDate(
            target.getDate() + distance
          );
        }
      }
    }

    const range = localDayRange(target);
    const from = new Date(range.timeMin);
    const result = await calendarConnector.listCompleteCalendarEvents(range);
    if (!result.complete) throw Object.assign(new Error("Agenda incomplet : impossible de présenter la journée complète."), { code: "CALENDAR_INCOMPLETE" });

    const events = (result.items || [])
      .slice()
      .sort((left, right) => {
        const leftStart =
          left.start?.dateTime ||
          left.start?.date ||
          "";

        const rightStart =
          right.start?.dateTime ||
          right.start?.date ||
          "";

        return String(leftStart).localeCompare(
          String(rightStart)
        );
      });

    const dayLabel = from.toLocaleDateString(
      "fr-FR",
      {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }
    );

    const answer = events.length
      ? `Voici ton agenda du ${dayLabel} :\n\n${events
      .map((event) => {
        const allDay =
          Boolean(event.start?.date) &&
          !event.start?.dateTime;

        let timeLabel = "Toute la journée";

        if (
          !allDay &&
          event.start?.dateTime
        ) {
          const start =
            new Date(event.start.dateTime);

          timeLabel =
            start.toLocaleTimeString(
              "fr-FR",
              {
                hour: "2-digit",
                minute: "2-digit",
              }
            );
        }

        const title =
          event.summary ||
          "Événement sans titre";

        const location =
          event.location
            ? ` — ${event.location}`
            : "";

        return `• ${timeLabel} — ${title}${location}`;
      })
      .join("\n")}`
      : `Tu n’as aucun événement dans ton agenda le ${dayLabel}.`;

    setSessionActivity(
      sessionId,
      "done",
      "Agenda récupéré."
    );

    return {
      status: "completed",
      answer,
      sources: [],
      artifacts: [],
      webSearchCalls: 0,
      executionId: null,
      runtime: {
        state: "LOCAL",
        remoteCalls: 0,
      },
    };
  } catch (error) {
    setSessionActivity(
      sessionId,
      "done",
      "Google Calendar indisponible."
    );

    const authRequired =
      error?.status === 401 ||
      error?.code === "AUTH_MISSING" ||
      calendarConnector.status?.authState ===
        "AUTH_REQUIRED";

    return {
      status: "completed",
      answer: authRequired
        ? "La connexion Google Calendar doit être renouvelée."
        : "Je n’arrive pas à lire Google Calendar pour le moment.",
      sources: [],
      artifacts: [],
      webSearchCalls: 0,
      executionId: null,
      runtime: {
        state: "LOCAL",
        remoteCalls: 0,
      },
    };
  }
}

// Lecture déterministe des emails récents (Gmail) : branche de askAI déplacée telle quelle ; elle se termine toujours par un return.
async function handleDeterministicRecentEmailRead({ gmailConnector, sessionId, setSessionActivity }) {
  setSessionActivity(
    sessionId,
    "thinking",
    "Lecture des derniers e-mails…"
  );

  try {
    const searchResult =
      await gmailConnector.searchGmailMessages(
        "in:inbox",
        { maxResults: 5 }
      );

    const refs = (searchResult.messages || [])
      .slice(0, 5);

    const rawMessages = await Promise.all(
      refs.map((item) =>
        gmailConnector.getGmailMessage(item.id)
      )
    );

    const messages = rawMessages.map((message) => {
      const headers =
        Array.isArray(message?.payload?.headers)
          ? message.payload.headers
          : [];

      const header = (name) => {
        const found = headers.find(
          (item) =>
            String(item?.name || "")
              .toLowerCase() ===
            String(name).toLowerCase()
        );

        return String(found?.value || "").trim();
      };

      const subject =
        header("Subject") || "Sans objet";

      const from =
        header("From") || "Expéditeur inconnu";

      const rawDate = header("Date");

      let date = rawDate;

      if (rawDate) {
        const parsed = new Date(rawDate);

        if (!Number.isNaN(parsed.getTime())) {
          date = parsed.toLocaleString("fr-FR", {
            dateStyle: "short",
            timeStyle: "short",
          });
        }
      }

      const snippet = String(
        message?.snippet || ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220);

      return {
        id: message?.id || null,
        threadId: message?.threadId || null,
        subject,
        from,
        date,
        snippet,
        gmailUrl: (message?.threadId || message?.id)
          ? `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(
          message.threadId || message.id
        )}`
          : null,
      };
    });

    const answer = messages.length
      ? `Voici tes ${messages.length} derniers e-mails dans la boîte de réception :\n\n${messages
      .map((mail, index) => {
        const safeSubject = String(
          mail.subject || "Sans objet"
        ).replace(/[[\]]/g, "");

        const details = [
          mail.gmailUrl
            ? `[${index + 1}. ${safeSubject}](${mail.gmailUrl})`
            : `${index + 1}. ${safeSubject}`,
          `De : ${mail.from}`,
          mail.date
            ? `Date : ${mail.date}`
            : null,
          mail.snippet
            ? `${mail.snippet}${mail.snippet.length >= 220 ? "…" : ""}`
            : null,
        ]
          .filter(Boolean)
          .join("\n");

        return details;
      })
      .join("\n\n")}`
      : "Je n’ai trouvé aucun e-mail dans ta boîte de réception.";

    setSessionActivity(
      sessionId,
      "done",
      "E-mails récupérés."
    );

    return {
      status: "completed",
      answer,
      sources: [],
      artifacts: [],
      webSearchCalls: 0,
      executionId: null,
      runtime: {
        state: "LOCAL",
        remoteCalls: 0,
      },
    };
  } catch (error) {
    setSessionActivity(
      sessionId,
      "done",
      "Gmail indisponible."
    );

    const authRequired =
      error?.status === 401 ||
      error?.code === "AUTH_MISSING" ||
      gmailConnector.status?.authState ===
        "AUTH_REQUIRED";

    return {
      status: "completed",
      answer: authRequired
        ? "La connexion Gmail doit être renouvelée."
        : "Je n’arrive pas à lire Gmail pour le moment.",
      sources: [],
      artifacts: [],
      webSearchCalls: 0,
      executionId: null,
      runtime: {
        state: "LOCAL",
        remoteCalls: 0,
      },
    };
  }
}

module.exports = { handleDeterministicCalendarRead, handleDeterministicRecentEmailRead };
