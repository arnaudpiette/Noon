"use strict";

const crypto = require("crypto");

function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function rowReview(row) {
  if (!row) return null;
  return {
    ...parse(row.payload_json, {}), reviewId: row.id, reviewType: row.review_type,
    subjectScope: row.subject_scope, periodStart: row.period_start,
    periodEnd: row.period_end, reviewVersion: Number(row.review_version),
    fingerprint: row.fingerprint, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function createSqliteRepository(wrapper) {
  const db = wrapper.database;
  function transaction(operation) {
    const ownsTransaction = db.isTransaction !== true;
    const savepoint = ownsTransaction ? null : `review_learning_${crypto.randomUUID().replaceAll("-", "")}`;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE"); else db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (ownsTransaction) db.exec("COMMIT"); else db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      if (ownsTransaction) {
        try { db.exec("ROLLBACK"); } catch {}
      } else {
        try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch {}
        try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch {}
      }
      throw error;
    }
  }
  function getByFingerprint(fingerprint) {
    return rowReview(db.prepare("SELECT * FROM review_records WHERE fingerprint=?").get(fingerprint));
  }
  function getLatest({ reviewType, subjectScope = "arnaud", periodStart, periodEnd } = {}) {
    return rowReview(db.prepare(`SELECT * FROM review_records
      WHERE review_type=? AND subject_scope=? AND period_start=? AND period_end=?
      ORDER BY review_version DESC LIMIT 1`).get(reviewType, subjectScope, periodStart, periodEnd));
  }
  function save(review) {
    return transaction(() => {
      const duplicate = getByFingerprint(review.fingerprint);
      if (duplicate) return { review: duplicate, idempotent: true };
      const current = getLatest(review);
      const version = (current?.reviewVersion || 0) + 1;
      const timestamp = new Date().toISOString();
      db.prepare(`INSERT INTO review_records(id,review_type,subject_scope,period_start,period_end,review_version,fingerprint,payload_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(review.reviewId, review.reviewType,
        review.subjectScope, review.periodStart, review.periodEnd, version,
        review.fingerprint, JSON.stringify({ ...review, reviewVersion: version }), timestamp, timestamp);
      return { review: getByFingerprint(review.fingerprint), idempotent: false };
    });
  }
  function list(filters = {}) {
    const clauses = [], values = [];
    if (filters.reviewType) { clauses.push("review_type=?"); values.push(filters.reviewType); }
    if (filters.subjectScope) { clauses.push("subject_scope=?"); values.push(filters.subjectScope); }
    if (filters.since) { clauses.push("period_end>=?"); values.push(filters.since); }
    return db.prepare(`SELECT * FROM review_records ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY period_start DESC, review_version DESC LIMIT ?`)
      .all(...values, Math.min(100, Number(filters.limit) || 30)).map(rowReview);
  }
  return { kind: "sqlite", getByFingerprint, getLatest, list, save, transaction };
}

function createFallbackRepository(wrapper) {
  const load = () => wrapper.load();
  const saveState = (state) => wrapper.save(state);
  function list(filters = {}) {
    return (load().review_records || []).filter((item) =>
      (!filters.reviewType || item.reviewType === filters.reviewType) &&
      (!filters.subjectScope || item.subjectScope === filters.subjectScope) &&
      (!filters.since || item.periodEnd >= filters.since)
    ).sort((a, b) => b.periodStart.localeCompare(a.periodStart)).slice(0, Number(filters.limit) || 30);
  }
  function getByFingerprint(fingerprint) { return list({ limit: 1000 }).find((item) => item.fingerprint === fingerprint) || null; }
  function getLatest(input) { return list({ reviewType: input.reviewType, subjectScope: input.subjectScope, limit: 1000 })
    .filter((item) => item.periodStart === input.periodStart && item.periodEnd === input.periodEnd)
    .sort((a, b) => b.reviewVersion - a.reviewVersion)[0] || null; }
  function save(review) {
    const duplicate = getByFingerprint(review.fingerprint);
    if (duplicate) return { review: duplicate, idempotent: true };
    const state = load(); state.review_records ||= [];
    const current = getLatest(review);
    const value = { ...review, reviewVersion: (current?.reviewVersion || 0) + 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.review_records.push(value); saveState(state);
    return { review: value, idempotent: false };
  }
  return { kind: "json-fallback", getByFingerprint, getLatest, list, save };
}

function createReviewLearningRepository(wrapper) {
  return wrapper.kind === "sqlite" ? createSqliteRepository(wrapper) : createFallbackRepository(wrapper);
}

module.exports = { createReviewLearningRepository };
