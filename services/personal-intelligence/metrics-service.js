"use strict";

function createMetricsService(repository) {
  function record(metric, value = 1, dimensions = {}) { return repository.recordMetric({ metric, value, ...dimensions }); }
  function feedback(value, recommendationHash, category) { repository.recordFeedback({ value, recommendationHash, category }); record(value === "useful" ? "recommendations_accepted" : "recommendations_rejected", 1, { category }); }
  function dashboard(since) { const rows=repository.aggregateMetrics(since);const values=Object.fromEntries(rows.map(r=>[r.metric,Number(r.total)||0]));const generated=values.recommendations_generated||0;const accepted=values.recommendations_accepted||0;const completed=values.tasks_completed||0;return{values,acceptanceRate:generated?accepted/generated:0,completionRate:accepted?completed/accepted:0,breakdown:repository.metricBreakdown(since)}; }
  return { dashboard, feedback, record };
}
module.exports = { createMetricsService };
