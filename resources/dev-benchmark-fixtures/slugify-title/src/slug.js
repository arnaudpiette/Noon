function slugifyTitle(input) { return String(input).toLowerCase().replace(/\s+/g,'-'); }
module.exports = { slugifyTitle };
